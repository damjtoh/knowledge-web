/**
 * Focused contract tests for the Knowledge Web Publisher staging entrypoint.
 *
 * These tests exercise the public Publication Manifest contract boundary only:
 * successful staging with byte preservation, landing page generation, and
 * rejection of missing, nonexistent, absolute, traversing, out-of-root, and
 * symlink-escaping selections before any partial build output exists.
 *
 * Run with: npm ci && node --test tests/
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test, after } from "node:test"

const execFileAsync = promisify(execFile)
const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")
const STAGE_SCRIPT = path.join(PUBLISHER_ROOT, "scripts", "stage-content.mjs")
const TRACKED_CONFIG = path.join(PUBLISHER_ROOT, "quartz.config.yaml")

// Captured before any test runs: staging must never modify the tracked
// quartz.config.yaml (tests use isolated temporary copies).
const trackedConfigHashBefore = sha256(TRACKED_CONFIG)

const tmpRoots = []

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kw-test-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

/** Build a synthetic Knowledge Base; returns its root path. */
function makeKb({ withIndex = false, symlinkEscape = false, dirSymlinkEscape = false } = {}) {
  const kb = tmpdir("kb")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })

  const note = [
    "---",
    "type: Note",
    "status: Active",
    'related_to: "[[about]]"',
    "---",
    "",
    "# Project Alpha",
    "",
    "A synthetic note for Publisher tests. See [[about]] for context.",
    "",
  ].join("\n")
  fs.writeFileSync(path.join(kb, "notes", "project-alpha.md"), note)

  const beta = "# Project Beta\n\nSecond synthetic note.\n"
  fs.writeFileSync(path.join(kb, "notes", "project-beta.md"), beta)

  const about = ["---", "type: Note", "---", "", "# About", "", "Synthetic about page.\n"].join(
    "\n",
  )
  fs.writeFileSync(path.join(kb, "about.md"), about)

  fs.writeFileSync(path.join(kb, "unselected.md"), "# Unselected\n\nMust never appear.\n")
  fs.mkdirSync(path.join(kb, "secret"), { recursive: true })
  fs.writeFileSync(path.join(kb, "secret", "private.md"), "# Private\n\nMust never appear.\n")

  if (withIndex) {
    fs.writeFileSync(
      path.join(kb, "index.md"),
      ["---", "title: Authored Index", "---", "", "# Authored Index", ""].join("\n"),
    )
  }
  if (symlinkEscape) {
    const outside = path.join(tmpdir("outside"), "outside.md")
    fs.writeFileSync(outside, "# Outside\n\nOutside the Knowledge Base.\n")
    fs.symlinkSync(outside, path.join(kb, "escape.md"))
  }
  if (dirSymlinkEscape) {
    const outside = path.join(tmpdir("outside2"), "outside.md")
    fs.writeFileSync(outside, "# Outside\n\nOutside the Knowledge Base.\n")
    fs.symlinkSync(outside, path.join(kb, "notes", "leak.md"))
  }
  return kb
}

function writeManifest(kb, manifest) {
  fs.writeFileSync(path.join(kb, "publication.manifest.yaml"), manifest)
}

function runStage(args) {
  return execFileAsync(process.execPath, [STAGE_SCRIPT, ...args], {
    cwd: PUBLISHER_ROOT,
    env: { ...process.env, NODE_PATH: path.join(PUBLISHER_ROOT, "node_modules") },
  })
}

const validManifest = `title: Example Garden
canonicalHostname: garden.example.com
select:
  - notes
  - about.md
`

/**
 * Run staging with an isolated build tree: the content directory and the
 * generated site identity file are always temporary paths, so tests can never
 * write into (or mutate) the Publisher's own tracked files.
 */
async function stageValid(kb, { contentDir, identityFile } = {}) {
  const tempRoot = tmpdir("stage")
  const resolvedContent = contentDir ?? path.join(tempRoot, "content")
  const resolvedIdentity = identityFile ?? path.join(tempRoot, "site-identity.json")
  const args = [
    "--kb-root",
    kb,
    "--content-dir",
    resolvedContent,
    "--identity-file",
    resolvedIdentity,
  ]
  const result = await runStage(args)
  return { result, contentDir: resolvedContent, identityFile: resolvedIdentity }
}

after(() => {
  // Staging must never mutate the Publisher's tracked config: every test
  // uses an isolated temporary copy, so the tracked file must be unchanged.
  assert.equal(sha256(TRACKED_CONFIG), trackedConfigHashBefore)
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

test("stages only selected content with byte preservation and a synthetic landing page", async () => {
  const kb = makeKb()
  writeManifest(kb, validManifest)
  const contentDir = path.join(tmpdir("out"), "content")

  const { result } = await stageValid(kb, { contentDir })
  const { stdout } = result

  assert.match(stdout, /generated synthetic landing page content\/index\.md/)
  assert.equal(
    sha256(path.join(contentDir, "notes", "project-alpha.md")),
    sha256(path.join(kb, "notes", "project-alpha.md")),
  )
  assert.equal(sha256(path.join(contentDir, "about.md")), sha256(path.join(kb, "about.md")))
  assert.ok(fs.existsSync(path.join(contentDir, "notes", "project-beta.md")))

  assert.ok(
    !fs.existsSync(path.join(contentDir, "unselected.md")),
    "unselected file must not be staged",
  )
  assert.ok(
    !fs.existsSync(path.join(contentDir, "secret")),
    "unselected directory must not be staged",
  )

  const landing = fs.readFileSync(path.join(contentDir, "index.md"), "utf8")
  assert.match(landing, /# Example Garden/)
  assert.match(landing, /\[\[notes\]\]/)
  assert.match(landing, /\[\[about\]\]/)
})

test("keeps an authored root index instead of generating a landing page", async () => {
  const kb = makeKb({ withIndex: true })
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - index.md\n  - about.md\n`,
  )
  const contentDir = path.join(tmpdir("out"), "content")

  const { result } = await stageValid(kb, { contentDir })
  const { stdout } = result
  assert.match(stdout, /provides a root index\.md; no landing page generated/)
  assert.equal(sha256(path.join(contentDir, "index.md")), sha256(path.join(kb, "index.md")))
})

test("emits deterministic generated site identity outside the staged content tree", async () => {
  const kb = makeKb()
  writeManifest(kb, validManifest)
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")

  const { result } = await stageValid(kb, { contentDir, identityFile })
  assert.match(result.stdout, /emitted site identity/)

  assert.ok(fs.existsSync(identityFile), "site identity file must exist")
  const raw = fs.readFileSync(identityFile, "utf8")
  const parsed = JSON.parse(raw)
  assert.deepEqual(Object.keys(parsed), ["title", "canonicalHostname", "navigation"])
  assert.equal(parsed.title, "Example Garden")
  assert.equal(parsed.canonicalHostname, "garden.example.com")
  // Derived navigation follows select order: notes directory then about.md.
  assert.deepEqual(parsed.navigation, [
    { path: "notes", kind: "directory" },
    { path: "about.md", kind: "markdown" },
  ])
  for (const entry of parsed.navigation) {
    assert.deepEqual(Object.keys(entry), ["path", "kind"])
    assert.ok(!path.isAbsolute(entry.path), "navigation paths stay relative")
    assert.ok(!entry.path.includes(".."), "navigation paths never traverse")
    assert.ok(!entry.path.includes("\\"), "navigation paths use forward slashes")
  }
  // Deterministic formatting: stable key order, 2-space indent, trailing newline.
  assert.equal(raw, `${JSON.stringify(parsed, null, 2)}\n`)

  // Outside the staged content tree: not inside contentDir and not staged as content.
  assert.ok(
    !identityFile.startsWith(`${contentDir}${path.sep}`),
    "identity must live outside the staged content tree",
  )
  assert.ok(!fs.existsSync(path.join(contentDir, "site-identity.json")))

  // Deterministic across runs: staging again produces byte-identical identity.
  const secondRoot = tmpdir("out2")
  const secondContent = path.join(secondRoot, "content")
  const secondIdentity = path.join(secondRoot, "site-identity.json")
  await stageValid(kb, { contentDir: secondContent, identityFile: secondIdentity })
  assert.equal(
    sha256(secondIdentity),
    sha256(identityFile),
    "site identity must be deterministic across runs",
  )
})

test("leaves the tracked Quartz configuration byte-identical after staging", async () => {
  const kb = makeKb()
  writeManifest(kb, validManifest)
  const contentDir = path.join(tmpdir("out"), "content")
  const identityFile = path.join(tmpdir("out"), "site-identity.json")

  const before = sha256(TRACKED_CONFIG)
  await stageValid(kb, { contentDir, identityFile })

  assert.equal(sha256(TRACKED_CONFIG), before, "tracked config must be unchanged after staging")
  assert.equal(
    sha256(TRACKED_CONFIG),
    trackedConfigHashBefore,
    "tracked config must match pre-test hash",
  )
  const tracked = fs.readFileSync(TRACKED_CONFIG, "utf8")
  assert.match(tracked, /pageTitle: Knowledge Web/, "tracked config stays generic")
  assert.match(tracked, /baseUrl: localhost/, "tracked hostname stays generic")
  assert.ok(!tracked.includes("Shared Vault"), "no staging residue in tracked config")
  assert.ok(!tracked.includes("shared.dami.dev"), "no staging hostname in tracked config")
})

test("rejects legacy --config-file without mutating tracked configuration", async () => {
  const kb = makeKb()
  writeManifest(kb, validManifest)
  const contentDir = path.join(tmpdir("out"), "content")
  const legacyConfig = path.join(tmpdir("out"), "quartz.config.yaml")
  fs.copyFileSync(TRACKED_CONFIG, legacyConfig)

  const before = sha256(TRACKED_CONFIG)
  let failed = false
  try {
    await runStage(["--kb-root", kb, "--content-dir", contentDir, "--config-file", legacyConfig])
  } catch (error) {
    failed = true
    assert.match(error.stderr, /--config-file is no longer supported/)
  }
  assert.ok(failed, "legacy --config-file must be rejected")
  assert.equal(sha256(TRACKED_CONFIG), before, "tracked config unchanged on legacy rejection")
  assert.ok(!fs.existsSync(contentDir), "no partial content on legacy rejection")
})

test("rejects a site identity file inside the staged content tree or Knowledge Base", async () => {
  const kb = makeKb()
  writeManifest(kb, validManifest)
  const contentDir = path.join(tmpdir("out"), "content")

  const insideContent = path.join(contentDir, "site-identity.json")
  let failedContent = false
  try {
    await runStage(["--kb-root", kb, "--content-dir", contentDir, "--identity-file", insideContent])
  } catch (error) {
    failedContent = true
    assert.match(error.stderr, /outside the staged content tree/)
  }
  assert.ok(failedContent, "identity inside content tree must be rejected")

  const insideKb = path.join(kb, "site-identity.json")
  let failedKb = false
  try {
    await runStage([
      "--kb-root",
      kb,
      "--content-dir",
      path.join(tmpdir("out2"), "content"),
      "--identity-file",
      insideKb,
    ])
  } catch (error) {
    failedKb = true
    assert.match(error.stderr, /must not be inside the Knowledge Base root/)
  }
  assert.ok(failedKb, "identity inside KB root must be rejected")
})

async function expectRejection(kb, contentDir, label, messagePattern) {
  let failed = false
  try {
    await stageValid(kb, { contentDir })
  } catch (error) {
    failed = true
    assert.match(error.stderr, messagePattern)
  }
  assert.ok(failed, `expected rejection: ${label}`)
  assert.ok(!fs.existsSync(contentDir), `no partial output for: ${label}`)
}

test("rejects a missing manifest file", async () => {
  const kb = makeKb() // no manifest written
  await expectRejection(
    kb,
    path.join(tmpdir("out"), "content"),
    "missing manifest",
    /Publication Manifest not found/,
  )
})

test("rejects a missing site title", async () => {
  const kb = makeKb()
  writeManifest(kb, `canonicalHostname: garden.example.com\nselect:\n  - notes\n`)
  await expectRejection(
    kb,
    path.join(tmpdir("out"), "content"),
    "missing title",
    /requires a site title/,
  )
})

test("rejects a missing or invalid canonical hostname", async () => {
  const kb1 = makeKb()
  writeManifest(kb1, `title: Example Garden\nselect:\n  - notes\n`)
  await expectRejection(
    kb1,
    path.join(tmpdir("out"), "content"),
    "missing hostname",
    /requires a canonical hostname/,
  )

  const kb2 = makeKb()
  writeManifest(
    kb2,
    `title: Example Garden\ncanonicalHostname: https://garden.example.com\nselect:\n  - notes\n`,
  )
  await expectRejection(
    kb2,
    path.join(tmpdir("out2"), "content"),
    "scheme hostname",
    /not a valid hostname/,
  )
})

test("rejects a missing or empty allowlist", async () => {
  const kb1 = makeKb()
  writeManifest(kb1, `title: Example Garden\ncanonicalHostname: garden.example.com\n`)
  await expectRejection(
    kb1,
    path.join(tmpdir("out"), "content"),
    "missing select",
    /explicit content allowlist/,
  )

  const kb2 = makeKb()
  writeManifest(kb2, `title: Example Garden\ncanonicalHostname: garden.example.com\nselect: []\n`)
  await expectRejection(
    kb2,
    path.join(tmpdir("out2"), "content"),
    "empty select",
    /explicit content allowlist/,
  )
})

test("rejects a nonexistent selection", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - missing.md\n`,
  )
  await expectRejection(kb, path.join(tmpdir("out"), "content"), "nonexistent", /does not exist/)
})

test("rejects an absolute selection", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - /etc/passwd\n`,
  )
  await expectRejection(kb, path.join(tmpdir("out"), "content"), "absolute", /absolute path/)
})

test("rejects a parent-traversing selection", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - ../secret\n`,
  )
  await expectRejection(kb, path.join(tmpdir("out"), "content"), "traversal", /traverses above/)
})

test("rejects a selection that is a symlink escaping the root", async () => {
  const kb = makeKb({ symlinkEscape: true })
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - escape.md\n`,
  )
  await expectRejection(
    kb,
    path.join(tmpdir("out"), "content"),
    "symlink escape",
    /outside the Knowledge Base root/,
  )
})

test("rejects a symlink inside a selected directory that escapes the allowlist", async () => {
  const kb = makeKb({ dirSymlinkEscape: true })
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n`,
  )
  await expectRejection(
    kb,
    path.join(tmpdir("out"), "content"),
    "nested symlink escape",
    /symlink escape/,
  )
})

test("rejects a mixed valid+invalid allowlist before producing any output", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n  - ../secret\n`,
  )
  await expectRejection(
    kb,
    path.join(tmpdir("out"), "content"),
    "mixed allowlist",
    /traverses above/,
  )
})

test("rejects selecting the Git directory", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - .git\n`,
  )
  await expectRejection(kb, path.join(tmpdir("out"), "content"), "git selection", /Git directory/)
})

test("rejects a content directory inside the Knowledge Base root", async () => {
  const kb = makeKb()
  writeManifest(kb, validManifest)
  const inside = path.join(kb, "site-output")
  let failed = false
  try {
    await stageValid(kb, { contentDir: inside })
  } catch (error) {
    failed = true
    assert.match(error.stderr, /must not be inside the Knowledge Base root/)
  }
  assert.ok(failed, "expected rejection: content dir inside KB root")
})

/** Read generated navigation roots from an identity file. */
function readNavigation(identityFile) {
  const parsed = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  return parsed.navigation
}

/** Add an asset-only directory (no Markdown) to a synthetic Knowledge Base. */
function addAssetDir(kb, name = "assets") {
  const dir = path.join(kb, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "logo.png"), "fake-png-bytes")
  return name
}

async function expectNavigationRejection(kb, manifestText, label, messagePattern) {
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")
  writeManifest(kb, manifestText)
  let failed = false
  try {
    await stageValid(kb, { contentDir, identityFile })
  } catch (error) {
    failed = true
    assert.match(error.stderr, messagePattern)
  }
  assert.ok(failed, `expected navigation rejection: ${label}`)
  assert.ok(!fs.existsSync(contentDir), `no partial content for: ${label}`)
  assert.ok(!fs.existsSync(identityFile), `no partial identity for: ${label}`)
  assert.ok(
    !fs.existsSync(`${contentDir}.staging-${process.pid}`),
    `no leftover staging dir for: ${label}`,
  )
}

test("emits explicit navigation in manifest order with normalized paths and kinds", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n  - about.md\nnavigation:\n  - ./about.md\n  - notes//\n`,
  )
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")
  await stageValid(kb, { contentDir, identityFile })
  // Explicit order differs from select order; paths normalize like select.
  assert.deepEqual(readNavigation(identityFile), [
    { path: "about.md", kind: "markdown" },
    { path: "notes", kind: "directory" },
  ])
  const parsed = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  assert.deepEqual(Object.keys(parsed), ["title", "canonicalHostname", "navigation"])
  for (const entry of parsed.navigation) assert.deepEqual(Object.keys(entry), ["path", "kind"])
})

test("derives navigation from select order when navigation is absent", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - about.md\n  - notes\n`,
  )
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")
  await stageValid(kb, { contentDir, identityFile })
  assert.deepEqual(readNavigation(identityFile), [
    { path: "about.md", kind: "markdown" },
    { path: "notes", kind: "directory" },
  ])
})

test("derived navigation filters asset-only selections", async () => {
  const kb = makeKb()
  addAssetDir(kb, "assets")
  fs.writeFileSync(path.join(kb, "logo.png"), "fake-png-bytes")
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - assets\n  - logo.png\n  - notes\n  - about.md\n`,
  )
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")
  await stageValid(kb, { contentDir, identityFile })
  // Asset-only directory and file selections stay staged but never become roots.
  assert.ok(fs.existsSync(path.join(contentDir, "assets", "logo.png")))
  assert.ok(fs.existsSync(path.join(contentDir, "logo.png")))
  assert.deepEqual(readNavigation(identityFile), [
    { path: "notes", kind: "directory" },
    { path: "about.md", kind: "markdown" },
  ])
})

test("emits deterministic navigation with relative public paths only", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n  - about.md\nnavigation:\n  - about.md\n  - notes\n`,
  )
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")
  await stageValid(kb, { contentDir, identityFile })
  const raw = fs.readFileSync(identityFile, "utf8")
  const parsed = JSON.parse(raw)
  assert.deepEqual(Object.keys(parsed), ["title", "canonicalHostname", "navigation"])
  assert.equal(raw, `${JSON.stringify(parsed, null, 2)}\n`)
  for (const entry of parsed.navigation) {
    assert.deepEqual(Object.keys(entry), ["path", "kind"])
    assert.ok(!path.isAbsolute(entry.path))
    assert.ok(!entry.path.includes(kb))
    assert.ok(!entry.path.includes(".."))
  }
  assert.ok(!raw.includes(kb), "identity must not leak the Knowledge Base root")
  const secondRoot = tmpdir("out2")
  const secondContent = path.join(secondRoot, "content")
  const secondIdentity = path.join(secondRoot, "site-identity.json")
  await stageValid(kb, { contentDir: secondContent, identityFile: secondIdentity })
  assert.equal(sha256(secondIdentity), sha256(identityFile))
})

test("rejects navigation outside the allowlist", async () => {
  const kb = makeKb()
  await expectNavigationRejection(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation:\n  - about.md\n`,
    "outside allowlist",
    /not covered by the allowlist/,
  )
})

test("rejects duplicate normalized navigation entries", async () => {
  const kb = makeKb()
  await expectNavigationRejection(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n  - about.md\nnavigation:\n  - notes\n  - notes/\n`,
    "normalized duplicates",
    /duplicates/,
  )
})

test("rejects unsafe navigation paths with select safety rules", async () => {
  const kbAbsolute = makeKb()
  await expectNavigationRejection(
    kbAbsolute,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation:\n  - /etc/passwd\n`,
    "absolute navigation",
    /absolute path/,
  )
  const kbTraversal = makeKb()
  await expectNavigationRejection(
    kbTraversal,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation:\n  - ../secret\n`,
    "traversing navigation",
    /traverses above/,
  )
  const kbGit = makeKb()
  await expectNavigationRejection(
    kbGit,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation:\n  - .git\n`,
    "git navigation",
    /Git directory/,
  )
})

test("rejects invalid navigation shape and empty entries", async () => {
  const kbEmpty = makeKb()
  await expectNavigationRejection(
    kbEmpty,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation: []\n`,
    "empty navigation",
    /non-empty list/,
  )
  const kbString = makeKb()
  await expectNavigationRejection(
    kbString,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation: notes\n`,
    "non-list navigation",
    /non-empty list/,
  )
  const kbBlank = makeKb()
  await expectNavigationRejection(
    kbBlank,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation:\n  - ""\n`,
    "empty-string navigation",
    /non-empty string/,
  )
})

test("rejects navigation entries missing from the staged tree", async () => {
  const kb = makeKb()
  await expectNavigationRejection(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation:\n  - notes/missing.md\n`,
    "missing staged path",
    /does not exist in the staged tree/,
  )
})

test("rejects explicit non-Markdown navigation files", async () => {
  const kb = makeKb()
  addAssetDir(kb, "assets")
  await expectNavigationRejection(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - assets\n  - notes\nnavigation:\n  - assets/logo.png\n`,
    "non-Markdown file",
    /not a Markdown file/,
  )
})

test("rejects navigation directories without staged Markdown descendants", async () => {
  const kb = makeKb()
  addAssetDir(kb, "assets")
  await expectNavigationRejection(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - assets\n  - notes\nnavigation:\n  - assets\n`,
    "asset-only directory",
    /no staged Markdown/,
  )
})

test("navigation failure leaves no partial replacement over prior output", async () => {
  const kb = makeKb()
  writeManifest(kb, validManifest)
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")
  await stageValid(kb, { contentDir, identityFile })
  const contentHashBefore = sha256(path.join(contentDir, "about.md"))
  const identityBefore = fs.readFileSync(identityFile, "utf8")
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\nnavigation:\n  - about.md\n`,
  )
  let failed = false
  try {
    await stageValid(kb, { contentDir, identityFile })
  } catch (error) {
    failed = true
    assert.match(error.stderr, /not covered by the allowlist/)
  }
  assert.ok(failed, "expected navigation rejection over prior output")
  assert.equal(sha256(path.join(contentDir, "about.md")), contentHashBefore)
  assert.equal(fs.readFileSync(identityFile, "utf8"), identityBefore)
})
