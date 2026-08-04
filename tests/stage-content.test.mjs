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
 * Quartz config file are always temporary copies, so tests can never write
 * into (or mutate) the Publisher's own tracked files.
 */
async function stageValid(kb, { contentDir, configFile } = {}) {
  const tempRoot = tmpdir("stage")
  const args = [
    "--kb-root",
    kb,
    "--content-dir",
    contentDir ?? path.join(tempRoot, "content"),
    "--config-file",
    configFile ?? path.join(tempRoot, "quartz.config.yaml"),
  ]
  if (!configFile) {
    fs.copyFileSync(TRACKED_CONFIG, args[args.indexOf("--config-file") + 1])
  }
  return runStage(args)
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

  const { stdout } = await stageValid(kb, { contentDir })

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

  const { stdout } = await stageValid(kb, { contentDir })
  assert.match(stdout, /provides a root index\.md; no landing page generated/)
  assert.equal(sha256(path.join(contentDir, "index.md")), sha256(path.join(kb, "index.md")))
})

test("injects manifest title and canonical hostname into the Quartz config", async () => {
  const kb = makeKb()
  writeManifest(kb, validManifest)
  const contentDir = path.join(tmpdir("out"), "content")
  const configFile = path.join(tmpdir("out"), "quartz.config.yaml")
  fs.copyFileSync(path.join(PUBLISHER_ROOT, "quartz.config.yaml"), configFile)

  await runStage(["--kb-root", kb, "--content-dir", contentDir, "--config-file", configFile])

  const { parse } = await import("yaml")
  const config = parse(fs.readFileSync(configFile, "utf8"))
  assert.equal(config.configuration.pageTitle, "Example Garden")
  assert.equal(config.configuration.baseUrl, "garden.example.com")
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
