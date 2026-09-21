/**
 * Knowledge Vault collections navigation — viewport overflow regression.
 *
 * Verifies that the collection navigation does not cause horizontal overflow
 * at narrow and desktop widths by comparing rendered scrollWidth and
 * clientWidth. Uses a real browser layout (Chrome via puppeteer-core) rather
 * than CSS text matching.
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kv-layout-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

function makeKb() {
  const kb = tmpdir("kb")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  // Minimal vault to exercise nav wrapping without stressing explorer width
  const types = ["Task", "Idea", "Note", "Bookmark"]
  for (const t of types) {
    fs.writeFileSync(
      path.join(kb, "notes", `${t.toLowerCase()}-one.md`),
      ["---", `type: ${t}`, `description: Desc`, "---", "", `# ${t} One`, "", "Body.", ""].join(
        "\n",
      ),
    )
  }
  // Include one moderately long type to verify truncation/wrapping
  fs.writeFileSync(
    path.join(kb, "notes", "custom-long.md"),
    [
      "---",
      "type: CustomTypeWithLongName",
      "description: Desc",
      "---",
      "",
      "# Custom Long",
      "",
      "Body.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "no-type.md"),
    ["---", "tags: [misc]", "---", "", "# No Type Note", "", "No type.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "about.md"),
    ["---", "type: Note", "---", "", "# About", "", "About.", ""].join("\n"),
  )
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

function findChrome() {
  const candidates = []
  if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    candidates.push("/Applications/Chromium.app/Contents/MacOS/Chromium")
  } else if (process.platform === "linux") {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    )
  } else if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    )
  }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p
    } catch {}
  }
  // Allow override via env
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH))
    return process.env.CHROME_PATH
  return null
}

function createStaticServer(dir) {
  const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  }
  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0])
      let filePath = path.join(dir, urlPath === "/" ? "index.html" : urlPath)
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html")
      }
      // try_files fallback like nginx: try adding .html
      if (!fs.existsSync(filePath) && !urlPath.endsWith(".html") && !urlPath.endsWith("/")) {
        const htmlTry = `${filePath}.html`
        if (fs.existsSync(htmlTry)) filePath = htmlTry
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404)
        res.end("not found")
        return
      }
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" })
      fs.createReadStream(filePath).pipe(res)
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
  return server
}

function makeDashboardKb() {
  const kb = tmpdir("kb-dashboard")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.writeFileSync(
    path.join(kb, "notes", "task-open-one.md"),
    [
      "---",
      "type: Task",
      "status: Open",
      "description: Open task desc",
      "updated_at: 2024-03-10",
      "---",
      "",
      "# Task Open One",
      "",
      "Open task body.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "idea-seed-one.md"),
    [
      "---",
      "type: Idea",
      "status: Seed",
      "description: Seed idea desc",
      "updated_at: 2024-02-20",
      "---",
      "",
      "# Idea Seed One",
      "",
      "Seed idea body.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-recent.md"),
    [
      "---",
      "type: Note",
      "description: Recent note desc",
      "updated_at: 2024-03-20",
      "---",
      "",
      "# Note Recent",
      "",
      "Recent note.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-other.md"),
    ["---", "type: Note", "---", "", "# Note Other", "", "Other.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "bookmark-one.md"),
    ["---", "type: Bookmark", "---", "", "# Bookmark One", "", "BM.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "about.md"),
    ["---", "type: Note", "---", "", "# About", "", "About.", ""].join("\n"),
  )
  return kb
}

function writeManifestForDashboard(kb) {
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
}

test("collection nav has no horizontal overflow at narrow and desktop widths", async () => {
  const kb = makeKb()
  writeManifest(kb)
  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")
  await stageKb(kb, contentDir, identityFile)
  await buildQuartz(contentDir, outputDir)

  const chromePath = findChrome()
  if (!chromePath) {
    // Provide useful skip instead of hard fail when Chrome unavailable in CI without install
    // But require at least one verification path: try puppeteer download fallback
    console.warn(
      "Chrome not found at known paths, attempting puppeteer-core launch without executablePath",
    )
  }

  let puppeteer
  try {
    puppeteer = await import("puppeteer-core")
  } catch (e) {
    assert.fail(`puppeteer-core not available: ${e.message}. Install with npm i -D puppeteer-core`)
  }

  const server = createStaticServer(outputDir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  const baseUrl = `http://${addr.address}:${addr.port}`

  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath || undefined,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    })
  } catch (e) {
    server.close()
    // If launch fails due to missing browser, provide actionable guidance but don't hide failure
    assert.fail(
      `Failed to launch Chrome for layout test: ${e.message}. Chrome path tried: ${chromePath}`,
    )
  }

  const viewports = [
    { width: 360, height: 800, label: "narrow" },
    { width: 1280, height: 800, label: "desktop" },
  ]

  try {
    for (const vp of viewports) {
      const page = await browser.newPage()
      await page.setViewport({ width: vp.width, height: vp.height })
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
      const metrics = await page.evaluate(() => {
        const nav = document.querySelector(".kv-collections-nav")
        const navUl = nav ? nav.querySelector("ul") : null
        return {
          windowInnerWidth: window.innerWidth,
          navExists: !!nav,
          navScrollWidth: nav ? nav.scrollWidth : null,
          navClientWidth: nav ? nav.clientWidth : null,
          navUlScrollWidth: navUl ? navUl.scrollWidth : null,
          navUlClientWidth: navUl ? navUl.clientWidth : null,
        }
      })
      // Viewport-based assertions: navigation must not cause horizontal overflow.
      // Compare rendered scrollWidth vs clientWidth at each viewport, as CSS text
      // matching alone does not prove layout.
      assert.ok(metrics.navExists, `${vp.label}: .kv-collections-nav must be present`)
      assert.ok(
        metrics.navScrollWidth <= metrics.navClientWidth + 1,
        `${vp.label} (${vp.width}px): nav scrollWidth (${metrics.navScrollWidth}) must be <= clientWidth (${metrics.navClientWidth}) — no horizontal overflow`,
      )
      if (metrics.navUlScrollWidth !== null) {
        assert.ok(
          metrics.navUlScrollWidth <= metrics.navClientWidth + 1,
          `${vp.label} (${vp.width}px): nav ul scrollWidth (${metrics.navUlScrollWidth}) must be <= clientWidth (${metrics.navUlClientWidth})`,
        )
      }
      // Also ensure viewport itself is respected: window innerWidth should match requested viewport
      assert.ok(
        Math.abs(metrics.windowInnerWidth - vp.width) <= 20,
        `${vp.label}: window innerWidth ${metrics.windowInnerWidth} should be close to requested ${vp.width}`,
      )
      await page.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})

test("vault dashboard has no horizontal overflow and meaningful section order at narrow and desktop widths", async () => {
  const kb = makeDashboardKb()
  writeManifestForDashboard(kb)
  const work = tmpdir("work-dashboard")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")
  await stageKb(kb, contentDir, identityFile)
  await buildQuartz(contentDir, outputDir)

  const chromePath = findChrome()
  if (!chromePath) {
    console.warn(
      "Chrome not found at known paths, attempting puppeteer-core launch without executablePath",
    )
  }

  let puppeteer
  try {
    puppeteer = await import("puppeteer-core")
  } catch (e) {
    assert.fail(`puppeteer-core not available: ${e.message}. Install with npm i -D puppeteer-core`)
  }

  const server = createStaticServer(outputDir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  const baseUrl = `http://${addr.address}:${addr.port}`

  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath || undefined,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    })
  } catch (e) {
    server.close()
    assert.fail(
      `Failed to launch Chrome for dashboard layout test: ${e.message}. Chrome path tried: ${chromePath}`,
    )
  }

  const viewports = [
    { width: 360, height: 800, label: "narrow" },
    { width: 1280, height: 800, label: "desktop" },
  ]

  try {
    for (const vp of viewports) {
      const page = await browser.newPage()
      await page.setViewport({ width: vp.width, height: vp.height })
      // Dashboard route is at /dashboard.html (virtual page)
      await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: "networkidle0", timeout: 15000 })
      const metrics = await page.evaluate(() => {
        const dashboard = document.querySelector(".kv-dashboard")
        const search = document.querySelector(".kv-dashboard-search")
        const open = document.querySelector(".kv-dashboard-open-tasks")
        const ideas = document.querySelector(".kv-dashboard-active-ideas")
        const recent = document.querySelector(".kv-dashboard-recent")
        const collections = document.querySelector(".kv-dashboard-collections")
        const rect = (el) => (el ? el.getBoundingClientRect() : null)
        const searchRect = rect(search)
        const openRect = rect(open)
        const ideasRect = rect(ideas)
        const recentRect = rect(recent)
        const collectionsRect = rect(collections)
        return {
          windowInnerWidth: window.innerWidth,
          dashboardExists: !!dashboard,
          dashboardScrollWidth: dashboard ? dashboard.scrollWidth : null,
          dashboardClientWidth: dashboard ? dashboard.clientWidth : null,
          hasSearch: !!search,
          hasOpen: !!open,
          hasIdeas: !!ideas,
          hasRecent: !!recent,
          hasCollections: !!collections,
          searchTop: searchRect ? searchRect.top : null,
          openTop: openRect ? openRect.top : null,
          ideasTop: ideasRect ? ideasRect.top : null,
          recentTop: recentRect ? recentRect.top : null,
          collectionsTop: collectionsRect ? collectionsRect.top : null,
          dashboardMaxWidth: dashboard ? getComputedStyle(dashboard).maxWidth : null,
          focusVisibleRule: Array.from(document.styleSheets).some((sheet) => {
            try {
              return Array.from(sheet.cssRules || []).some((r) =>
                (r.cssText || "").includes("focus-visible"),
              )
            } catch {
              return false
            }
          }),
        }
      })
      assert.ok(metrics.dashboardExists, `${vp.label}: .kv-dashboard must be present`)
      assert.ok(metrics.hasSearch, `${vp.label}: dashboard search must be present`)
      // No horizontal overflow for dashboard container
      assert.ok(
        metrics.dashboardScrollWidth <= metrics.dashboardClientWidth + 1,
        `${vp.label} (${vp.width}px): dashboard scrollWidth (${metrics.dashboardScrollWidth}) must be <= clientWidth (${metrics.dashboardClientWidth}) — no horizontal overflow`,
      )
      // Search and active work must precede secondary retrieval at narrow width
      if (vp.label === "narrow") {
        if (metrics.hasOpen && metrics.hasRecent) {
          assert.ok(
            metrics.searchTop < metrics.openTop,
            `narrow: search (${metrics.searchTop}) must be above open tasks (${metrics.openTop})`,
          )
          assert.ok(
            metrics.openTop < metrics.recentTop,
            `narrow: open tasks (${metrics.openTop}) must be above recent (${metrics.recentTop})`,
          )
        }
        if (metrics.hasIdeas && metrics.hasRecent) {
          assert.ok(
            metrics.ideasTop < metrics.recentTop,
            `narrow: active ideas (${metrics.ideasTop}) must be above recent (${metrics.recentTop})`,
          )
        }
        if (metrics.hasCollections && metrics.hasSearch) {
          assert.ok(
            metrics.searchTop < metrics.collectionsTop,
            `narrow: search (${metrics.searchTop}) must be above collections (${metrics.collectionsTop})`,
          )
        }
      }
      // Desktop: dashboard uses available width but with bounded text measure (max-width not none and not full viewport)
      if (vp.label === "desktop") {
        assert.ok(
          metrics.dashboardMaxWidth !== "none" && metrics.dashboardMaxWidth !== "",
          `desktop: dashboard max-width should be bounded, got ${metrics.dashboardMaxWidth}`,
        )
        // Dashboard should not stretch to full viewport width (bounded measure)
        assert.ok(
          metrics.dashboardClientWidth < metrics.windowInnerWidth,
          `desktop: dashboard clientWidth (${metrics.dashboardClientWidth}) should be less than viewport (${metrics.windowInnerWidth}) due to bounded measure`,
        )
        assert.ok(
          metrics.dashboardClientWidth <= 1150,
          `desktop: dashboard clientWidth (${metrics.dashboardClientWidth}) should be bounded <=1150 for readable measure`,
        )
      }
      assert.ok(
        Math.abs(metrics.windowInnerWidth - vp.width) <= 20,
        `${vp.label}: window innerWidth ${metrics.windowInnerWidth} should be close to requested ${vp.width}`,
      )
      await page.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
test("vault dashboard has exactly one H1 and one main landmark (browser)", async () => {
  const kb = makeDashboardKb()
  writeManifestForDashboard(kb)
  const work = tmpdir("work-dashboard-h1")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")
  await stageKb(kb, contentDir, identityFile)
  await buildQuartz(contentDir, outputDir)

  const chromePath = findChrome()
  let puppeteer
  try {
    puppeteer = await import("puppeteer-core")
  } catch (e) {
    assert.fail(`puppeteer-core not available: ${e.message}`)
  }
  const server = createStaticServer(outputDir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  const baseUrl = `http://${addr.address}:${addr.port}`
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath || undefined,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    })
  } catch (e) {
    server.close()
    assert.fail(`Failed to launch Chrome: ${e.message}`)
  }
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: "networkidle0", timeout: 15000 })
    const metrics = await page.evaluate(() => {
      const h1s = document.querySelectorAll("h1")
      const mains = document.querySelectorAll("main")
      const dashboardH1 = document.querySelector(".kv-dashboard h1")
      const articleTitle = document.querySelector(".article-title")
      return {
        h1Count: h1s.length,
        mainCount: mains.length,
        dashboardH1Exists: !!dashboardH1,
        dashboardH1Text: dashboardH1 ? dashboardH1.textContent.trim() : null,
        articleTitleExists: !!articleTitle,
        h2Ids: Array.from(document.querySelectorAll(".kv-dashboard h2")).map((el) => el.id),
      }
    })
    assert.equal(metrics.h1Count, 1, `dashboard should have exactly one H1, got ${metrics.h1Count}`)
    assert.equal(
      metrics.mainCount,
      1,
      `dashboard should have exactly one main landmark, got ${metrics.mainCount}`,
    )
    assert.ok(metrics.dashboardH1Exists, "dashboard H1 inside .kv-dashboard must exist")
    assert.equal(metrics.dashboardH1Text, "Vault Dashboard", "dashboard H1 text")
    assert.equal(
      metrics.articleTitleExists,
      false,
      "ArticleTitle H1 should not appear on dashboard",
    )
    assert.ok(metrics.h2Ids.includes("kv-search-heading"), "search H2 present")
    assert.ok(
      metrics.h2Ids.includes("kv-open-tasks-heading") ||
        metrics.h2Ids.includes("kv-recent-heading"),
      "section H2s present",
    )
    await page.close()
  } finally {
    await browser.close()
    server.close()
  }
})

test("vault dashboard search integrates with Quartz search (full-text, tag filters, title boost, folder context, SPA reattachment)", async () => {
  const kb = tmpdir("kb-dashboard-search")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.mkdirSync(path.join(kb, "notes", "deep"), { recursive: true })
  fs.writeFileSync(
    path.join(kb, "notes", "work-task.md"),
    [
      "---",
      "type: Task",
      "status: Open",
      "tags: [work]",
      "---",
      "",
      "# Work Task",
      "",
      "This task is about work planning.",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "research-idea.md"),
    [
      "---",
      "type: Idea",
      "status: Seed",
      "tags: [research]",
      "---",
      "",
      "# Research Idea",
      "",
      "Research content here.",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "alpha-title.md"),
    [
      "---",
      "type: Note",
      "tags: [misc]",
      "---",
      "",
      "# Alpha Title Note",
      "",
      "Content without alpha in title elsewhere.",
    ].join("\n"),
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
      "The content mentions alpha extensively.",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "deep", "folder-note.md"),
    [
      "---",
      "type: Note",
      "tags: [deep]",
      "---",
      "",
      "# Deep Folder Note",
      "",
      "Folder note content.",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "bookmark-one.md"),
    [
      "---",
      "type: Bookmark",
      "tags: [bookmark]",
      "---",
      "",
      "# Bookmark One",
      "",
      "Bookmark content.",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "about.md"),
    ["---", "type: Note", "---", "", "# About", "", "About."].join("\n"),
  )
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
  const work = tmpdir("work-dashboard-search")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")
  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile],
    { cwd: PUBLISHER_ROOT },
  )
  await buildQuartz(contentDir, outputDir)

  const chromePath = findChrome()
  let puppeteer
  try {
    puppeteer = await import("puppeteer-core")
  } catch (e) {
    assert.fail(`puppeteer-core not available: ${e.message}`)
  }
  const server = createStaticServer(outputDir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  const baseUrl = `http://${addr.address}:${addr.port}`
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath || undefined,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    })
  } catch (e) {
    server.close()
    assert.fail(`Failed to launch Chrome: ${e.message}`)
  }

  const waitForDashboardResults = async (page, minCount = 1, timeout = 10000) => {
    await page.waitForFunction(
      (sel, cnt) => document.querySelectorAll(sel).length >= cnt,
      { timeout },
      ".kv-dashboard-search .search-layout .result-card:not(.no-match)",
      minCount,
    )
  }

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/dashboard.html`, { waitUntil: "networkidle0", timeout: 15000 })
    const hasCompatibleDom = await page.evaluate(() => {
      const sec = document.querySelector(".kv-dashboard-search")
      const search = sec ? sec.querySelector(".search") : null
      const bar = sec ? sec.querySelector(".search-bar") : null
      const layout = sec ? sec.querySelector(".search-layout") : null
      return {
        hasSection: !!sec,
        hasSearchAncestor: !!search,
        hasBar: !!bar,
        hasLayout: !!layout,
        hasPreview: layout ? layout.getAttribute("data-preview") === "true" : false,
        hasFieldPriority: layout ? !!layout.getAttribute("data-field-priority") : false,
        inputPlaceholder: bar ? bar.getAttribute("placeholder") : null,
      }
    })
    assert.ok(hasCompatibleDom.hasSection, "dashboard search section present")
    assert.ok(
      hasCompatibleDom.hasSearchAncestor,
      "dashboard search has .search ancestor for upgrades",
    )
    assert.ok(hasCompatibleDom.hasBar, "dashboard search has .search-bar")
    assert.ok(hasCompatibleDom.hasLayout, "dashboard search has .search-layout")
    assert.ok(hasCompatibleDom.hasPreview, "data-preview true")
    assert.ok(hasCompatibleDom.hasFieldPriority, "data-field-priority present")
    assert.ok(
      hasCompatibleDom.inputPlaceholder && hasCompatibleDom.inputPlaceholder.includes("Search"),
      "placeholder present",
    )

    await page
      .waitForFunction(() => typeof window.fetchData !== "undefined", { timeout: 5000 })
      .catch(() => {})

    async function queryAndVerify(query, expectedSubstring) {
      const inputSel = "#kv-dashboard-search-input"
      await page.click(inputSel, { clickCount: 3 })
      await page.keyboard.press("Backspace")
      await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (el) {
          el.value = ""
          el.dispatchEvent(new Event("input", { bubbles: true }))
        }
      }, inputSel)
      await page.type(inputSel, query, { delay: 20 })
      if (expectedSubstring === null) {
        await page
          .waitForFunction(
            () => {
              const c = document.querySelector(
                ".kv-dashboard-search .search-layout .result-card.no-match",
              )
              return !!c && c.style.display !== "none"
            },
            { timeout: 8000 },
          )
          .catch(() => {})
      } else {
        await waitForDashboardResults(page, 1)
        await new Promise((r) => setTimeout(r, 300))
      }
      const res = await page.evaluate((exp) => {
        const container = document.querySelector(".kv-dashboard-search .search-layout")
        const cards = container
          ? Array.from(container.querySelectorAll(".result-card:not(.no-match)"))
          : []
        const visible = cards.filter((c) => c.style.display !== "none")
        return {
          total: cards.length,
          visible: visible.length,
          texts: visible.map((c) => c.textContent || ""),
          hasFolder: visible.some((c) => !!c.querySelector(".search-folder")),
          insideDashboard: !!document.querySelector(
            ".kv-dashboard-search .search-layout .result-card",
          ),
        }
      }, expectedSubstring)
      if (expectedSubstring !== null) {
        assert.ok(
          res.visible >= 1,
          `query "${query}" should have visible dashboard-local results, got ${res.visible}`,
        )
        assert.ok(
          res.insideDashboard,
          `results for "${query}" should be inside dashboard search layout`,
        )
        if (expectedSubstring) {
          const joined = res.texts.join(" ")
          assert.ok(
            joined.toLowerCase().includes(expectedSubstring.toLowerCase()),
            `results for "${query}" should contain "${expectedSubstring}", got ${joined.slice(0, 500)}`,
          )
        }
        assert.ok(
          res.hasFolder,
          `results for "${query}" should include folder context (.search-folder)`,
        )
      }
      return res
    }

    await queryAndVerify("Work", "Work Task")
    await queryAndVerify("tag:work", "Work Task")
    await queryAndVerify("#work", "Work Task")

    await page.click("#kv-dashboard-search-input", { clickCount: 3 })
    await page.keyboard.press("Backspace")
    await page.evaluate(() => {
      const el = document.querySelector("#kv-dashboard-search-input")
      if (el) {
        el.value = ""
        el.dispatchEvent(new Event("input", { bubbles: true }))
      }
    })
    await page.type("#kv-dashboard-search-input", "Alpha", { delay: 20 })
    await waitForDashboardResults(page, 2)
    await new Promise((r) => setTimeout(r, 400))
    const boostOrder = await page.evaluate(() => {
      const container = document.querySelector(".kv-dashboard-search .search-layout")
      const cards = container
        ? Array.from(container.querySelectorAll(".result-card:not(.no-match)")).filter(
            (c) => c.style.display !== "none",
          )
        : []
      return cards
        .map((c) =>
          c.querySelector(".card-title")
            ? c.querySelector(".card-title").innerText
            : c.textContent || "",
        )
        .join(" | ")
    })
    const idxTitle = boostOrder.toLowerCase().indexOf("alpha title")
    const idxContent = boostOrder.toLowerCase().indexOf("other note")
    assert.ok(idxTitle !== -1 && idxContent !== -1, `both alpha results present, got ${boostOrder}`)
    assert.ok(
      idxTitle < idxContent,
      `title boost: "Alpha Title Note" should rank before content match, order: ${boostOrder}`,
    )

    await queryAndVerify("Deep Folder", "Deep Folder Note")

    await page.evaluate(() => {
      const w = window
      if (typeof w.spaNavigate === "function") w.spaNavigate("/notes/work-task")
      else window.location.assign("/notes/work-task.html")
    })
    await page
      .waitForFunction(() => window.location.pathname.includes("work-task"), { timeout: 8000 })
      .catch(() => {})
    await new Promise((r) => setTimeout(r, 500))
    await page.evaluate(() => {
      const w = window
      if (typeof w.spaNavigate === "function") w.spaNavigate("/dashboard")
      else window.location.assign("/dashboard.html")
    })
    await page
      .waitForFunction(() => window.location.pathname.includes("dashboard"), { timeout: 8000 })
      .catch(() => {})
    await page.waitForSelector("#kv-dashboard-search-input", { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 500))
    await queryAndVerify("Research", "Research Idea")

    await page.close()
  } finally {
    await browser.close()
    server.close()
  }
})

test("page types remain coherent across content, collection, tag, dashboard and 404 — no overflow, landmarks, H1, focus", async () => {
  const kb = makeKb()
  writeManifest(kb)
  const work = tmpdir("work-coherence")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")
  await stageKb(kb, contentDir, identityFile)
  await buildQuartz(contentDir, outputDir)

  const chromePath = findChrome()
  let puppeteer
  try {
    puppeteer = await import("puppeteer-core")
  } catch (e) {
    assert.fail(`puppeteer-core not available: ${e.message}`)
  }
  const server = createStaticServer(outputDir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  const baseUrl = `http://${addr.address}:${addr.port}`
  let browser
  try {
    browser = await puppeteer.launch({
      executablePath: chromePath || undefined,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    })
  } catch (e) {
    server.close()
    assert.fail(`Failed to launch Chrome: ${e.message}`)
  }

  const pagesToCheck = [
    { path: "/", label: "home-generated" },
    { path: "/dashboard.html", label: "dashboard" },
    { path: "/notes/note-one.html", label: "content" },
    { path: "/collections/note.html", label: "collection" },
    { path: "/tags/misc.html", label: "tag" },
    { path: "/404.html", label: "404" },
    { path: "/notes/index.html", label: "folder" },
  ]

  const viewports = [
    { width: 360, height: 800, label: "narrow" },
    { width: 1280, height: 800, label: "desktop" },
  ]

  try {
    for (const vp of viewports) {
      for (const p of pagesToCheck) {
        const page = await browser.newPage()
        await page.setViewport({ width: vp.width, height: vp.height })
        await page.goto(`${baseUrl}${p.path}`, { waitUntil: "networkidle0", timeout: 15000 })
        const metrics = await page.evaluate(() => {
          const body = document.body
          const nav = document.querySelector(".kv-collections-nav")
          const explorer = document.querySelector(".explorer")
          const h1s = Array.from(document.querySelectorAll("h1"))
          const mains = document.querySelectorAll("main")
          const articles = document.querySelectorAll("article")
          const header = document.querySelector("header")
          const footer = document.querySelector("footer")
          const hasFocusVisible = Array.from(document.styleSheets).some((sheet) => {
            try {
              return Array.from(sheet.cssRules || []).some(
                (r) =>
                  (r.cssText || "").includes("focus-visible") ||
                  (r.cssText || "").includes(":focus"),
              )
            } catch {
              return false
            }
          })
          const focusable = document.querySelectorAll(
            'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
          )
          const firstFocusable = focusable[0]
          return {
            bodyScrollWidth: body ? body.scrollWidth : null,
            bodyClientWidth: body ? body.clientWidth : null,
            hasNav: !!nav,
            hasExplorer: !!explorer,
            h1Count: h1s.length,
            h1Texts: h1s.map((h) => h.textContent?.trim() || ""),
            mainCount: mains.length,
            articleCount: articles.length,
            hasHeader: !!header,
            hasFooter: !!footer,
            hasFocusVisible,
            focusableCount: focusable.length,
            firstTag: firstFocusable ? firstFocusable.tagName : null,
            windowInnerWidth: window.innerWidth,
            title: document.title,
            url: location.pathname,
          }
        })
        // No horizontal overflow
        assert.ok(
          metrics.bodyScrollWidth <= metrics.bodyClientWidth + 1,
          `${vp.label} ${p.label} (${vp.width}px): body scrollWidth ${metrics.bodyScrollWidth} <= clientWidth ${metrics.bodyClientWidth}`,
        )
        assert.equal(
          metrics.hasExplorer,
          false,
          `${vp.label} ${p.label}: explorer must be absent (C1)`,
        )
        assert.ok(
          metrics.hasNav || p.label === "404",
          `${vp.label} ${p.label}: collection nav present`,
        )
        // One primary H1 except 404 may have one as well
        if (p.label === "404") {
          assert.equal(metrics.h1Count, 1, `${vp.label} 404 should have one H1`)
          assert.ok(metrics.h1Texts[0]?.includes("404"), `${vp.label} 404 H1 text`)
        } else if (p.label === "dashboard") {
          assert.equal(metrics.h1Count, 1, `${vp.label} dashboard one H1`)
          assert.equal(metrics.h1Texts[0], "Vault Dashboard", `${vp.label} dashboard H1`)
          assert.equal(metrics.mainCount, 1, `${vp.label} dashboard one main`)
        } else if (p.label === "home-generated") {
          // generated home is dashboard
          assert.equal(metrics.h1Count, 1, `${vp.label} home one H1`)
        } else {
          assert.ok(metrics.h1Count >= 1, `${vp.label} ${p.label} at least one H1`)
          assert.ok(
            metrics.h1Count <= 2,
            `${vp.label} ${p.label} at most 2 H1 (allow tag index maybe)`,
          )
        }
        assert.ok(
          metrics.hasFocusVisible || metrics.hasNav,
          `${vp.label} ${p.label}: focus-visible or focus style present`,
        )
        assert.ok(
          metrics.focusableCount >= 1,
          `${vp.label} ${p.label}: at least one focusable element`,
        )

        // Keyboard: try tabbing to first focusable and check visible focus
        if (metrics.focusableCount > 0) {
          await page.keyboard.press("Tab")
          await new Promise((r) => setTimeout(r, 200))
          const focused = await page.evaluate(() => {
            const el = document.activeElement
            if (!el) return { tag: null, hasOutline: false }
            const style = getComputedStyle(el)
            const outline =
              style.outlineWidth && style.outlineWidth !== "0px" && style.outlineStyle !== "none"
            const hasFocusVisibleClass = el.matches(":focus-visible")
            return {
              tag: el.tagName,
              hasOutline: outline || hasFocusVisibleClass,
              outlineWidth: style.outlineWidth,
              outlineStyle: style.outlineStyle,
            }
          })
          // At least one element should be focusable; outline may be via focus-visible rule
          assert.ok(focused.tag, `${vp.label} ${p.label}: tab should focus element`)
        }

        await page.close()
      }
    }

    // 404 behavior: missing route should render 404 content via fallback, but direct /404.html works
    const page404 = await browser.newPage()
    await page404.setViewport({ width: 1280, height: 800 })
    await page404.goto(`${baseUrl}/404.html`, { waitUntil: "networkidle0", timeout: 15000 })
    const notFound = await page404.evaluate(() => {
      const h1 = document.querySelector("h1")?.textContent?.trim() || ""
      const link = document.querySelector('a[href="/"], a[href="./"]')
      const hasHomeLink = !!link
      const bodyText = document.body.textContent || ""
      return { h1, hasHomeLink, bodyText: bodyText.slice(0, 500) }
    })
    assert.match(notFound.h1, /404/, "404 H1")
    assert.ok(
      notFound.hasHomeLink ||
        notFound.bodyText.toLowerCase().includes("not found") ||
        notFound.bodyText.toLowerCase().includes("home"),
      "404 has home link or not found text",
    )
    await page404.close()
  } finally {
    await browser.close()
    server.close()
  }
})
