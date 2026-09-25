#!/usr/bin/env node
/**
 * Knowledge Web Publisher — Publication Manifest validation, content staging,
 * and generated site identity.
 *
 * This is the single build entrypoint consumers run before the static reader
 * build. It:
 *   1. Loads and validates the Knowledge Base's Publication Manifest
 *      (site title, canonical hostname, explicit content allowlist, optional
 *      ordered navigation, optional owner-declared projection destinations).
 *   2. Rejects invalid manifests before any build output is produced:
 *      missing fields, empty allowlists, nonexistent selections, absolute
 *      paths, parent traversal, out-of-root selections, symlink escapes,
 *      invalid navigation entries, and unsafe or conflicting destinations.
 *   3. Copies ONLY allowlisted content, byte-for-byte, into an isolated
 *      build content directory. The Knowledge Base is never modified.
 *   4. Generates a synthetic landing page in the build tree only when the
 *      selected content has no root `index.md`.
 *   5. Emits deterministic generated site identity (title, canonical
 *      hostname, resolved navigation roots, and explicitly declared
 *      projection destinations) as JSON outside the staged content tree.
 *      Staging never modifies a tracked configuration file.
 *      See docs/adr-0002-quartz-replacement-reader.md and
 *      docs/adr-0004-remove-quartz-rollback.md.
 *
 * Usage:
 *   node scripts/stage-content.mjs \
 *     --kb-root <Knowledge Base root> \
 *     [--manifest <path, default <kb-root>/publication.manifest.yaml>] \
 *     [--content-dir <path, default ./content>] \
 *     [--identity-file <path, default ./site-identity.json>]
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PUBLISHER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const DEFAULT_MANIFEST_NAME = "publication.manifest.yaml"

const TRACKED_RUNTIME_CONFIG = path.join(PUBLISHER_ROOT, "nginx.conf")

// A canonical hostname: DNS labels separated by dots, no scheme, port, path,
// userinfo, or whitespace. At least one dot is required so single-label names
// (like "localhost") are not treated as canonical hostnames.
const HOSTNAME_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

const errors = []

function fail(message) {
  errors.push(message)
}

function die() {
  if (errors.length > 0) {
    console.error("✗ Publication Manifest validation failed:")

    for (const error of errors) console.error(`  - ${error}`)
  }

  process.exit(1)
}

function parseArgs(argv) {
  const args = { kbRoot: null, manifest: null, contentDir: null, identityFile: null }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const value = argv[i + 1]

    switch (arg) {
      case "--kb-root":
        args.kbRoot = value
        i++
        break
      case "--manifest":
        args.manifest = value
        i++
        break
      case "--content-dir":
        args.contentDir = value
        i++
        break
      case "--identity-file":
        args.identityFile = value
        i++
        break
      case "--config-file":
        fail(
          "--config-file is no longer supported: staging no longer mutates Quartz configuration; " +
            "use --identity-file to emit generated site identity JSON outside the staged content tree",
        )
        i++
        break
      default:
        fail(`unknown argument: ${arg}`)
    }
  }

  return args
}

function isInside(rootReal, candidateReal) {
  return candidateReal === rootReal || candidateReal.startsWith(rootReal + path.sep)
}

/**
 * Normalize a selection to a clean relative path, or null if invalid.
 * Rejects absolute paths, parent traversal, "." self-selection, the Git
 * directory, and any path that could escape the Knowledge Base root.
 */
function normalizeSelection(raw) {
  if (String(raw) !== raw || raw.trim() === "") {
    fail("every allowlist entry must be a non-empty string")

    return null
  }

  let rel = raw.trim()

  if (rel.split("/").includes("..")) {
    fail(`selection "${raw}" traverses above the Knowledge Base root (".." is not allowed)`)

    return null
  }

  if (path.posix.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel)) {
    fail(
      `selection "${raw}" is an absolute path; selections must be relative to the Knowledge Base root`,
    )

    return null
  }

  if (rel.includes("\\")) {
    fail(`selection "${raw}" contains a backslash; use "/" separators`)

    return null
  }

  while (rel.startsWith("./")) rel = rel.slice(2)
  rel = rel.replace(/\/+/g, "/").replace(/\/+$/, "")

  if (rel === "" || rel === "." || rel.split("/").includes(".")) {
    fail(`selection "${raw}" selects the root or an empty path; list explicit roots or files`)

    return null
  }

  if (rel === ".git" || rel.startsWith(".git/")) {
    fail(`selection "${raw}" targets the Git directory; Git history is never published`)

    return null
  }

  return rel
}

async function loadYaml() {
  try {
    return await import("yaml")
  } catch {
    fail(
      'the "yaml" package is required; run `pnpm install --frozen-lockfile` in the Publisher before staging',
    )

    return null
  }
}

function readManifest(manifestPath, yaml) {
  if (!fs.existsSync(manifestPath)) {
    fail(`Publication Manifest not found at ${manifestPath}`)

    return null
  }

  let parsed

  try {
    parsed = yaml.parse(fs.readFileSync(manifestPath, "utf8"))
  } catch (error) {
    fail(`Publication Manifest at ${manifestPath} is not valid YAML: ${error.message}`)

    return null
  }

  if (
    parsed === null ||
    Object(parsed) !== parsed ||
    parsed instanceof Function ||
    Array.isArray(parsed)
  ) {
    fail(`Publication Manifest at ${manifestPath} must be a YAML mapping`)

    return null
  }

  return parsed
}

function validateManifest(manifest, kbRootReal) {
  const { title, canonicalHostname, select } = manifest

  if (String(title) !== title || title.trim() === "") {
    fail('manifest requires a site title (top-level "title")')
  }

  if (String(canonicalHostname) !== canonicalHostname || canonicalHostname.trim() === "") {
    fail('manifest requires a canonical hostname (top-level "canonicalHostname")')
  } else if (
    !HOSTNAME_RE.test(canonicalHostname) ||
    /[\s/\\:@]/.test(canonicalHostname) ||
    canonicalHostname.includes("://")
  ) {
    fail(
      `canonicalHostname "${canonicalHostname}" is not a valid hostname ` +
        `(use a DNS name without scheme, port, or path)`,
    )
  }

  if (!Array.isArray(select) || select.length === 0) {
    fail(
      'manifest requires an explicit content allowlist (top-level "select" with at least one entry)',
    )

    return []
  }

  const selections = []

  for (const raw of select) {
    const rel = normalizeSelection(raw)

    if (rel === null) continue

    const abs = path.join(kbRootReal, rel)
    let stat

    try {
      stat = fs.lstatSync(abs)
    } catch {
      fail(`selection "${raw}" does not exist in the Knowledge Base root`)
      continue
    }

    let real

    try {
      real = fs.realpathSync(abs)
    } catch {
      fail(`selection "${raw}" is a broken symlink and cannot be staged`)
      continue
    }

    if (!isInside(kbRootReal, real)) {
      fail(
        `selection "${raw}" resolves outside the Knowledge Base root ` +
          `(to "${real}"); rejecting as out-of-root or symlink escape`,
      )
      continue
    }

    // Classify by the *resolved* path so a symlink to a directory stages as a directory.
    const resolvedStat = fs.statSync(real)
    selections.push({
      rel,
      real,
      isDir: resolvedStat.isDirectory(),
      isSymlink: stat.isSymbolicLink(),
    })
  }

  if (selections.length === 0) {
    fail("no valid selections remain; nothing can be staged")
  }

  return selections
}

/**
 * Normalize a navigation entry to a clean relative path, or null if invalid.
 * Applies the same safety rules as selections: rejects absolute paths,
 * parent traversal, "." self-selection, the Git directory, and any path
 * that could escape the Knowledge Base root.
 */
function normalizeNavigationEntry(raw) {
  if (String(raw) !== raw || raw.trim() === "") {
    fail("every navigation entry must be a non-empty string")

    return null
  }

  let rel = raw.trim()

  if (rel.split("/").includes("..")) {
    fail(`navigation entry "${raw}" traverses above the Knowledge Base root (".." is not allowed)`)

    return null
  }

  if (path.posix.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel)) {
    fail(
      `navigation entry "${raw}" is an absolute path; navigation entries must be relative to the Knowledge Base root`,
    )

    return null
  }

  if (rel.includes("\\")) {
    fail(`navigation entry "${raw}" contains a backslash; use "/" separators`)

    return null
  }

  while (rel.startsWith("./")) rel = rel.slice(2)
  rel = rel.replace(/\/+/g, "/").replace(/\/+$/, "")

  if (rel === "" || rel === "." || rel.split("/").includes(".")) {
    fail(
      `navigation entry "${raw}" selects the root or an empty path; list explicit roots or files`,
    )

    return null
  }

  if (rel === ".git" || rel.startsWith(".git/")) {
    fail(`navigation entry "${raw}" targets the Git directory; Git history is never published`)

    return null
  }

  return rel
}

/**
 * Parse optional `navigation` after `select` validation.
 * Returns null when the shape is invalid (errors already recorded),
 * `{ explicit: false }` when absent (derive from `select`),
 * or `{ explicit: true, entries: [{ raw, rel }] }` when present.
 * Checks non-empty list shape, path safety/normalization, normalized
 * duplicates, and coverage by the allowlist. Staged-tree checks happen later.
 */
function parseNavigation(manifest, selections) {
  const rawNav = manifest.navigation

  if (rawNav === undefined) return { explicit: false }

  if (!Array.isArray(rawNav) || rawNav.length === 0) {
    fail('manifest "navigation", when present, must be a non-empty list of non-empty strings')

    return null
  }

  const entries = []
  const seen = new Map()

  for (const raw of rawNav) {
    const rel = normalizeNavigationEntry(raw)

    if (rel === null) continue

    if (seen.has(rel)) {
      fail(
        `navigation entry "${raw}" duplicates "${seen.get(rel)}" after normalization (both resolve to "${rel}")`,
      )
      continue
    }

    seen.set(rel, raw)

    const covered = selections.some(
      (sel) => rel === sel.rel || (sel.isDir && rel.startsWith(`${sel.rel}/`)),
    )

    if (!covered) {
      fail(
        `navigation entry "${raw}" is not covered by the allowlist ("select"); navigation cannot broaden publication`,
      )
      continue
    }

    entries.push({ raw, rel })
  }

  return { explicit: true, entries }
}

/**
 * Normalize an absolute secure HTTPS origin to `https://hostname`, or null
 * when unsafe or malformed. Rejects non-HTTPS schemes, credentials, ports,
 * paths, queries, fragments, whitespace, and non-DNS hostnames.
 */
function normalizeDestinationOrigin(trimmed) {
  if (/\s/.test(trimmed)) return null

  let parsed

  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== "https:") return null

  if (parsed.username !== "" || parsed.password !== "") return null

  if (parsed.port !== "") return null

  if (parsed.search !== "" || parsed.hash !== "") return null

  if (parsed.pathname !== "" && parsed.pathname !== "/") return null

  if (!HOSTNAME_RE.test(parsed.hostname)) return null

  return parsed.origin
}

/**
 * Parse optional `destinations` after `select` validation.
 * Returns null when the shape is invalid (errors already recorded),
 * `{ explicit: false, entries: [] }` when absent (legacy manifests stay
 * valid and emit no destinations), or
 * `{ explicit: true, entries: [{ rawName, name, rawOrigin, origin }] }`
 * when present. Origins normalize to `https://hostname` (lowercased, no
 * trailing slash). Checks non-empty list shape, display names, absolute
 * secure HTTPS origins, normalized duplicates, and conflicts with the
 * current canonical hostname. Destinations are presentation links only:
 * they never broaden the allowlist and are never auto-discovered.
 */
function parseDestinations(manifest, canonicalHostname) {
  const rawDest = manifest.destinations

  if (rawDest === undefined) return { explicit: false, entries: [] }

  if (!Array.isArray(rawDest) || rawDest.length === 0) {
    fail(
      'manifest "destinations", when present, must be a non-empty list of display-name/origin entries',
    )

    return null
  }

  const canonical = String(canonicalHostname ?? "")
    .trim()
    .toLowerCase()

  const entries = []
  const seenOrigins = new Map()
  const seenNames = new Map()

  for (const raw of rawDest) {
    if (raw === null || Object(raw) !== raw || raw instanceof Function || Array.isArray(raw)) {
      fail("every destination must be a mapping with a display name and a secure HTTPS origin")

      continue
    }

    const { name: rawName, origin: rawOrigin } = raw

    if (String(rawName) !== rawName || rawName.trim() === "") {
      fail("every destination must declare a non-empty display name")

      continue
    }

    const name = rawName.trim()

    if (String(rawOrigin) !== rawOrigin || rawOrigin.trim() === "") {
      fail(`destination "${name}" must declare a non-empty secure HTTPS origin`)

      continue
    }

    const normalized = normalizeDestinationOrigin(rawOrigin.trim())

    if (normalized === null) {
      fail(
        `destination "${name}" origin "${rawOrigin}" is not a secure absolute HTTPS origin ` +
          `(use "https://hostname" with no path, query, fragment, credentials, or port)`,
      )

      continue
    }

    if (seenOrigins.has(normalized)) {
      fail(
        `destination "${name}" duplicates "${seenOrigins.get(normalized)}" ` +
          `(both resolve to "${normalized}")`,
      )

      continue
    }

    seenOrigins.set(normalized, name)

    if (seenNames.has(name)) {
      fail(`destination name "${name}" is declared more than once; display names must be unique`)

      continue
    }

    seenNames.set(name, normalized)

    if (normalized.replace(/^https:\/\//, "") === canonical) {
      fail(
        `destination "${name}" origin "${normalized}" matches the current canonical hostname; ` +
          `a projection never lists itself as another destination`,
      )

      continue
    }

    entries.push({ rawName, name, rawOrigin, origin: normalized })
  }

  return { explicit: true, entries }
}

function isMarkdownPath(rel) {
  return /\.mdx?$/i.test(rel)
}

/** Return true when a staged directory contains at least one Markdown file. */
function stagedDirHasMarkdown(dirAbs) {
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name === ".git") continue
    const full = path.join(dirAbs, entry.name)

    if (entry.isSymbolicLink()) {
      let stat

      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }

      if (stat.isDirectory()) {
        if (stagedDirHasMarkdown(full)) return true
      } else if (stat.isFile() && isMarkdownPath(entry.name)) {
        return true
      }

      continue
    }

    if (entry.isDirectory()) {
      if (stagedDirHasMarkdown(full)) return true
    } else if (entry.isFile() && isMarkdownPath(entry.name)) {
      return true
    }
  }

  return false
}

/**
 * Validate explicit navigation against the temporary staged tree.
 * Classifies each entry as `directory` or `markdown`, rejecting missing
 * staged paths, non-Markdown files, and directories without staged
 * Markdown descendants. Preserves explicit order.
 */
function resolveExplicitNavigation(stagingDir, entries) {
  const roots = []

  for (const { raw, rel } of entries) {
    const stagedAbs = path.join(stagingDir, rel)
    let stat

    try {
      stat = fs.statSync(stagedAbs)
    } catch {
      fail(`navigation entry "${raw}" does not exist in the staged tree (resolved to "${rel}")`)
      continue
    }

    if (stat.isDirectory()) {
      let hasMarkdown = false

      try {
        hasMarkdown = stagedDirHasMarkdown(stagedAbs)
      } catch {
        hasMarkdown = false
      }

      if (!hasMarkdown) {
        fail(
          `navigation directory "${raw}" contains no staged Markdown pages (resolved to "${rel}")`,
        )
        continue
      }

      roots.push({ path: rel, kind: "directory" })
    } else if (stat.isFile()) {
      if (!isMarkdownPath(rel)) {
        fail(
          `navigation entry "${raw}" is not a Markdown file (resolved to "${rel}"); only Markdown files can be navigation roots`,
        )
        continue
      }

      roots.push({ path: rel, kind: "markdown" })
    } else {
      fail(`navigation entry "${raw}" is not a file or directory in the staged tree`)
    }
  }

  return roots
}

/**
 * Derive navigation roots from `select` order when `navigation` is absent.
 * Keeps Markdown files and directories containing Markdown pages; ignores
 * asset-only selections. Preserves manifest `select` order.
 */
function deriveNavigation(stagingDir, selections) {
  const roots = []
  const seen = new Set()

  for (const sel of selections) {
    if (seen.has(sel.rel)) continue
    const stagedAbs = path.join(stagingDir, sel.rel)
    let stat

    try {
      stat = fs.statSync(stagedAbs)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      let hasMarkdown = false

      try {
        hasMarkdown = stagedDirHasMarkdown(stagedAbs)
      } catch {
        hasMarkdown = false
      }

      if (!hasMarkdown) continue
      seen.add(sel.rel)
      roots.push({ path: sel.rel, kind: "directory" })
    } else if (stat.isFile()) {
      if (!isMarkdownPath(sel.rel)) continue
      seen.add(sel.rel)
      roots.push({ path: sel.rel, kind: "markdown" })
    }
  }

  return roots
}

/**
 * Build the authoritative set of realpaths that may be published: every
 * selection plus everything inside selected directories. Symlinks encountered
 * while staging must resolve inside this set or the build is rejected.
 */
function buildSelectedSet(selections) {
  const files = []
  const dirs = []

  for (const sel of selections) {
    if (sel.isDir) dirs.push(sel.real)
    else files.push(sel.real)
  }

  return {
    contains(real) {
      return files.includes(real) || dirs.some((dir) => isInside(dir, real))
    },
  }
}

/** Recursively copy a selection into the staging content directory. */
function stageSelection(sel, contentRoot, selectedSet, staged) {
  const walk = (srcReal, destRel) => {
    const stat = fs.lstatSync(srcReal)
    const destAbs = path.join(contentRoot, destRel)

    if (stat.isSymbolicLink()) {
      let targetReal

      try {
        targetReal = fs.realpathSync(srcReal)
      } catch {
        fail(`symlink at "${destRel}" is broken and cannot be staged`)

        return
      }

      if (!selectedSet.contains(targetReal)) {
        fail(
          `symlink at "${sel.rel}" resolves to "${targetReal}", which is outside the ` +
            `allowlisted content; rejecting as a symlink escape`,
        )

        return
      }

      walk(targetReal, destRel)

      return
    }

    if (staged.has(destRel)) return

    if (stat.isDirectory()) {
      // Never carry Git repository metadata inside published content.
      if (path.basename(destRel) === ".git") return
      staged.add(destRel)
      fs.mkdirSync(destAbs, { recursive: true })

      for (const entry of fs.readdirSync(srcReal)) {
        walk(path.join(srcReal, entry), path.posix.join(destRel, entry))
      }

      return
    }

    if (stat.isFile()) {
      fs.mkdirSync(path.dirname(destAbs), { recursive: true })
      fs.copyFileSync(srcReal, destAbs)
      fs.chmodSync(destAbs, stat.mode & 0o777)
      staged.add(destRel)

      return
    }

    fail(
      `selection "${sel.rel}" contains unsupported entry "${destRel}" (not a file, directory, or symlink)`,
    )
  }

  walk(sel.real, sel.rel)
}

/** Write a synthetic landing page when the selected content has no root index. */
function maybeGenerateLandingPage(contentDir, selections, title, yaml) {
  if (fs.existsSync(path.join(contentDir, "index.md"))) {
    console.log("  ✓ selected content provides a root index.md; no landing page generated")

    return
  }

  const lines = [
    "---",
    yaml.stringify({ title, synthetic: true }).trimEnd(),
    "---",
    ``,
    `# ${title}`,
    ``,
    `Browse the published content of this Knowledge Base.`,
    ``,
  ]

  for (const sel of selections) {
    const slug = sel.isDir ? sel.rel : sel.rel.replace(/\.md$/, "")
    lines.push(`- [[${slug}]]`)
  }

  lines.push(``)
  fs.writeFileSync(path.join(contentDir, "index.md"), lines.join("\n"))
  console.log("  ✓ generated synthetic landing page content/index.md (no selected root index)")
}

/**
 * Emit deterministic generated site identity outside the staged content tree.
 * The file carries only the manifest title, canonical hostname, resolved
 * navigation roots, and explicitly declared projection destinations, with
 * stable key order and formatting. It never modifies
 * a tracked config file. Navigation entries carry relative public paths only;
 * destinations carry explicit display names plus absolute secure HTTPS
 * origins only.
 */
function writeSiteIdentity(
  identityFile,
  title,
  canonicalHostname,
  navigationRoots,
  destinationRoots = [],
) {
  const payload = {
    title: title.trim(),
    canonicalHostname: canonicalHostname.trim(),
    navigation: navigationRoots.map((root) => ({ path: root.path, kind: root.kind })),
    destinations: destinationRoots.map((dest) => ({ name: dest.name, origin: dest.origin })),
  }

  const body = `${JSON.stringify(payload, null, 2)}\n`
  const tmpFile = `${identityFile}.staging-${process.pid}`
  fs.mkdirSync(path.dirname(identityFile), { recursive: true })
  fs.writeFileSync(tmpFile, body)
  fs.renameSync(tmpFile, identityFile)
  const rel = path.relative(process.cwd(), identityFile)
  console.log(
    `  ✓ emitted site identity (${payload.title} @ ${payload.canonicalHostname}) to ${rel || identityFile}`,
  )
}

function countFiles(dir) {
  let count = 0

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    count += entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1
  }

  return count
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (!args.kbRoot) {
    fail("--kb-root is required (absolute path to the Knowledge Base root)")
  }

  const kbRoot = args.kbRoot ? path.resolve(args.kbRoot) : null

  const manifestPath = args.manifest
    ? path.resolve(args.manifest)
    : kbRoot
      ? path.join(kbRoot, DEFAULT_MANIFEST_NAME)
      : null

  const contentDir = args.contentDir
    ? path.resolve(args.contentDir)
    : path.join(PUBLISHER_ROOT, "content")

  const identityFile = args.identityFile
    ? path.resolve(args.identityFile)
    : path.join(PUBLISHER_ROOT, "site-identity.json")

  if (!fs.existsSync(kbRoot)) {
    fail(`Knowledge Base root does not exist: ${kbRoot}`)
  }

  const yaml = await loadYaml()
  const manifest = yaml ? readManifest(manifestPath, yaml) : null
  const kbRootReal = kbRoot && fs.existsSync(kbRoot) ? fs.realpathSync(kbRoot) : null
  const selections = manifest ? validateManifest(manifest, kbRootReal) : []
  const navigationRequest = manifest ? parseNavigation(manifest, selections) : null

  const destinationsRequest = manifest
    ? parseDestinations(manifest, manifest.canonicalHostname)
    : null

  // The build content directory must never live inside the Knowledge Base:
  // staging into it would mutate canonical content or recurse into itself.
  if (kbRoot && contentDir && kbRootReal) {
    const parentReal = fs.realpathSync(path.dirname(contentDir))
    const contentReal = path.join(parentReal, path.basename(contentDir))

    if (isInside(kbRootReal, contentReal)) {
      fail(`content directory ${contentDir} must not be inside the Knowledge Base root ${kbRoot}`)
    }
  }

  // Generated site identity must live outside the staged content tree and
  // outside the Knowledge Base, and must never overwrite tracked config.
  if (kbRootReal) {
    const identityParent = path.dirname(identityFile)
    let identityParentReal

    try {
      identityParentReal = fs.realpathSync(identityParent)
    } catch {
      identityParentReal = path.resolve(identityParent)
    }

    const identityReal = path.join(identityParentReal, path.basename(identityFile))

    if (isInside(kbRootReal, identityReal)) {
      fail(
        `site identity file ${identityFile} must not be inside the Knowledge Base root ${kbRoot}`,
      )
    }

    if (identityReal === TRACKED_RUNTIME_CONFIG) {
      fail(`site identity file must not overwrite the tracked runtime configuration`)
    }
  }

  if (identityFile === contentDir || identityFile.startsWith(contentDir + path.sep)) {
    fail(`site identity file ${identityFile} must be outside the staged content tree ${contentDir}`)
  }

  if (errors.length > 0) die()

  console.log(`✓ Publication Manifest ${path.basename(manifestPath)} valid:`)
  console.log(`    title:             ${manifest.title}`)
  console.log(`    canonicalHostname: ${manifest.canonicalHostname}`)
  console.log(`    selections:        ${selections.map((s) => s.rel).join(", ")}`)

  if (navigationRequest?.explicit) {
    console.log(`    navigation:        ${navigationRequest.entries.map((e) => e.rel).join(", ")}`)
  }

  if (destinationsRequest?.explicit) {
    console.log(
      `    destinations:      ${destinationsRequest.entries.map((e) => `${e.name} (${e.origin})`).join(", ")}`,
    )
  }

  // Stage into a temporary directory first so a failure never leaves a
  // partial build content tree behind.
  const stagingDir = `${contentDir}.staging-${process.pid}`
  fs.rmSync(stagingDir, { recursive: true, force: true })
  fs.mkdirSync(stagingDir, { recursive: true })

  try {
    const selectedSet = buildSelectedSet(selections)
    const staged = new Set()

    for (const sel of selections) stageSelection(sel, stagingDir, selectedSet, staged)
  } catch (error) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    fail(`staging failed: ${error.message}`)
  }

  if (errors.length > 0) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    die()
  }

  // Validate navigation against the temporary staged tree before the atomic
  // swap so a failure never leaves a partial replacement behind.
  let navigationRoots = []

  if (navigationRequest) {
    if (navigationRequest.explicit) {
      navigationRoots = resolveExplicitNavigation(stagingDir, navigationRequest.entries)
    } else {
      navigationRoots = deriveNavigation(stagingDir, selections)
    }
  }

  if (errors.length > 0) {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    die()
  }

  // Declared destinations are presentation links only: they map to the
  // validated entries in manifest order and never touch staged content.
  let destinationRoots = []

  if (destinationsRequest?.explicit) {
    destinationRoots = destinationsRequest.entries.map((entry) => ({
      name: entry.name,
      origin: entry.origin,
    }))
  }

  // Swap the fully staged tree into place.
  fs.rmSync(contentDir, { recursive: true, force: true })
  fs.renameSync(stagingDir, contentDir)
  console.log(`  ✓ staged ${countFiles(contentDir)} files into ${contentDir}`)

  maybeGenerateLandingPage(contentDir, selections, manifest.title, yaml)
  writeSiteIdentity(
    identityFile,
    manifest.title,
    manifest.canonicalHostname,
    navigationRoots,
    destinationRoots,
  )

  console.log(
    "✓ staging complete; staged content plus generated site identity are ready for the reader build",
  )
}

main().catch((error) => {
  console.error(`✗ staging failed: ${error.message}`)
  process.exit(1)
})
