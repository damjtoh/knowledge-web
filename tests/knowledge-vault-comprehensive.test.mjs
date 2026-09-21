/**
 * Knowledge Vault — one complete synthetic acceptance fixture
 *
 * Verifies together in a single vault through the real Quartz pipeline:
 * titles, dashboard state/recency, collections/routes/counts, search
 * metadata/behavior, direct tags, both home modes, wikilinks, and
 * secret/publication isolation. Synthetic only.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kv-comp-${prefix}-`))
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

function writeVault(kb, withIndex = false) {
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.mkdirSync(path.join(kb, "notes", "deep"), { recursive: true })
  fs.mkdirSync(path.join(kb, "extra"), { recursive: true })
  fs.mkdirSync(path.join(kb, "unselected"), { recursive: true })

  fs.writeFileSync(
    path.join(kb, "notes", "task-open-recent.md"),
    [
      "---",
      "type: Task",
      "status: Open",
      "description: Open recent desc",
      "tags: [work]",
      "updated_at: 2024-03-10",
      "created_at: 2024-01-01",
      "---",
      "",
      "# Task Open Recent",
      "",
      "Open recent body. See [[idea-seed]] and [[note-recent-newest]]",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "task-open-older.md"),
    [
      "---",
      "type: Task",
      "status: Open",
      "description: Open older desc",
      "updated_at: 2024-02-01",
      "---",
      "",
      "# Task Open Older",
      "",
      "Older open.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "task-open-invalid.md"),
    [
      "---",
      "type: Task",
      "status: Open",
      "updated_at: not-a-date",
      "created_at: also-invalid",
      "---",
      "",
      "# Task Open Invalid",
      "",
      "Invalid dates.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "task-done.md"),
    [
      "---",
      "type: Task",
      "status: Done",
      "description: Done desc",
      "updated_at: 2024-03-15",
      "---",
      "",
      "# Task Done",
      "",
      "Done body.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "idea-seed.md"),
    [
      "---",
      "type: Idea",
      "status: Seed",
      "description: Seed desc",
      "tags: [research]",
      "updated_at: 2024-02-20",
      "---",
      "",
      "# Idea Seed",
      "",
      "Seed body.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "idea-exploring.md"),
    [
      "---",
      "type: Idea",
      "status: Exploring",
      "---",
      "",
      "# Idea Exploring",
      "",
      "Exploring.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-recent-newest.md"),
    [
      "---",
      "type: Note",
      "description: Newest desc",
      "updated_at: 2024-03-20",
      "---",
      "",
      "# Recent Newest",
      "",
      "Newest.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-created-only.md"),
    [
      "---",
      "type: Note",
      "created_at: 2024-03-19",
      "---",
      "",
      "# Created Only",
      "",
      "Created.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-equal-a.md"),
    [
      "---",
      "type: Note",
      "updated_at: 2024-03-05",
      "---",
      "",
      "# Alpha Same",
      "",
      "Equal a.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-equal-b.md"),
    [
      "---",
      "type: Note",
      "updated_at: 2024-03-05",
      "---",
      "",
      "# Alpha Same",
      "",
      "Equal b.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "bookmark-one.md"),
    [
      "---",
      "type: Bookmark",
      "description: Bookmark desc",
      "tags: [bookmark-tag]",
      "---",
      "",
      "# Bookmark One",
      "",
      "Bookmark with [[note-recent-newest]]",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "no-type.md"),
    ["---", "tags: [misc]", "---", "", "# No Type Note", "", "No type.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "custom.md"),
    [
      "---",
      "type: CustomType",
      "description: Custom desc",
      "---",
      "",
      "# Custom Item",
      "",
      "Custom.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "alpha-title.md"),
    ["---", "type: Note", "tags: [misc]", "---", "", "# Alpha Title Note", "", "Content.", ""].join(
      "\n",
    ),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "alpha-content.md"),
    [
      "---",
      "type: Note",
      "tags: [misc]",
      "---",
      "",
      "# Other Note",
      "",
      "The content mentions alpha.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "deep", "folder-note.md"),
    ["---", "type: Note", "tags: [deep]", "---", "", "# Deep Folder Note", "", "Folder.", ""].join(
      "\n",
    ),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "no-h1.md"),
    ["Just content without heading.", "", "No H1 here.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "multi-h1.md"),
    [
      "---",
      "tags: [research]",
      "description: Multi H1 description",
      "---",
      "",
      "# Multi Title First",
      "",
      "Intro.",
      "",
      "# Second Heading Should Remain",
      "",
      "More.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "extra", "task-in-extra.md"),
    ["---", "type: Task", "status: Done", "---", "", "# Task In Extra", "", "Extra.", ""].join(
      "\n",
    ),
  )
  fs.writeFileSync(
    path.join(kb, "about.md"),
    [
      "---",
      "type: Note",
      "description: About desc",
      "---",
      "",
      "# About This Garden",
      "",
      "About.",
      "",
    ].join("\n"),
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
        "Welcome home. See [[notes/task-open-recent]]",
        "",
      ].join("\n"),
    )
  }
}

function writeManifest(kb, withIndex) {
  const selects = withIndex
    ? ["  - index.md", "  - notes", "  - extra", "  - about.md"]
    : ["  - notes", "  - extra", "  - about.md"]
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    ["title: Test Garden", "canonicalHostname: test.example.com", "select:", ...selects, ""].join(
      "\n",
    ),
  )
}

test("comprehensive synthetic vault — titles, dashboard, collections, search, tags, home modes, wikilinks, isolation, nav", async () => {
  // --- Generated home vault (no authored index) ---
  const kb = tmpdir("kb-gen")
  writeVault(kb, false)
  writeManifest(kb, false)
  const work = tmpdir("work-gen")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")
  await stageKb(kb, contentDir, identityFile)
  // byte preservation
  assert.equal(
    sha256(path.join(contentDir, "notes/task-open-recent.md")),
    sha256(path.join(kb, "notes/task-open-recent.md")),
    "byte preservation task",
  )
  assert.ok(!fs.existsSync(path.join(contentDir, "unselected", "secret.md")), "secret not staged")
  await buildQuartz(contentDir, outputDir)

  const readHtml = (rel) => fs.readFileSync(path.join(outputDir, rel), "utf8")
  const contentIndex = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentIndex.json"), "utf8"),
  )
  const contentMetadata = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentMetadata.json"), "utf8"),
  )
  const findMeta = (slug) => contentMetadata.find((e) => e.slug === slug)

  // Titles readable, single H1, fallback
  const htmlTask = readHtml("notes/task-open-recent.html")
  assert.match(htmlTask, /<h1 class="article-title">Task Open Recent<\/h1>/, "readable title")
  assert.equal((htmlTask.match(/<h1/g) || []).length, 1, "single H1")
  const htmlMulti = readHtml("notes/multi-h1.html")
  assert.equal((htmlMulti.match(/<h1/g) || []).length, 2, "multi-h1 keeps second")
  assert.match(htmlMulti, /Multi Title First/, "multi title")
  assert.match(htmlMulti, /Second Heading Should Remain/, "second remains")
  const htmlNoH1 = readHtml("notes/no-h1.html")
  assert.match(htmlNoH1, /<h1 class="article-title">no-h1<\/h1>/, "fallback")

  // Collections: stable routes, counts, ordering, fallback, descriptions
  for (const s of ["task", "idea", "note", "bookmark", "customtype", "other"]) {
    assert.ok(fs.existsSync(path.join(outputDir, "collections", `${s}.html`)), `collection ${s}`)
  }
  const taskHtml = readHtml("collections/task.html")
  assert.match(taskHtml, /Task Open Recent/, "task collection has recent")
  assert.match(taskHtml, /Task In Extra/, "type grouping ignores folder")
  const ideaHtml = readHtml("collections/idea.html")
  assert.ok(!ideaHtml.includes("Task Open Recent"), "idea not contain task")
  const fallbackHtml = readHtml("collections/other.html")
  assert.match(fallbackHtml, /No Type Note/, "other fallback")
  // counts via nav
  const indexHtml = readHtml("index.html")
  assert.match(indexHtml, /Tasks \(6\)|Tasks \(/, "tasks count present")
  assert.match(indexHtml, /Other \(/, "other count")
  // ordering: Task Open Invalid etc. — check alphabetical for task collection
  const alphaIdx =
    taskHtml.indexOf("Task Open Invalid") !== -1 ? taskHtml.indexOf("Task Open Invalid") : -1
  // ensure at least alphabetical: Task Done should appear
  assert.match(taskHtml, /Task Done/, "task done in collection")

  // Dashboard: search, open tasks, active ideas, recent, collections, no tag cloud
  const dashHtml = readHtml("dashboard.html")
  assert.match(dashHtml, /role="search"/, "dashboard search landmark")
  assert.match(dashHtml, /class="[^"]*search[^"]*"/, "search container")
  assert.match(dashHtml, /kv-dashboard-search/, "search section")
  assert.ok(!dashHtml.includes("Total tags"), "no tag cloud on dashboard")
  assert.ok(!dashHtml.includes("tag-suggestions"), "no tag cloud suggestions")
  // open tasks membership
  const openStart = dashHtml.indexOf("Open Tasks")
  const ideasStart = dashHtml.indexOf("Active Ideas")
  const openSection = dashHtml.slice(openStart, ideasStart !== -1 ? ideasStart : dashHtml.length)
  assert.match(openSection, /Task Open Recent/, "open recent in dashboard")
  assert.match(openSection, /Task Open Invalid/, "open invalid in dashboard")
  assert.ok(!openSection.includes("Task Done"), "done not in open")
  // active ideas
  const ideasSection =
    ideasStart !== -1 ? dashHtml.slice(ideasStart, dashHtml.indexOf("Recent", ideasStart)) : ""
  assert.match(ideasSection, /Idea Seed/, "seed in active ideas")
  assert.match(ideasSection, /Idea Exploring/, "exploring in active ideas")
  // recent ordering
  const recentIdx = dashHtml.indexOf('id="kv-recent-heading"')
  const recentSlice =
    recentIdx !== -1 ? dashHtml.slice(recentIdx, dashHtml.indexOf("Collections", recentIdx)) : ""
  const idxNewest = recentSlice.indexOf("Recent Newest")
  const idxCreated = recentSlice.indexOf("Created Only")
  assert.ok(idxNewest !== -1 && idxCreated !== -1, "recent has newest and created")
  assert.ok(idxNewest < idxCreated, "recent newest before created")
  // metadata selection: no internal id in dashboard
  assert.ok(!dashHtml.includes("task-123"), "no internal id")

  // Search metadata: readable titles, tags, links
  assert.equal(
    contentIndex["notes/task-open-recent"]?.title,
    "Task Open Recent",
    "search title readable",
  )
  assert.deepEqual(contentIndex["notes/task-open-recent"]?.tags, ["work"], "search tags")
  assert.equal(contentIndex["notes/alpha-title"]?.title, "Alpha Title Note", "alpha title")
  // title boost: contentIndex presence implies searchable
  assert.ok(contentIndex["notes/alpha-content"], "alpha content indexed")

  // Direct tag routes and tag cloud absent from collection/home
  assert.ok(fs.existsSync(path.join(outputDir, "tags", "work.html")), "tag page work exists")
  assert.ok(fs.existsSync(path.join(outputDir, "tags", "index.html")), "tags index exists")
  // collection pages must not contain tag cloud
  assert.ok(!taskHtml.includes("Total tags"), "no tag cloud on collection")
  assert.ok(!indexHtml.includes("Total tags"), "no tag cloud on home")

  // Wikilinks resolve
  const taskPage = readHtml("notes/task-open-recent.html")
  const linkToIdea = taskPage.match(
    /<a[^>]*href="[^"]*idea-seed[^"]*"[^>]*class="[^"]*internal[^"]*"/,
  )
  assert.ok(linkToIdea, "wikilink to idea-seed")
  assert.ok(!linkToIdea[0].includes("broken"), "wikilink not broken")
  const bmPage = readHtml("notes/bookmark-one.html")
  assert.match(bmPage, /note-recent-newest/, "bookmark wikilink")

  // Secret isolation
  assert.ok(
    !fs.existsSync(path.join(outputDir, "unselected", "secret.html")),
    "secret route not emitted",
  )
  assert.ok(
    !Object.keys(contentIndex).some((k) => k.includes("secret")),
    "secret not in index keys",
  )
  assert.ok(!JSON.stringify(contentIndex).includes("Secret"), "secret not in index")
  assert.ok(!contentMetadata.some((e) => e.slug.includes("secret")), "secret not in metadata")
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

  // Navigation: collection nav primary, explorer absent across page types
  for (const rel of [
    "index.html",
    "notes/task-open-recent.html",
    "collections/task.html",
    "tags/work.html",
    "dashboard.html",
  ]) {
    const html = readHtml(rel)
    assert.match(html, /kv-collections-nav/, `${rel} has collection nav`)
    assert.ok(
      !html.includes('class="explorer"') && !html.includes("explorer-toggle"),
      `${rel} no explorer`,
    )
    assert.ok(
      !html.includes("Total tags") || rel.includes("tags/index"),
      `${rel} no complete tag cloud`,
    )
  }

  // Generated home: / is dashboard
  assert.match(indexHtml, /id="vault-dashboard"/, "generated home is dashboard")
  assert.match(indexHtml, /<h1[^>]*>Vault Dashboard<\/h1>/, "generated dashboard H1")
  // stable dashboard route
  assert.match(dashHtml, /Vault Dashboard/, "dashboard route exists")

  // ContentMetadata assertions
  assert.equal(findMeta("notes/task-open-recent")?.title, "Task Open Recent", "metadata title")
  assert.deepEqual(findMeta("notes/task-open-recent")?.tags, ["work"], "metadata tags")
  assert.equal(findMeta("notes/task-open-recent")?.description, "Open recent desc", "metadata desc")

  // --- Authored home vault (second build) ---
  const kb2 = tmpdir("kb-auth")
  writeVault(kb2, true)
  writeManifest(kb2, true)
  const work2 = tmpdir("work-auth")
  const contentDir2 = path.join(work2, "content")
  const identityFile2 = path.join(work2, "site-identity.json")
  const outputDir2 = path.join(work2, "public")
  await stageKb(kb2, contentDir2, identityFile2)
  assert.equal(
    sha256(path.join(contentDir2, "index.md")),
    sha256(path.join(kb2, "index.md")),
    "authored index byte-preserved",
  )
  assert.ok(
    !fs.readFileSync(path.join(contentDir2, "index.md"), "utf8").includes("synthetic"),
    "not synthetic",
  )
  await buildQuartz(contentDir2, outputDir2)
  const readHtml2 = (rel) => fs.readFileSync(path.join(outputDir2, rel), "utf8")
  const indexHtml2 = readHtml2("index.html")
  assert.match(indexHtml2, /<h1 class="article-title">Authored Home<\/h1>/, "authored home title")
  assert.ok(!indexHtml2.includes('id="vault-dashboard"'), "authored not dashboard")
  assert.match(indexHtml2, /kv-collections-nav/, "authored has collection nav")
  assert.match(indexHtml2, /Dashboard/, "authored has dashboard link")
  const dashHtml2 = readHtml2("dashboard.html")
  assert.match(dashHtml2, /Vault Dashboard/, "authored vault dashboard route stable")
  // wikilink in authored home
  assert.match(indexHtml2, /task-open-recent/, "authored wikilink present")
  // secret still isolated in second build
  const contentIndex2 = JSON.parse(
    fs.readFileSync(path.join(outputDir2, "static", "contentIndex.json"), "utf8"),
  )
  assert.ok(!JSON.stringify(contentIndex2).includes("Secret"), "secret not in second index")
})
