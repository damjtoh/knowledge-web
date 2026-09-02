#!/usr/bin/env node
/**
 * Knowledge Web Publisher — Publication Manifest validation, content staging,
 * and site identity injection.
 *
 * This is the single build entrypoint consumers run before `npm run build`.
 * It:
 *   1. Loads and validates the Knowledge Base's Publication Manifest
 *      (site title, canonical hostname, explicit content allowlist).
 *   2. Rejects invalid manifests before any build output is produced:
 *      missing fields, empty allowlists, nonexistent selections, absolute
 *      paths, parent traversal, out-of-root selections, and symlink escapes.
 *   3. Copies ONLY allowlisted content, byte-for-byte, into an isolated
 *      build content directory. The Knowledge Base is never modified.
 *   4. Generates a synthetic landing page in the build tree only when the
 *      selected content has no root `index.md`.
 *   5. Injects the manifest title and canonical hostname into the shared
 *      Quartz configuration used by the build.
 *
 * Usage:
 *   node scripts/stage-content.mjs \
 *     --kb-root <Knowledge Base root> \
 *     [--manifest <path, default <kb-root>/publication.manifest.yaml>] \
 *     [--content-dir <path, default ./content>] \
 *     [--config-file <path, default ./quartz.config.yaml>]
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PUBLISHER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_MANIFEST_NAME = "publication.manifest.yaml"

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
  const args = { kbRoot: null, manifest: null, contentDir: null, configFile: null }
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
      case "--config-file":
        args.configFile = value
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
  if (typeof raw !== "string" || raw.trim() === "") {
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
    fail('the "yaml" package is required; run `npm ci` in the Publisher before staging')
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
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`Publication Manifest at ${manifestPath} must be a YAML mapping`)
    return null
  }
  return parsed
}

function validateManifest(manifest, kbRootReal) {
  const { title, canonicalHostname, select } = manifest

  if (typeof title !== "string" || title.trim() === "") {
    fail('manifest requires a site title (top-level "title")')
  }
  if (typeof canonicalHostname !== "string" || canonicalHostname.trim() === "") {
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
    yaml.stringify({ title, unlisted: true }).trimEnd(),
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

function injectSiteIdentity(configFile, title, canonicalHostname, yaml) {
  const config = yaml.parse(fs.readFileSync(configFile, "utf8"))
  config.configuration.pageTitle = title
  config.configuration.baseUrl = canonicalHostname
  fs.writeFileSync(configFile, yaml.stringify(config))
  const rel = path.relative(process.cwd(), configFile)
  console.log(
    `  ✓ injected site identity (${title} @ ${canonicalHostname}) into ${rel || configFile}`,
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
  const configFile = args.configFile
    ? path.resolve(args.configFile)
    : path.join(PUBLISHER_ROOT, "quartz.config.yaml")

  if (!fs.existsSync(kbRoot)) {
    fail(`Knowledge Base root does not exist: ${kbRoot}`)
  }
  if (!fs.existsSync(configFile)) {
    fail(`Quartz config file does not exist: ${configFile}`)
  }

  const yaml = await loadYaml()
  const manifest = yaml ? readManifest(manifestPath, yaml) : null
  const kbRootReal = kbRoot && fs.existsSync(kbRoot) ? fs.realpathSync(kbRoot) : null
  const selections = manifest ? validateManifest(manifest, kbRootReal) : []

  // The build content directory must never live inside the Knowledge Base:
  // staging into it would mutate canonical content or recurse into itself.
  if (kbRoot && contentDir && kbRootReal) {
    const parentReal = fs.realpathSync(path.dirname(contentDir))
    const contentReal = path.join(parentReal, path.basename(contentDir))
    if (isInside(kbRootReal, contentReal)) {
      fail(`content directory ${contentDir} must not be inside the Knowledge Base root ${kbRoot}`)
    }
  }

  if (errors.length > 0) die()

  console.log(`✓ Publication Manifest ${path.basename(manifestPath)} valid:`)
  console.log(`    title:             ${manifest.title}`)
  console.log(`    canonicalHostname: ${manifest.canonicalHostname}`)
  console.log(`    selections:        ${selections.map((s) => s.rel).join(", ")}`)

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

  // Swap the fully staged tree into place.
  fs.rmSync(contentDir, { recursive: true, force: true })
  fs.renameSync(stagingDir, contentDir)
  console.log(`  ✓ staged ${countFiles(contentDir)} files into ${contentDir}`)

  maybeGenerateLandingPage(contentDir, selections, manifest.title, yaml)
  injectSiteIdentity(configFile, manifest.title, manifest.canonicalHostname, yaml)

  console.log("✓ staging complete; run `npm run build` to emit the static site")
}

main().catch((error) => {
  console.error(`✗ staging failed: ${error.message}`)
  process.exit(1)
})
