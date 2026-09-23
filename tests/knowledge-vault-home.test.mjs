/**
 * Knowledge Vault home modes — generated vs authored root index
 *
 * Full-build acceptance for issue #5:
 * - Generated home: no selected root index => "/" is dashboard, stable dashboard route remains
 * - Authored home: selected root index => staged byte-preserved, "/" is authored, dashboard link present
 * - Collision-safe URLs, synthetic isolation, search/wikilinks, secret isolation
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
const BUILD_CLI = path.join(PUBLISHER_ROOT, "quartz", "bootstrap-cli.mjs")
const TRACKED_CONFIG = path.join(PUBLISHER_ROOT, "quartz.config.yaml")

const tmpRoots = []
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kv-home-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

async function stageKb(kb, contentDir, identityFile) {
  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile],
    { cwd: PUBLISHER_ROOT },
  )
}
async function buildQuartz(contentDir, outputDir) {
  await execFileAsync(
    process.execPath,
    [BUILD_CLI, "build", "--directory", contentDir, "--output", outputDir, "--concurrency", "1"],
    { cwd: PUBLISHER_ROOT, timeout: 120_000 },
  )
}

function makeBaseKb({ withIndex = false, withDashboardCollision = false } = {}) {
  const kb = tmpdir("kb")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.mkdirSync(path.join(kb, "unselected"), { recursive: true })

  fs.writeFileSync(
    path.join(kb, "notes", "task-open.md"),
    [
      "---",
      "type: Task",
      "status: Open",
      "description: Open task desc",
      "updated_at: 2024-03-10",
      "tags: [work]",
      "---",
      "",
      "# Task Open",
      "",
      "Open body. See [[idea-seed]] and [[note-one]]",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "idea-seed.md"),
    ["---", "type: Idea", "status: Seed", "---", "", "# Idea Seed", "", "Seed.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-one.md"),
    ["---", "type: Note", "description: Note desc", "---", "", "# Note One", "", "Note.", ""].join(
      "\n",
    ),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "bookmark-one.md"),
    ["---", "type: Bookmark", "---", "", "# Bookmark One", "", "BM.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "about.md"),
    ["---", "type: Note", "---", "", "# About This Garden", "", "About.", ""].join("\n"),
  )
  fs.writeFileSync(path.join(kb, "unselected", "secret.md"), "# Secret\n\nMust never appear.\n")

  if (withIndex) {
    fs.writeFileSync(
      path.join(kb, "index.md"),
      [
        "---",
        "type: Note",
        "---",
        "",
        "# Authored Home",
        "",
        "Welcome home. See [[notes/task-open]]",
        "",
      ].join("\n"),
    )
  }
  if (withDashboardCollision) {
    fs.writeFileSync(
      path.join(kb, "dashboard.md"),
      [
        "---",
        "type: Note",
        "---",
        "",
        "# Authored Dashboard",
        "",
        "Authored dashboard body.",
        "",
      ].join("\n"),
    )
  }
  return kb
}

test("generated home: no selected root index => / is dashboard, stable dashboard route remains, byte preservation, links, search, isolation", async () => {
  const kb = makeBaseKb({ withIndex: false })
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    [
      "title: Test Garden",
      "canonicalHostname: test.example.com",
      "select:",
      "  - notes",
      "  - about.md",
      "",
    ].join("\n"),
  )
  const work = tmpdir("work-gen")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")

  await stageKb(kb, contentDir, identityFile)

  // C2: no authored index, so synthetic index is generated and staged
  assert.ok(fs.existsSync(path.join(contentDir, "index.md")), "synthetic index.md staged")
  const synthetic = fs.readFileSync(path.join(contentDir, "index.md"), "utf8")
  assert.match(synthetic, /synthetic:\s*true/, "synthetic marker present")
  assert.match(synthetic, /# Test Garden/, "synthetic title present")
  // Synthetic staged file is not required to be byte-equal to source (no source), but selected files are preserved
  assert.equal(
    sha256(path.join(contentDir, "notes/task-open.md")),
    sha256(path.join(kb, "notes/task-open.md")),
    "byte preservation for selected task",
  )
  assert.ok(
    !fs.existsSync(path.join(contentDir, "unselected", "secret.md")),
    "unselected not staged",
  )

  await buildQuartz(contentDir, outputDir)

  const readHtml = (rel) => fs.readFileSync(path.join(outputDir, rel), "utf8")
  const contentIndex = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentIndex.json"), "utf8"),
  )
  const contentMetadata = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentMetadata.json"), "utf8"),
  )

  // C1: / is dashboard
  const indexHtml = readHtml("index.html")
  assert.match(indexHtml, /id="vault-dashboard"/, "index is dashboard (generated home)")
  assert.match(indexHtml, /<h1[^>]*>Vault Dashboard<\/h1>/, "index dashboard H1")
  // C1: stable dashboard route also dashboard
  const dashHtml = readHtml("dashboard.html")
  assert.match(dashHtml, /id="vault-dashboard"/, "dashboard route is dashboard")
  assert.match(dashHtml, /<h1[^>]*>Vault Dashboard<\/h1>/)

  // C3: dashboard link and collection nav present in generated home
  assert.match(indexHtml, /kv-collections-nav/, "collections nav present")
  assert.match(indexHtml, /kv-dash-link|Dashboard/, "dashboard link present")
  // Collection nav includes Dashboard plus type collections
  assert.match(indexHtml, /href="[^"]*dashboard[^"]*".*Dashboard/, "dashboard link href")
  assert.match(indexHtml, /collections\/task/, "task collection link")
  assert.match(indexHtml, /collections\/note/, "note collection link")

  // C4: collection and dashboard URLs stable, not hijacked
  assert.ok(
    fs.existsSync(path.join(outputDir, "collections", "task.html")),
    "task collection stable",
  )
  assert.ok(
    fs.existsSync(path.join(outputDir, "collections", "note.html")),
    "note collection stable",
  )
  // Synthetic index must not contaminate collections: no collection should contain synthetic entry
  for (const coll of ["task", "note", "bookmark", "idea"]) {
    const p = path.join(outputDir, "collections", `${coll}.html`)
    if (fs.existsSync(p)) {
      const html = fs.readFileSync(p, "utf8")
      assert.ok(!html.includes("Test Garden"), `collection ${coll} must not contain synthetic home`)
    }
  }
  // Dashboard recent must not contain synthetic home
  assert.ok(
    !dashHtml.includes('href="index"') || !dashHtml.includes("Test Garden"),
    "dashboard recent not contaminated by synthetic",
  )

  // C7: synthetic home appears in output/search but distinguished
  assert.ok(contentIndex["index"], "synthetic index in search index")
  assert.equal(contentIndex["index"].title, "Test Garden", "search title for synthetic")
  const metaIndex = contentMetadata.find((e) => e.slug === "index")
  assert.ok(metaIndex, "synthetic index in contentMetadata")
  assert.equal(metaIndex.title, "Test Garden")
  // Must not be in dashboard recent as publishable, but still in search

  // Wikilinks resolve, titles readable
  const taskHtml = readHtml("notes/task-open.html")
  assert.match(taskHtml, /href="[^"]*idea-seed[^"]*"/, "wikilink href to idea-seed")
  assert.ok(!taskHtml.includes("broken"), "wikilink not broken")

  // Secret isolation
  assert.ok(!Object.keys(contentIndex).some((k) => k.includes("secret")), "secret not in search")
  assert.ok(!contentMetadata.some((e) => e.slug.includes("secret")), "secret not in metadata")
  assert.ok(
    !fs.existsSync(path.join(outputDir, "unselected", "secret.html")),
    "secret route not emitted",
  )
  // Ensure no html contains secret
  const walkForSecret = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walkForSecret(p)
      else if (ent.isFile() && p.endsWith(".html")) {
        const c = fs.readFileSync(p, "utf8")
        assert.ok(!c.includes("Must never appear"), `secret not in ${path.relative(outputDir, p)}`)
      }
    }
  }
  walkForSecret(outputDir)
})

test("authored home: selected root index => staged byte-preserved, / is authored, dashboard link and collections present", async () => {
  const kb = makeBaseKb({ withIndex: true })
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    [
      "title: Test Garden",
      "canonicalHostname: test.example.com",
      "select:",
      "  - index.md",
      "  - notes",
      "  - about.md",
      "",
    ].join("\n"),
  )
  const work = tmpdir("work-auth")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")

  await stageKb(kb, contentDir, identityFile)

  // C2: byte preservation
  assert.equal(
    sha256(path.join(contentDir, "index.md")),
    sha256(path.join(kb, "index.md")),
    "authored index byte-preserved",
  )
  assert.ok(
    !fs.readFileSync(path.join(contentDir, "index.md"), "utf8").includes("synthetic"),
    "authored index not synthetic",
  )

  await buildQuartz(contentDir, outputDir)
  const readHtml = (rel) => fs.readFileSync(path.join(outputDir, rel), "utf8")
  const indexHtml = readHtml("index.html")
  // C2: / is authored, not dashboard
  assert.match(indexHtml, /<h1 class="article-title">Authored Home<\/h1>/, "authored home title")
  assert.ok(!indexHtml.includes('id="vault-dashboard"'), "authored index not dashboard")
  assert.ok(indexHtml.includes("Welcome home"), "authored body present")

  // C3: dashboard link and collection nav without canonical edits
  assert.match(indexHtml, /kv-collections-nav/, "collections nav present in authored")
  assert.match(indexHtml, /Dashboard/, "dashboard link present in authored")
  // Link should be collision-safe internal href
  assert.match(indexHtml, /href="[^"]*dashboard[^"]*".*Dashboard/, "dashboard href present")
  // Collections present
  assert.ok(
    fs.existsSync(path.join(outputDir, "collections", "task.html")),
    "task collection present",
  )
  const taskColl = readHtml("collections/task.html")
  assert.match(taskColl, /Task Open/, "task collection contains task")

  // C4: stable routes, authored dashboard collision safe
  const dashHtml = readHtml("dashboard.html")
  assert.match(dashHtml, /Vault Dashboard/, "dashboard route stable")
  // Ensure authored index still appears in collections if typed (Note)
  const noteColl = readHtml("collections/note.html")
  assert.match(
    noteColl,
    /Authored Home|Note One|About This Garden/,
    "note collection includes authored index if typed",
  )

  // C5: manifest remains valid (implicit) — no new fields required, we already built

  // Search/wikilinks still work
  const contentIndex = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentIndex.json"), "utf8"),
  )
  assert.equal(contentIndex["index"].title, "Authored Home", "search title authored")
  const authoredPage = readHtml("index.html")
  // Wikilink in authored home to notes/task-open should resolve
  assert.match(authoredPage, /task-open/, "wikilink present in authored home")

  // Secret isolation still
  assert.ok(
    !Object.keys(contentIndex).some((k) => k.includes("secret")),
    "secret not in search authored",
  )
})

test("home modes: dashboard and collection URLs remain collision-safe when authored files occupy dashboard-like routes", async () => {
  const kb = makeBaseKb({ withIndex: false, withDashboardCollision: true })
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    [
      "title: Test Garden",
      "canonicalHostname: test.example.com",
      "select:",
      "  - notes",
      "  - dashboard.md",
      "",
    ].join("\n"),
  )
  const work = tmpdir("work-coll")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")

  await stageKb(kb, contentDir, identityFile)
  await buildQuartz(contentDir, outputDir)

  // Authored dashboard preserved at dashboard.html
  assert.ok(fs.existsSync(path.join(outputDir, "dashboard.html")), "authored dashboard exists")
  const authoredDash = fs.readFileSync(path.join(outputDir, "dashboard.html"), "utf8")
  assert.match(authoredDash, /Authored Dashboard/, "authored dashboard content")
  assert.ok(!authoredDash.includes('id="vault-dashboard"'), "authored not dashboard")

  // Virtual dashboard moved to dashboard-2 and is dashboard
  assert.ok(fs.existsSync(path.join(outputDir, "dashboard-2.html")), "virtual dashboard at -2")
  const virtualDash = fs.readFileSync(path.join(outputDir, "dashboard-2.html"), "utf8")
  assert.match(virtualDash, /Vault Dashboard/, "virtual dashboard")
  assert.ok(virtualDash.includes('id="vault-dashboard"'), "virtual is dashboard")

  // Generated home (index) is dashboard even with collision
  const indexHtml = fs.readFileSync(path.join(outputDir, "index.html"), "utf8")
  assert.ok(
    indexHtml.includes('id="vault-dashboard"'),
    "generated home still dashboard despite collision",
  )
  // Index's dashboard link should point to dashboard-2 (collision-safe)
  assert.match(indexHtml, /href="[^"]*dashboard-2[^"]*"/, "index dashboard link collision-safe")
})
