/**
 * Focused contract tests for optional Publication Manifest destinations.
 *
 * Owners can optionally declare display names plus absolute secure HTTPS
 * origins for the reader projection switcher. Staging rejects malformed,
 * unsafe, duplicate, or current-origin destinations before producing any
 * output, and emits only the explicitly declared public-safe destinations
 * in generated identity. Legacy manifests without destinations still build
 * and emit an empty destination list. Destinations never broaden the
 * allowlist.
 *
 * Run with: node --test tests/stage-destinations.test.mjs
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

const TRACKED_CONFIG = path.join(PUBLISHER_ROOT, "nginx.conf")

const trackedConfigHashBefore = sha256(TRACKED_CONFIG)

const tmpRoots = []

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kw-dest-${prefix}-`))
  tmpRoots.push(dir)

  return dir
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

/** Build a small synthetic Knowledge Base; returns its root path. */
function makeKb() {
  const kb = tmpdir("kb")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.writeFileSync(path.join(kb, "notes", "alpha.md"), "# Alpha\n\nFirst note.\n")
  fs.writeFileSync(path.join(kb, "notes", "beta.md"), "# Beta\n\nSecond note.\n")
  fs.writeFileSync(path.join(kb, "about.md"), "# About\n\nAbout page.\n")
  fs.writeFileSync(path.join(kb, "unselected.md"), "# Unselected\n\nMust never appear.\n")

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

async function stageKb(kb) {
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")

  await runStage(["--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile])

  return { contentDir, identityFile }
}

function readIdentity(identityFile) {
  return {
    raw: fs.readFileSync(identityFile, "utf8"),
    parsed: JSON.parse(fs.readFileSync(identityFile, "utf8")),
  }
}

async function expectDestinationsRejection(kb, manifestText, label, messagePattern) {
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")
  writeManifest(kb, manifestText)
  let failed = false

  try {
    await runStage(["--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile])
  } catch (error) {
    failed = true
    assert.match(error.stderr, messagePattern)
  }

  assert.ok(failed, `expected destinations rejection: ${label}`)
  assert.ok(!fs.existsSync(contentDir), `no partial content for: ${label}`)
  assert.ok(!fs.existsSync(identityFile), `no partial identity for: ${label}`)
}

after(() => {
  assert.equal(sha256(TRACKED_CONFIG), trackedConfigHashBefore)

  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

test("absent destinations emit an empty list and keep legacy navigation", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n  - about.md\n`,
  )
  const { contentDir, identityFile } = await stageKb(kb)
  const { raw, parsed } = readIdentity(identityFile)

  assert.deepEqual(Object.keys(parsed), [
    "title",
    "canonicalHostname",
    "navigation",
    "destinations",
  ])
  assert.deepEqual(parsed.destinations, [])
  assert.deepEqual(parsed.navigation, [
    { path: "notes", kind: "directory" },
    { path: "about.md", kind: "markdown" },
  ])
  assert.equal(raw, `${JSON.stringify(parsed, null, 2)}\n`)
  assert.ok(fs.existsSync(path.join(contentDir, "notes", "alpha.md")))
  assert.ok(!fs.existsSync(path.join(contentDir, "unselected.md")))
})

test("valid destinations emit normalized names and origins in manifest order", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n  - about.md\ndestinations:\n  - name: Personal Garden\n    origin: https://personal.example.com/\n  - name: Shared Garden\n    origin: https://shared.example.com\n`,
  )
  const { identityFile } = await stageKb(kb)
  const { raw, parsed } = readIdentity(identityFile)

  // Trailing-slash origin normalizes; manifest order is preserved.
  assert.deepEqual(parsed.destinations, [
    { name: "Personal Garden", origin: "https://personal.example.com" },
    { name: "Shared Garden", origin: "https://shared.example.com" },
  ])

  for (const entry of parsed.destinations) assert.deepEqual(Object.keys(entry), ["name", "origin"])

  assert.equal(raw, `${JSON.stringify(parsed, null, 2)}\n`)
  assert.ok(!raw.includes(fs.realpathSync(kb)), "identity never leaks the Knowledge Base root")

  // Deterministic across runs.
  const secondKb = makeKb()
  writeManifest(
    secondKb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n  - about.md\ndestinations:\n  - name: Personal Garden\n    origin: https://personal.example.com/\n  - name: Shared Garden\n    origin: https://shared.example.com\n`,
  )
  const second = await stageKb(secondKb)
  assert.equal(sha256(second.identityFile), sha256(identityFile))
})

test("destinations never broaden the allowlist", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\n  - about.md\ndestinations:\n  - name: Personal Garden\n    origin: https://personal.example.com\n`,
  )
  const { contentDir, identityFile } = await stageKb(kb)
  const { raw, parsed } = readIdentity(identityFile)

  assert.ok(!fs.existsSync(path.join(contentDir, "unselected.md")))
  assert.deepEqual(parsed.navigation, [
    { path: "notes", kind: "directory" },
    { path: "about.md", kind: "markdown" },
  ])
  assert.ok(!raw.includes("unselected"), "identity carries only declared destinations")
  assert.equal(parsed.destinations.length, 1)
})

test("rejects invalid destinations shape and empty entries", async () => {
  const kbEmpty = makeKb()
  await expectDestinationsRejection(
    kbEmpty,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations: []\n`,
    "empty destinations",
    /non-empty list/,
  )
  const kbString = makeKb()
  await expectDestinationsRejection(
    kbString,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations: https://personal.example.com\n`,
    "non-list destinations",
    /non-empty list/,
  )
  const kbScalar = makeKb()
  await expectDestinationsRejection(
    kbScalar,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - https://personal.example.com\n`,
    "scalar entry",
    /must be a mapping/,
  )
  const kbNoName = makeKb()
  await expectDestinationsRejection(
    kbNoName,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - origin: https://personal.example.com\n`,
    "missing name",
    /non-empty display name/,
  )
  const kbBlankName = makeKb()
  await expectDestinationsRejection(
    kbBlankName,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - name: ""\n    origin: https://personal.example.com\n`,
    "empty name",
    /non-empty display name/,
  )
  const kbNoOrigin = makeKb()
  await expectDestinationsRejection(
    kbNoOrigin,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - name: Personal Garden\n`,
    "missing origin",
    /non-empty secure HTTPS origin/,
  )
})

test("rejects unsafe destination origins", async () => {
  const cases = [
    ["insecure scheme", "http://personal.example.com", /secure absolute HTTPS origin/],
    ["origin with path", "https://personal.example.com/notes", /secure absolute HTTPS origin/],
    ["origin with query", "https://personal.example.com/?x=1", /secure absolute HTTPS origin/],
    ["origin with fragment", "https://personal.example.com/#top", /secure absolute HTTPS origin/],
    [
      "origin with credentials",
      "https://user:pass@personal.example.com",
      /secure absolute HTTPS origin/,
    ],
    ["origin with port", "https://personal.example.com:8443", /secure absolute HTTPS origin/],
    ["relative origin", "/personal", /secure absolute HTTPS origin/],
    ["bare hostname", "personal.example.com", /secure absolute HTTPS origin/],
    ["single-label host", "https://personal", /secure absolute HTTPS origin/],
    ["origin with whitespace", "https://personal.example .com", /secure absolute HTTPS origin/],
  ]

  for (const [label, origin, pattern] of cases) {
    const kb = makeKb()
    await expectDestinationsRejection(
      kb,
      `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - name: Personal Garden\n    origin: ${origin}\n`,
      label,
      pattern,
    )
  }
})

test("rejects duplicate destinations and current-origin conflicts", async () => {
  const kbOrigins = makeKb()
  await expectDestinationsRejection(
    kbOrigins,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - name: Personal Garden\n    origin: https://personal.example.com\n  - name: Personal Mirror\n    origin: https://personal.example.com/\n`,
    "duplicate origins",
    /duplicates/,
  )
  const kbNames = makeKb()
  await expectDestinationsRejection(
    kbNames,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - name: Personal Garden\n    origin: https://personal.example.com\n  - name: Personal Garden\n    origin: https://shared.example.com\n`,
    "duplicate names",
    /more than once/,
  )
  const kbSelf = makeKb()
  await expectDestinationsRejection(
    kbSelf,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - name: Same Garden\n    origin: https://garden.example.com\n`,
    "current-origin conflict",
    /never lists itself/,
  )
  const kbSelfSlash = makeKb()
  await expectDestinationsRejection(
    kbSelfSlash,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - name: Same Garden\n    origin: https://GARDEN.example.com/\n`,
    "current-origin conflict after normalization",
    /never lists itself/,
  )
})

test("rejects mixed valid and invalid destinations before producing output", async () => {
  const kb = makeKb()
  writeManifest(
    kb,
    `title: Example Garden\ncanonicalHostname: garden.example.com\nselect:\n  - notes\ndestinations:\n  - name: Personal Garden\n    origin: https://personal.example.com\n  - name: Broken Garden\n    origin: http://broken.example.com\n`,
  )
  const outRoot = tmpdir("out")
  const contentDir = path.join(outRoot, "content")
  const identityFile = path.join(outRoot, "site-identity.json")
  let failed = false

  try {
    await runStage(["--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile])
  } catch (error) {
    failed = true
    assert.match(error.stderr, /secure absolute HTTPS origin/)
  }

  assert.ok(failed, "expected rejection: mixed destinations")
  assert.ok(!fs.existsSync(contentDir), "no partial content for mixed destinations")
  assert.ok(!fs.existsSync(identityFile), "no partial identity for mixed destinations")
})
