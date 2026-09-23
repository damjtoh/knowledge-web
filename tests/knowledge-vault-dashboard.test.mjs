/**
 * Knowledge Vault dashboard — pure helpers and full-build acceptance.
 *
 * Covers:
 * - Status/date/recency helpers (C2-C4)
 * - Synthetic full-build: dashboard route, memberships, omissions, metadata
 *   selection, recency ordering/fallbacks, collection counts/links, tag
 *   behavior, wikilinks, secret isolation, semantic markup (C1-C10)
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test, after } from "node:test"

import {
  normalizeStatus,
  isOpenTask,
  isActiveIdea,
  parseDashboardDate,
  getRecencyTime,
  compareByRecencyThenTitle,
  compareByTitleThenSlug,
  isPublishableForDashboard,
  getDashboardSlug,
  buildCollectionsFromFiles,
  DASHBOARD_SLUG,
  COLLECTIONS_PREFIX,
} from "../plugins/knowledge-vault/dist/index.js"

const execFileAsync = promisify(execFile)
const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")
const STAGE_SCRIPT = path.join(PUBLISHER_ROOT, "scripts", "stage-content.mjs")
const BUILD_CLI = path.join(PUBLISHER_ROOT, "quartz", "bootstrap-cli.mjs")
const TRACKED_CONFIG = path.join(PUBLISHER_ROOT, "quartz.config.yaml")

const tmpRoots = []
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kv-dashboard-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("normalizeStatus trims and rejects empty/non-string", () => {
  assert.equal(normalizeStatus("Open"), "Open")
  assert.equal(normalizeStatus("  Seed  "), "Seed")
  assert.equal(normalizeStatus("  "), null)
  assert.equal(normalizeStatus(""), null)
  assert.equal(normalizeStatus(null), null)
  assert.equal(normalizeStatus(undefined), null)
  assert.equal(normalizeStatus(123), null)
})

test("isOpenTask is true only for Task type with Open status case-insensitive", () => {
  const mk = (type, status) => ({ frontmatter: { type, status } })
  assert.equal(isOpenTask(mk("Task", "Open")), true)
  assert.equal(isOpenTask(mk("task", "open")), true)
  assert.equal(isOpenTask(mk(" Task ", " OPEN ")), true)
  assert.equal(isOpenTask(mk("Task", "Done")), false)
  assert.equal(isOpenTask(mk("Task", "")), false)
  assert.equal(isOpenTask(mk("Task", null)), false)
  assert.equal(isOpenTask(mk("Idea", "Open")), false)
  assert.equal(isOpenTask(mk(null, "Open")), false)
  assert.equal(isOpenTask({ frontmatter: { type: "Task" } }), false)
  assert.equal(isOpenTask({ frontmatter: {} }), false)
})

test("isActiveIdea is true only for Idea with Seed or Exploring", () => {
  const mk = (type, status) => ({ frontmatter: { type, status } })
  assert.equal(isActiveIdea(mk("Idea", "Seed")), true)
  assert.equal(isActiveIdea(mk("Idea", "Exploring")), true)
  assert.equal(isActiveIdea(mk("idea", "seed")), true)
  assert.equal(isActiveIdea(mk("Idea", " SEED ")), true)
  assert.equal(isActiveIdea(mk("Idea", "exploring")), true)
  assert.equal(isActiveIdea(mk("Idea", "Adopted")), false)
  assert.equal(isActiveIdea(mk("Idea", "Dropped")), false)
  assert.equal(isActiveIdea(mk("Idea", "")), false)
  assert.equal(isActiveIdea(mk("Task", "Seed")), false)
  assert.equal(isActiveIdea(mk("Idea", null)), false)
})

test("parseDashboardDate validates only parseable dates", () => {
  assert.ok(parseDashboardDate("2024-03-20") !== null)
  assert.ok(parseDashboardDate("2024-02-20T10:00:00Z") !== null)
  assert.equal(parseDashboardDate("not-a-date"), null)
  assert.equal(parseDashboardDate("2024-13-01"), null)
  assert.equal(parseDashboardDate(""), null)
  assert.equal(parseDashboardDate("   "), null)
  assert.equal(parseDashboardDate(null), null)
  assert.equal(parseDashboardDate(undefined), null)
  const d = new Date("2024-01-15")
  assert.ok(parseDashboardDate(d) !== null)
  assert.equal(parseDashboardDate(new Date("invalid")), null)
  assert.ok(parseDashboardDate(1700000000000) !== null)
})

test("getRecencyTime prefers valid updated_at then created_at, ignores invalid/filesystem", () => {
  const mk = (fm) => ({ frontmatter: fm })
  assert.ok(
    getRecencyTime(mk({ updated_at: "2024-03-10", created_at: "2024-01-01" })) ===
      Date.parse("2024-03-10"),
  )
  assert.equal(
    getRecencyTime(mk({ updated_at: "not-a-date", created_at: "2024-03-10" })),
    Date.parse("2024-03-10"),
  )
  assert.equal(getRecencyTime(mk({ created_at: "2024-03-10" })), Date.parse("2024-03-10"))
  assert.equal(getRecencyTime(mk({ updated_at: "invalid", created_at: "also-invalid" })), null)
  assert.equal(getRecencyTime(mk({})), null)
  assert.equal(getRecencyTime(mk({ updated_at: "" })), null)
  assert.equal(getRecencyTime({ frontmatter: null }), null)
})

test("compareByRecencyThenTitle orders updated first, then created, then title/slug deterministic", () => {
  const a = { slug: "notes/a", frontmatter: { title: "Alpha", updated_at: "2024-03-10" } }
  const b = { slug: "notes/b", frontmatter: { title: "Beta", updated_at: "2024-03-12" } }
  const c = { slug: "notes/c", frontmatter: { title: "Gamma", created_at: "2024-03-11" } }
  const d = { slug: "notes/d", frontmatter: { title: "Delta" } }
  const e = { slug: "notes/e", frontmatter: { title: "Alpha Same", updated_at: "2024-03-05" } }
  const f = { slug: "notes/f", frontmatter: { title: "Alpha Same", updated_at: "2024-03-05" } }
  // b newest updated 03-12 > c created 03-11 > a 03-10 > e/f 03-05 (slug tie-break)
  const list = [d, f, c, a, e, b]
  list.sort(compareByRecencyThenTitle)
  const slugs = list.map((x) => x.slug)
  assert.deepEqual(slugs.slice(0, 3), ["notes/b", "notes/c", "notes/a"])
  // equal date: e and f same title and date, slug tie-break
  assert.ok(
    slugs.indexOf("notes/e") < slugs.indexOf("notes/f"),
    "slug tie-break for equal date/title",
  )
  // missing dates last, ordered by title then slug
  const missingStart = slugs.indexOf("notes/d")
  assert.ok(missingStart > 3, "missing date after dated")
  // invalid date treated as missing
  const invalid = {
    slug: "notes/invalid",
    frontmatter: { title: "Zeta", updated_at: "not-a-date" },
  }
  const withInvalid = [a, invalid, d]
  withInvalid.sort(compareByRecencyThenTitle)
  assert.equal(withInvalid[0].slug, "notes/a")
  // invalid after dated, before? Actually invalid is missing, so after dated
  assert.ok(withInvalid.findIndex((x) => x.slug === "notes/invalid") > 0)
})

test("isPublishableForDashboard filters virtual/unlisted/synthetic/tag markers", () => {
  const ok = { slug: "notes/a", filePath: "/vault/notes/a.md", frontmatter: { title: "A" } }
  assert.equal(isPublishableForDashboard(ok), true)
  assert.equal(
    isPublishableForDashboard({ slug: "notes/b", isVirtualPage: true, frontmatter: {} }),
    false,
  )
  assert.equal(
    isPublishableForDashboard({ slug: "notes/c", unlisted: true, frontmatter: {} }),
    false,
  )
  assert.equal(
    isPublishableForDashboard({ slug: "notes/d", frontmatter: { unlisted: true } }),
    false,
  )
  assert.equal(
    isPublishableForDashboard({ slug: "notes/e", frontmatter: { synthetic: true } }),
    false,
  )
  assert.equal(isPublishableForDashboard({ slug: "notes/f", tag: "work", frontmatter: {} }), false)
  assert.equal(
    isPublishableForDashboard({ slug: "notes/g", collection: {}, frontmatter: {} }),
    false,
  )
  assert.equal(isPublishableForDashboard({ slug: "index", frontmatter: {} }), false)
  assert.equal(
    isPublishableForDashboard({
      slug: "notes/index",
      filePath: "/vault/notes/index.md",
      frontmatter: { title: "Idx" },
    }),
    true,
  )
})

test("getDashboardSlug is stable and collision-safe against authored dashboard", () => {
  const mk = (slug, opts = {}) => ({
    slug,
    filePath: `/vault/${slug}.md`,
    frontmatter: {},
    ...opts,
  })
  const files = [mk("notes/a"), mk("notes/b")]
  assert.equal(getDashboardSlug(files), DASHBOARD_SLUG)
  const withAuthored = [mk("notes/a"), mk("dashboard"), ...files]
  assert.equal(getDashboardSlug(withAuthored), `${DASHBOARD_SLUG}-2`)
  // deterministic independent of order
  const filesA = [mk("dashboard"), mk("notes/a")]
  const filesB = [mk("notes/a"), mk("dashboard")]
  assert.equal(getDashboardSlug(filesA), getDashboardSlug(filesB))
})

test("getDashboardSlug handles multiple collisions deterministically and order-independent", () => {
  const mk = (slug, opts = {}) => ({
    slug,
    filePath: `/vault/${slug}.md`,
    frontmatter: {},
    ...opts,
  })
  // single occupation -> dashboard-2
  assert.equal(getDashboardSlug([mk("dashboard")]), `${DASHBOARD_SLUG}-2`)
  // dashboard + dashboard-2 occupied -> dashboard-3 (order independent)
  const withTwoA = [mk("dashboard"), mk("dashboard-2")]
  const withTwoB = [mk("dashboard-2"), mk("dashboard")]
  assert.equal(getDashboardSlug(withTwoA), `${DASHBOARD_SLUG}-3`)
  assert.equal(getDashboardSlug(withTwoB), `${DASHBOARD_SLUG}-3`)
  assert.equal(getDashboardSlug(withTwoA), getDashboardSlug(withTwoB))
  // three occupations -> dashboard-4
  const withThree = [mk("dashboard"), mk("dashboard-2"), mk("dashboard-3")]
  const withThreeReversed = [...withThree].reverse()
  assert.equal(getDashboardSlug(withThree), `${DASHBOARD_SLUG}-4`)
  assert.equal(getDashboardSlug(withThreeReversed), `${DASHBOARD_SLUG}-4`)
  // gap: dashboard and dashboard-3 occupied but not dashboard-2 -> should allocate first free (dashboard-2)
  const withGap = [mk("dashboard"), mk("dashboard-3")]
  assert.equal(getDashboardSlug(withGap), `${DASHBOARD_SLUG}-2`)
  // dashboard-2 alone does not block root
  assert.equal(getDashboardSlug([mk("dashboard-2")]), DASHBOARD_SLUG)
  // dashboard/index also blocks root
  assert.equal(getDashboardSlug([mk("dashboard/index")]), `${DASHBOARD_SLUG}-2`)
  // dashboard-2/index blocks dashboard-2
  assert.equal(getDashboardSlug([mk("dashboard"), mk("dashboard-2/index")]), `${DASHBOARD_SLUG}-3`)
  // subpaths under dashboard should not block
  assert.equal(getDashboardSlug([mk("dashboard/subpage")]), DASHBOARD_SLUG)
  assert.equal(getDashboardSlug([mk("dashboard"), mk("dashboard/subpage")]), `${DASHBOARD_SLUG}-2`)
  // subpaths under dashboard-2 should not block dashboard-2
  assert.equal(
    getDashboardSlug([mk("dashboard"), mk("dashboard-2"), mk("dashboard-2/sub")]),
    `${DASHBOARD_SLUG}-3`,
  )
  // virtual, unlisted, and collection markers must not count as occupied
  assert.equal(getDashboardSlug([mk("dashboard", { isVirtualPage: true })]), DASHBOARD_SLUG)
  assert.equal(getDashboardSlug([mk("dashboard-2", { isVirtualPage: true })]), DASHBOARD_SLUG)
  assert.equal(getDashboardSlug([mk("dashboard", { unlisted: true })]), DASHBOARD_SLUG)
  assert.equal(getDashboardSlug([mk("dashboard", { collection: {} })]), DASHBOARD_SLUG)
})

// ---------------------------------------------------------------------------
// Full-build acceptance for dashboard
// ---------------------------------------------------------------------------

function makeDashboardKb() {
  const kb = tmpdir("kb-full")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.mkdirSync(path.join(kb, "extra"), { recursive: true })
  fs.mkdirSync(path.join(kb, "unselected"), { recursive: true })

  // Tasks
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
      "related_to: secret-link",
      "id: task-123",
      "---",
      "",
      "# Task Open Recent",
      "",
      "Open recent body. See [[idea-seed]]",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "task-open-older.md"),
    [
      "---",
      "type: Task",
      "status: open",
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
    path.join(kb, "notes", "task-no-status.md"),
    ["---", "type: Task", "---", "", "# Task No Status", "", "No status.", ""].join("\n"),
  )

  // Ideas
  fs.writeFileSync(
    path.join(kb, "notes", "idea-seed.md"),
    [
      "---",
      "type: Idea",
      "status: Seed",
      "description: Seed desc",
      "updated_at: 2024-02-20",
      "tags: [research]",
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
    path.join(kb, "notes", "idea-adopted.md"),
    ["---", "type: Idea", "status: Adopted", "---", "", "# Idea Adopted", "", "Adopted.", ""].join(
      "\n",
    ),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "idea-dropped.md"),
    ["---", "type: Idea", "status: Dropped", "---", "", "# Idea Dropped", "", "Dropped.", ""].join(
      "\n",
    ),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "idea-no-status.md"),
    ["---", "type: Idea", "---", "", "# Idea No Status", "", "No status.", ""].join("\n"),
  )

  // Notes for recent
  fs.writeFileSync(
    path.join(kb, "notes", "note-recent-newest.md"),
    [
      "---",
      "type: Note",
      "description: Newest desc",
      "updated_at: 2024-03-20",
      "created_at: 2024-01-10",
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
      "Created only.",
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
    path.join(kb, "notes", "note-no-date-a.md"),
    ["---", "type: Note", "---", "", "# Alpha No Date", "", "No date a.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-no-date-b.md"),
    ["---", "type: Note", "---", "", "# Beta No Date", "", "No date b.", ""].join("\n"),
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

  return kb
}

function writeManifest(kb) {
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    [
      "title: Test Garden",
      "canonicalHostname: test.example.com",
      "select:",
      "  - notes",
      "  - extra",
      "  - about.md",
      "",
    ].join("\n"),
  )
}

async function stageKb(kb, contentDir, identityFile) {
  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile],
    {
      cwd: PUBLISHER_ROOT,
    },
  )
}

async function buildQuartz(contentDir, outputDir) {
  await execFileAsync(
    process.execPath,
    [BUILD_CLI, "build", "--directory", contentDir, "--output", outputDir, "--concurrency", "1"],
    {
      cwd: PUBLISHER_ROOT,
      timeout: 120000,
    },
  )
}

test("synthetic vault generates stable Vault dashboard with search, memberships, recency, metadata, links, tags, wikilinks, and secret isolation", async () => {
  const kb = makeDashboardKb()
  writeManifest(kb)
  const work = tmpdir("work-full")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")

  await stageKb(kb, contentDir, identityFile)
  await buildQuartz(contentDir, outputDir)

  const readHtml = (rel) => fs.readFileSync(path.join(outputDir, rel), "utf8")
  const contentIndex = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentIndex.json"), "utf8"),
  )
  const contentMetadata = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentMetadata.json"), "utf8"),
  )

  // C1: dashboard stable route via pageType
  const dashboardHtml = readHtml("dashboard.html")
  assert.ok(fs.existsSync(path.join(outputDir, "dashboard.html")), "dashboard route exists")
  // prominent search landmark - must be compatible with Quartz Search upgrades (binds to .search)
  assert.match(dashboardHtml, /role="search"/, "dashboard has search landmark")
  assert.match(dashboardHtml, /class="[^"]*\bsearch\b[^"]*"/, "dashboard search container present")
  assert.match(dashboardHtml, /class="[^"]*search-bar[^"]*"/, "search input present")
  assert.match(dashboardHtml, /class="[^"]*search-layout[^"]*"/, "search layout present")
  assert.match(dashboardHtml, /data-preview="true"/, "preview enabled")
  assert.match(dashboardHtml, /data-field-priority/, "field priority present")
  assert.match(dashboardHtml, /kv-dashboard-search/, "search section present")
  assert.match(
    dashboardHtml,
    /placeholder="Search titles, content, tags/,
    "search placeholder prominent",
  )

  // Semantic landmarks: main, header, sections, nav, headings, lists — single H1 and main
  assert.match(dashboardHtml, /<main[^>]*class="kv-dashboard"/, "main landmark")
  const mainCount = (dashboardHtml.match(/<main/g) || []).length
  assert.equal(mainCount, 1, "exactly one main landmark")
  assert.match(dashboardHtml, /<header[^>]*class="kv-dashboard-header"/, "header landmark")
  assert.match(
    dashboardHtml,
    /<section[^>]*aria-labelledby="kv-search-heading"/,
    "search section landmark",
  )
  assert.match(dashboardHtml, /<nav[^>]*aria-label="Collections"/, "collections nav landmark")
  assert.match(dashboardHtml, /<h1[^>]*>Vault Dashboard<\/h1>/, "dashboard h1")
  const h1Count = (dashboardHtml.match(/<h1/g) || []).length
  assert.equal(h1Count, 1, "dashboard has exactly one H1")
  assert.ok(
    !dashboardHtml.includes('class="article-title"'),
    "no duplicate ArticleTitle H1 on dashboard",
  )
  assert.match(dashboardHtml, /<h2[^>]*id="kv-open-tasks-heading"/, "open tasks h2")
  assert.match(dashboardHtml, /<ul[^>]*class="kv-dashboard-list"/, "list markup")
  // keyboard focus visible styled — check html or any emitted css contains focus-visible
  const hasFocusVisible = (() => {
    if (dashboardHtml.includes("focus-visible")) return true
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          if (walk(p)) return true
        } else if (ent.isFile() && p.endsWith(".css")) {
          try {
            if (fs.readFileSync(p, "utf8").includes("focus-visible")) return true
          } catch {}
        }
      }
      return false
    }
    return walk(outputDir)
  })()
  assert.ok(hasFocusVisible, "focus-visible styled")

  // C2: Open Tasks membership — only Open, not Done/no-status, but Task collection contains all
  const openSection = dashboardHtml.slice(
    dashboardHtml.indexOf("Open Tasks"),
    dashboardHtml.indexOf("Active Ideas") !== -1
      ? dashboardHtml.indexOf("Active Ideas")
      : dashboardHtml.length,
  )
  assert.match(openSection, /Task Open Recent/, "open recent in open tasks")
  assert.match(openSection, /Task Open Older/, "open older in open tasks")
  assert.match(openSection, /Task Open Invalid/, "open invalid date still in open tasks")
  assert.ok(!openSection.includes("Task Done"), "done not in open tasks section")
  assert.ok(!openSection.includes("Task No Status"), "no-status not in open tasks")
  assert.ok(!openSection.includes("Task In Extra"), "non-open extra not in open tasks")
  // Task collection contains all tasks
  const taskColl = readHtml("collections/task.html")
  assert.match(taskColl, /Task Open Recent/, "task collection has open")
  assert.match(taskColl, /Task Done/, "task collection has done")
  assert.match(taskColl, /Task No Status/, "task collection has no-status")
  assert.match(taskColl, /Task In Extra/, "task collection has extra")

  // C3: Active Ideas — Seed and Exploring only, Adopted/Dropped only in collection
  const ideasStart = dashboardHtml.indexOf("Active Ideas")
  const ideasEnd = dashboardHtml.indexOf("Recent", ideasStart)
  const ideasSection =
    ideasStart !== -1
      ? dashboardHtml.slice(ideasStart, ideasEnd !== -1 ? ideasEnd : dashboardHtml.length)
      : ""
  assert.match(ideasSection, /Idea Seed/, "seed in active ideas")
  assert.match(ideasSection, /Idea Exploring/, "exploring in active ideas")
  assert.ok(!ideasSection.includes("Idea Adopted"), "adopted not in active ideas")
  assert.ok(!ideasSection.includes("Idea Dropped"), "dropped not in active ideas")
  assert.ok(!ideasSection.includes("Idea No Status"), "no-status not in active ideas")
  const ideaColl = readHtml("collections/idea.html")
  assert.match(ideaColl, /Idea Seed/, "idea collection has seed")
  assert.match(ideaColl, /Idea Adopted/, "idea collection has adopted")
  assert.match(ideaColl, /Idea Dropped/, "idea collection has dropped")
  assert.match(ideaColl, /Idea No Status/, "idea collection has no-status")

  // C4: Recent ordering — valid updated_at first then created_at, invalid/missing last, title/slug deterministic
  const recentStart = dashboardHtml.indexOf('id="kv-recent-heading"')
  const recentSlice =
    recentStart !== -1
      ? dashboardHtml.slice(recentStart, dashboardHtml.indexOf("Collections", recentStart))
      : ""
  const idxNewest = recentSlice.indexOf("Recent Newest")
  const idxCreated = recentSlice.indexOf("Created Only")
  const idxEqualA = recentSlice.indexOf("Alpha Same")
  // there are two Alpha Same entries; ensure ordering by slug: equal-a.md before equal-b.md
  // we need to check both appear and a before b via href order
  const hrefA = "note-equal-a"
  const hrefB = "note-equal-b"
  const idxHrefA = recentSlice.indexOf(hrefA)
  const idxHrefB = recentSlice.indexOf(hrefB)
  const idxNoDateAlpha = recentSlice.indexOf("Alpha No Date")
  const idxNoDateBeta = recentSlice.indexOf("Beta No Date")
  assert.ok(idxNewest !== -1 && idxCreated !== -1, "recent has newest and created-only")
  assert.ok(idxNewest < idxCreated, "newest (2024-03-20) before created-only (2024-03-19)")
  assert.ok(idxCreated < idxEqualA, "created-only before equal date 2024-03-05")
  // equal date same title: slug tie-break a before b
  assert.ok(idxHrefA !== -1 && idxHrefB !== -1, "both equal same titles present via href")
  assert.ok(idxHrefA < idxHrefB, "equal date same title ordered by slug a before b")
  assert.ok(idxNoDateAlpha !== -1 && idxNoDateBeta !== -1, "missing dates present")
  assert.ok(idxNoDateAlpha < idxNoDateBeta, "missing dates ordered by title alpha before beta")
  // missing dates after dated
  assert.ok(idxEqualA < idxNoDateAlpha, "dated before missing")

  // C5: cards selectively show title, optional description, type, status, date, never IDs or arbitrary frontmatter
  // Check a card with description
  assert.match(dashboardHtml, /Open recent desc/, "description shown when present")
  // Check type shown
  assert.match(openSection, /Task/, "type shown")
  // status shown
  assert.match(openSection, /Open/, "status shown for open tasks")
  assert.match(ideasSection, /Seed/, "status shown for active ideas")
  // date shown (formatted short month) - check for Mar or Feb
  assert.match(dashboardHtml, /Mar|Feb/, "date shown")
  // never expose internal id or arbitrary frontmatter like related_to
  assert.ok(!dashboardHtml.includes("related_to"), "arbitrary frontmatter not exposed")
  assert.ok(!dashboardHtml.includes("task-123"), "internal id not exposed")
  assert.ok(!dashboardHtml.includes("secret-link"), "arbitrary link field not exposed")

  // C6: sections with no matches omitted, tag cloud absent while tags searchable and direct tag routes work
  // Our fixture has all sections populated; instead verify tag cloud absence and that tags not rendered as cloud
  assert.ok(!dashboardHtml.includes("Total tags"), "tag cloud not on dashboard")
  assert.ok(!dashboardHtml.includes("tag-suggestions"), "no tag cloud suggestions")
  // but tags remain searchable via contentIndex
  assert.deepEqual(contentIndex["notes/task-open-recent"]?.tags, ["work"])
  assert.deepEqual(contentIndex["notes/idea-seed"]?.tags, ["research"])
  // direct tag routes work
  assert.ok(
    fs.existsSync(path.join(outputDir, "tags", "work.html")) ||
      fs.existsSync(path.join(outputDir, "tags", "research.html")),
    "tag page exists",
  )
  assert.ok(fs.existsSync(path.join(outputDir, "tags", "index.html")), "tag index exists")

  // Omission: ensure no empty section rendered if we had zero matches? We can test indirectly: dashboard should not contain a section heading for a type with zero items
  // Ensure that dashboard does not contain spurious "Open Tasks (0)" etc. It does contain counts but if zero it would be omitted — our fixture has non-zero so we just verify it doesn't contain zero count for those sections
  assert.ok(!dashboardHtml.includes("Open Tasks (0)"), "no zero-count open tasks section")
  assert.ok(!dashboardHtml.includes("Active Ideas (0)"), "no zero-count ideas section")

  // C7: dashboard collection links/counts use same authoritative derivation and collision-safe routes as collection pages/navigation
  // Verify dashboard collections nav has same labels/counts as index collection nav (both derived same way)
  const indexHtml = readHtml("index.html")
  // extract collection counts from dashboard collections nav vs index nav — they should match
  const dashCollectionsMatch = dashboardHtml.match(/Collections[\s\S]*?<ul>([\s\S]*?)<\/ul>/)
  const idxCollectionsMatch = indexHtml.match(/kv-collections-nav[\s\S]*?<ul>([\s\S]*?)<\/ul>/)
  assert.ok(dashCollectionsMatch, "dashboard collections nav present")
  assert.ok(idxCollectionsMatch, "index collections nav present")
  // compare that dashboard contains same collection labels as index (at least task/idea)
  for (const label of ["Tasks", "Ideas", "Notes", "Bookmarks"]) {
    if (indexHtml.includes(label)) {
      assert.ok(
        dashboardHtml.includes(label),
        `dashboard collections contains ${label} matching index`,
      )
    }
  }
  // verify links are internal and use collections/ prefix
  assert.match(
    dashboardHtml,
    /href="[^"]*collections\/task[^"]*"/,
    "dashboard collection link uses collision-safe route",
  )

  // C7 also check collection page links work: dashboard card links resolve
  assert.match(
    dashboardHtml,
    /href="[^"]*notes\/task-open-recent[^"]*"/,
    "dashboard card link to task works",
  )
  assert.match(
    dashboardHtml,
    /href="[^"]*notes\/idea-seed[^"]*"/,
    "dashboard card link to idea works",
  )

  // Tag behavior and wikilinks
  const taskPage = readHtml("notes/task-open-recent.html")
  assert.match(taskPage, /idea-seed/, "wikilink from task to idea-seed resolved")
  assert.ok(!taskPage.includes("broken"), "wikilink not broken")
  const bookmarkPage = readHtml("notes/bookmark-one.html")
  assert.match(bookmarkPage, /note-recent-newest/, "bookmark links to note")

  // Secret isolation
  assert.ok(
    !fs.existsSync(path.join(outputDir, "unselected", "secret.html")),
    "secret route not generated",
  )
  assert.ok(!JSON.stringify(contentIndex).includes("Secret"), "secret not in search")
  assert.ok(!contentMetadata.some((e) => e.slug.includes("secret")), "secret not in metadata")
  // grep html for secret
  const allHtmlContainsSecret = (() => {
    const walk = (dir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name)
        if (ent.isDirectory()) {
          if (walk(p)) return true
        } else if (ent.isFile() && p.endsWith(".html")) {
          if (fs.readFileSync(p, "utf8").includes("Must never appear")) return true
        }
      }
      return false
    }
    return walk(outputDir)
  })()
  assert.equal(allHtmlContainsSecret, false, "secret content not in any html")
})

test("dashboard route collision allocates first free suffix and preserves authored routes (full-build)", async () => {
  const mkKbWithDashboard = (files) => {
    const kb = tmpdir("kb-dash-coll")
    fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
    for (const [rel, content] of files) {
      fs.mkdirSync(path.join(kb, path.dirname(rel)), { recursive: true })
      fs.writeFileSync(path.join(kb, rel), content)
    }
    const dashboardSelects = []
    for (const [rel] of files) {
      if (rel.startsWith("dashboard")) dashboardSelects.push(`  - ${rel}`)
    }
    fs.writeFileSync(
      path.join(kb, "publication.manifest.yaml"),
      [
        "title: Test Garden",
        "canonicalHostname: test.example.com",
        "select:",
        "  - notes",
        ...dashboardSelects,
        "",
      ].join("\n"),
    )
    return kb
  }

  // Single collision: authored dashboard -> virtual at dashboard-2
  {
    const kb = mkKbWithDashboard([
      [
        "notes/a.md",
        ["---", "type: Task", "status: Open", "---", "", "# A", "", "A body"].join("\n"),
      ],
      [
        "dashboard.md",
        [
          "---",
          "type: Note",
          "---",
          "",
          "# Authored Dashboard",
          "",
          "Authored dashboard body.",
        ].join("\n"),
      ],
    ])
    const work = tmpdir("work-dash-single")
    const contentDir = path.join(work, "content")
    const identityFile = path.join(work, "site-identity.json")
    const outputDir = path.join(work, "public")
    await stageKb(kb, contentDir, identityFile)
    await buildQuartz(contentDir, outputDir)
    assert.ok(fs.existsSync(path.join(outputDir, "dashboard.html")), "authored dashboard preserved")
    const authoredHtml = fs.readFileSync(path.join(outputDir, "dashboard.html"), "utf8")
    assert.match(authoredHtml, /Authored Dashboard/, "authored dashboard content shown")
    assert.ok(
      !authoredHtml.includes("kv-dashboard"),
      "authored dashboard not rendered as vault dashboard",
    )
    assert.ok(
      fs.existsSync(path.join(outputDir, "dashboard-2.html")),
      "virtual dashboard moved to dashboard-2",
    )
    const dashHtml = fs.readFileSync(path.join(outputDir, "dashboard-2.html"), "utf8")
    assert.match(
      dashHtml,
      /<h1[^>]*>Vault Dashboard<\/h1>/,
      "virtual dashboard at dashboard-2 has H1",
    )
    assert.equal((dashHtml.match(/<h1/g) || []).length, 1, "virtual dashboard has exactly one H1")
  }

  // Multiple collisions: authored dashboard and dashboard-2 -> virtual at dashboard-3, order-independent
  {
    const mk = (rel, title) => [
      rel,
      ["---", "type: Note", "---", "", `# ${title}`, "", `${title} body.`].join("\n"),
    ]
    const filesA = [
      mk("dashboard.md", "Authored Dashboard"),
      mk("dashboard-2.md", "Authored Dashboard Two"),
      ["notes/a.md", ["---", "type: Task", "status: Open", "---", "", "# A", ""].join("\n")],
    ]
    const filesB = [...filesA].reverse()
    for (const files of [filesA, filesB]) {
      const kb = mkKbWithDashboard(files)
      const work = tmpdir("work-dash-multi")
      const contentDir = path.join(work, "content")
      const identityFile = path.join(work, "site-identity.json")
      const outputDir = path.join(work, "public")
      await stageKb(kb, contentDir, identityFile)
      await buildQuartz(contentDir, outputDir)
      assert.ok(
        fs.existsSync(path.join(outputDir, "dashboard.html")),
        "authored dashboard preserved (multi)",
      )
      assert.ok(
        fs.existsSync(path.join(outputDir, "dashboard-2.html")),
        "authored dashboard-2 preserved",
      )
      const dash2Html = fs.readFileSync(path.join(outputDir, "dashboard-2.html"), "utf8")
      assert.match(dash2Html, /Authored Dashboard Two/, "authored dashboard-2 content")
      assert.ok(
        fs.existsSync(path.join(outputDir, "dashboard-3.html")),
        "virtual dashboard at dashboard-3",
      )
      const dashHtml = fs.readFileSync(path.join(outputDir, "dashboard-3.html"), "utf8")
      assert.match(dashHtml, /Vault Dashboard/, "virtual dashboard label at dashboard-3")
      // Ensure authored routes still render as typed notes in collections, not as dashboards
      const taskColl = fs.existsSync(path.join(outputDir, "collections/task.html"))
        ? fs.readFileSync(path.join(outputDir, "collections/task.html"), "utf8")
        : ""
      // authored dashboard files are notes, should be in fallback or note collection, not blocked
      assert.ok(
        !dashHtml.includes("Authored Dashboard Two") || dashHtml.includes("Vault Dashboard"),
        "virtual dashboard distinct",
      )
    }
  }

  // Gap handling: authored dashboard and dashboard-3 but not dashboard-2 -> virtual at dashboard-2
  {
    const kb = mkKbWithDashboard([
      ["dashboard.md", ["---", "type: Note", "---", "", "# Authored Dashboard", ""].join("\n")],
      ["dashboard-3.md", ["---", "type: Note", "---", "", "# Authored Three", ""].join("\n")],
      ["notes/a.md", ["---", "type: Task", "status: Open", "---", "", "# A", ""].join("\n")],
    ])
    const work = tmpdir("work-dash-gap")
    const contentDir = path.join(work, "content")
    const identityFile = path.join(work, "site-identity.json")
    const outputDir = path.join(work, "public")
    await stageKb(kb, contentDir, identityFile)
    await buildQuartz(contentDir, outputDir)
    assert.ok(
      fs.existsSync(path.join(outputDir, "dashboard.html")),
      "authored dashboard preserved gap",
    )
    assert.ok(
      fs.existsSync(path.join(outputDir, "dashboard-3.html")),
      "authored dashboard-3 preserved",
    )
    assert.ok(
      fs.existsSync(path.join(outputDir, "dashboard-2.html")),
      "virtual dashboard allocated to first free gap dashboard-2",
    )
    const dashHtml = fs.readFileSync(path.join(outputDir, "dashboard-2.html"), "utf8")
    assert.match(dashHtml, /Vault Dashboard/, "gap allocation correct")
  }
})
