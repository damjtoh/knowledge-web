/**
 * Shared reader phone journey (item 04).
 *
 * Production static export + nginx-style server + production browser at a
 * narrow phone (360), a larger phone (414), and desktop (1280):
 * - phone layouts hide the permanent sidebar and keep content primary;
 * - a compact Browse control opens/closes the same area + Travel navigation;
 * - home -> Travel -> nested note works from Browse and article links;
 * - breadcrumbs wrap, browser Back returns through real history;
 * - touch targets, visible keyboard focus, landmarks, and no page-level
 *   horizontal overflow hold on long titles, wide tables, code, and images;
 * - direct nested URLs and refresh work through the nginx-style fallback;
 * - the static output stays within the publication boundary.
 *
 * The synthetic fixture always runs (no vault needed) and mirrors the real
 * Travel folder shape. When SHARED_KB_ROOT points at the Shared vault, the
 * phone journey also runs against the real corpus (55 selected Markdown +
 * synthetic landing).
 *
 * Run with:
 *   node --test tests/shared-reader-phone-browser.test.mjs
 *   SHARED_KB_ROOT=/path/to/shared-vault node --test tests/shared-reader-phone-browser.test.mjs
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
const READER_ROOT = path.join(PUBLISHER_ROOT, "reader")
const STAGE_SCRIPT = path.join(PUBLISHER_ROOT, "scripts", "stage-content.mjs")

const tmpRoots = []
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shared-phone-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}

after(() => {
  for (const dir of [".source", ".next", "out"]) {
    fs.rmSync(path.join(READER_ROOT, dir), { recursive: true, force: true })
  }
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

function findChrome() {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate
    } catch {}
  }
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH
  }
  return null
}

/** Minimal nginx-style static server: try $uri, then $uri.html. */
function createStaticServer(dir) {
  const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".txt": "text/plain",
  }
  return http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0])
      const base = path.join(dir, urlPath === "/" ? "index.html" : urlPath)
      const candidates = [base, `${base}.html`, path.join(base, "index.html")]
      const filePath = candidates.find(
        (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
      )
      if (!filePath) {
        res.writeHead(404)
        res.end("not found")
        return
      }
      res.writeHead(200, {
        "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      })
      fs.createReadStream(filePath).pipe(res)
    } catch (error) {
      res.writeHead(500)
      res.end(String(error))
    }
  })
}

async function stageKb(kbRoot, contentDir, identityFile) {
  await execFileAsync(
    process.execPath,
    [
      STAGE_SCRIPT,
      "--kb-root",
      kbRoot,
      "--content-dir",
      contentDir,
      "--identity-file",
      identityFile,
    ],
    { cwd: PUBLISHER_ROOT, timeout: 120000 },
  )
}

async function buildReader(contentDir, identityFile) {
  await execFileAsync("npm", ["run", "build"], {
    cwd: READER_ROOT,
    timeout: 600000,
    env: { ...process.env, SHARED_CONTENT_DIR: contentDir, SHARED_IDENTITY_FILE: identityFile },
  })
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/** Synthetic vault mirroring the real Travel shape plus overflow probes. */
function makePhoneKb() {
  const kb = tmpdir("kb-phone")
  writeFile(
    kb,
    "travel/index.md",
    "---\ntype: Area\nstatus: active\n---\n\n# Travel\n\nTravel is the household area for trip planning.\n",
  )
  writeFile(
    kb,
    "travel/upcoming/terradets-2026.md",
    [
      "---",
      "type: Trip",
      "status: booked",
      'area: "[[Travel]]"',
      "---",
      "",
      "# Terradets",
      "",
      "Stay at Hotel Terradets. See [[Travel]] for the area and [[Missing Page]] for later.",
      "",
      "| Day | Morning | Midday | Afternoon | Evening | Night | Cost | Notes |",
      "|---|---|---|---|---|---|---|---|",
      "| One | Kayak on the lake | Lunch in town | Trek to the viewpoint | Dinner | Sleep | 85 € | Long day |",
      "",
      "```js",
      "const veryLongLineForPhoneOverflowChecks = 'abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz-1234567890-1234567890';",
      "```",
      "",
      "![Lake view](https://example.com/photos/very-wide-panoramic-lake-view.jpg)",
      "",
      "Book via [Montsec](https://montsecactiva.com/es/actividades/kayak-trek-mont-rebei/).",
      "",
    ].join("\n"),
  )
  writeFile(
    kb,
    "travel/upcoming/japan/index.md",
    '---\ntype: Trip\nstatus: planning\narea: "[[Travel]]"\n---\n\n# Japan\n\nFirst trip to Japan.\n',
  )
  writeFile(kb, "travel/upcoming/japan/itinerary.md", "# Japan Itinerary\n\nDay one in Osaka.\n")
  writeFile(
    kb,
    "travel/upcoming/an-extremely-long-packing-checklist-title-for-phone-wrapping.md",
    "# An extremely long packing checklist title that keeps going SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious\n\nPack light.\n",
  )
  writeFile(
    kb,
    "travel/past/porto-2026/index.md",
    '---\ntype: Trip\nstatus: completed\narea: "[[Travel]]"\n---\n\n# Porto\n\nCity break hub.\n',
  )
  writeFile(
    kb,
    "travel/past/porto-2026/itinerary.md",
    "# Porto Itinerary\n\n- [ ] book train\n- [x] reserve hotel\n",
  )
  writeFile(
    kb,
    "travel/preferences/travel-style.md",
    '---\ntype: Note\narea: "[[Travel]]"\n---\n\n# Travel style\n\nDeliberate, not cheap.\n',
  )
  writeFile(
    kb,
    "travel/wishlist.md",
    '---\ntype: Note\narea: "[[Travel]]"\n---\n\n# Wishlist\n\nJapan, China.\n',
  )
  writeFile(
    kb,
    "travel/visited.md",
    '---\ntype: Note\narea: "[[Travel]]"\n---\n\n# Visited places\n\nFlorence, Rome.\n',
  )
  writeFile(
    kb,
    "finance/index.md",
    "---\ntype: Area\nstatus: active\n---\n\n# Shared Finance\n\nBudgeting and planning.\n",
  )
  writeFile(kb, "pets/index.md", "---\ntype: Area\nstatus: active\n---\n\n# Pets\n\nAnimal care.\n")
  writeFile(
    kb,
    "life-planning/index.md",
    "---\ntype: Area\nstatus: active\n---\n\n# Life Planning\n\nLong-term plans.\n",
  )
  writeFile(
    kb,
    "inbox.md",
    "---\ntype: Note\nstatus: active\n---\n\n# Household Inbox\n\nRaw capture.\n",
  )
  writeFile(
    kb,
    "mica/index.md",
    "---\ntype: Area\nstatus: active\n---\n\n# Mica\n\nPersonal workspace.\n",
  )
  writeFile(kb, "unselected.md", "# Unselected\n\nTolaria Vault sentinel must never appear.\n")
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Phone Garden",
      "canonicalHostname: phone.example.com",
      "select:",
      "  - travel",
      "  - finance",
      "  - pets",
      "  - life-planning",
      "  - inbox.md",
      "  - mica",
      "",
    ].join("\n"),
  )
  return kb
}

async function launchBrowser() {
  const chromePath = findChrome()
  let puppeteer
  try {
    puppeteer = await import("puppeteer-core")
  } catch (error) {
    assert.fail(`puppeteer-core not available: ${error.message}`)
  }
  const browser = await puppeteer
    .launch({
      executablePath: chromePath || undefined,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    })
    .catch((error) => {
      assert.fail(`Failed to launch Chrome: ${error.message}`)
    })
  return browser
}

async function serveOut(outDir) {
  const server = createStaticServer(outDir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  return { server, baseUrl: `http://${addr.address}:${addr.port}` }
}

async function goto(page, url) {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 15000 })
}

async function isVisible(page, selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    const style = getComputedStyle(el)
    if (style.display === "none" || style.visibility === "hidden") return false
    const rect = el.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }, selector)
}

async function visibleHeights(page, selector) {
  return await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel))
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.getBoundingClientRect().height)
  }, selector)
}

async function assertTouchTargets(page, label) {
  // Navigation controls and list rows stay usable with one hand.
  for (const selector of [
    ".reader-browse-toggle",
    ".reader-home",
    ".reader-area-list a",
    ".reader-group-list a",
    ".reader-breadcrumbs a",
    ".reader-sidebar-nav a",
  ]) {
    for (const height of await visibleHeights(page, selector)) {
      assert.ok(height >= 44, `${label}: ${selector} touch target is ${height}px (expected >= 44)`)
    }
  }
}
async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))
  assert.ok(
    overflow.doc <= overflow.inner + 1,
    `${label}: document width ${overflow.doc} exceeds viewport ${overflow.inner}`,
  )
  assert.ok(
    overflow.body <= overflow.inner + 1,
    `${label}: body width ${overflow.body} exceeds viewport ${overflow.inner}`,
  )
}

async function assertLandmarks(page, label, { breadcrumb = true } = {}) {
  const landmarks = await page.evaluate(() => ({
    mainCount: document.querySelectorAll("main").length,
    h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
    areasNav: !!document.querySelector('nav[aria-label="Shared areas"]'),
    breadcrumbNav: !!document.querySelector('nav[aria-label="Breadcrumb"]'),
  }))
  assert.equal(landmarks.mainCount, 1, `${label}: one main landmark`)
  assert.equal(landmarks.h1s.length, 1, `${label}: one primary heading`)
  assert.ok(landmarks.areasNav, `${label}: Shared areas navigation landmark`)
  if (breadcrumb) assert.ok(landmarks.breadcrumbNav, `${label}: breadcrumb navigation landmark`)
}

async function browseAreas(page) {
  return await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".reader-sidebar-nav a")).map((a) => ({
      text: a.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
    }))
  })
}

async function openBrowse(page) {
  await page.evaluate(() => {
    document.querySelector(".reader-browse-toggle")?.click()
  })
  await page.waitForFunction(
    () => document.querySelector(".reader-chrome")?.getAttribute("data-browse") === "open",
    { timeout: 5000 },
  )
}

/**
 * Phone assertions: sidebar hidden until Browse opens, Browse exposes the
 * same five areas, and the full home -> Travel -> note journey works with
 * breadcrumbs and browser Back through real history.
 */
async function runPhoneJourney(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)

  // Phone keeps note content primary: no permanent sidebar.
  assert.equal(
    await isVisible(page, ".reader-sidebar"),
    false,
    `${label}: permanent sidebar is hidden on the phone home`,
  )
  assert.ok(await isVisible(page, ".reader-browse-toggle"), `${label}: Browse control is visible`)
  const toggleHeight = await page.evaluate(
    () => document.querySelector(".reader-browse-toggle")?.getBoundingClientRect().height,
  )
  assert.ok(toggleHeight >= 44, `${label}: Browse control is ${toggleHeight}px (expected >= 44)`)
  await assertNoPageOverflow(page, `${label} home`)
  // The Shared home has no breadcrumbs by design; inner pages assert theirs.
  await assertLandmarks(page, `${label} home`, { breadcrumb: false })

  // Browse opens the same five selected areas as the desktop sidebar.
  await openBrowse(page)
  assert.equal(await isVisible(page, ".reader-sidebar"), true, `${label}: Browse opens the panel`)
  const expanded = await page.evaluate(() =>
    document.querySelector(".reader-browse-toggle")?.getAttribute("aria-expanded"),
  )
  assert.equal(expanded, "true", `${label}: Browse reports its open state`)
  const areas = await browseAreas(page)
  assert.deepEqual(
    areas.map((a) => a.text).sort(),
    [...expect.areas].sort(),
    `${label}: Browse exposes the five selected areas`,
  )
  for (const area of areas) {
    assert.ok(!/mica/i.test(area.text), `${label}: Browse excludes unselected area ${area.text}`)
  }

  // Browse closes again from the toggle.
  await page.evaluate(() => {
    document.querySelector(".reader-browse-toggle")?.click()
  })
  await page.waitForFunction(
    () => document.querySelector(".reader-chrome")?.getAttribute("data-browse") === "closed",
    { timeout: 5000 },
  )
  assert.equal(await isVisible(page, ".reader-sidebar"), false, `${label}: Browse closes the panel`)

  // Full journey: home -> Travel -> nested note.
  const travelHref = (
    await page.evaluate(() =>
      Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => ({
        text: a.textContent?.trim() || "",
        href: a.getAttribute("href") || "",
      })),
    )
  ).find((l) => l.text === expect.travelTitle)?.href
  assert.ok(travelHref, `${label}: home links Travel from staged content`)
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      document.querySelector(`.reader-area-list a[href="${href}"]`)?.click()
    }, travelHref),
  ])
  assert.match(page.url(), /\/travel\/?$/, `${label}: Travel opens its authored area route`)
  await assertNoPageOverflow(page, `${label} Travel`)
  await assertTouchTargets(page, `${label} Travel`)

  // Browse on Travel exposes the same folder groups as the desktop page.
  await openBrowse(page)
  const panelGroups = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".reader-nav-travel .reader-group-list a")).map(
      (a) => ({ text: a.textContent?.trim() || "", href: a.getAttribute("href") || "" }),
    )
  })
  const articleGroups = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("article .reader-group-list a")).map((a) => ({
      text: a.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
    }))
  })
  assert.ok(panelGroups.length > 0, `${label}: Browse exposes Travel folder groups`)
  for (const link of panelGroups) {
    assert.ok(
      articleGroups.some((a) => a.href === link.href && a.text === link.text),
      `${label}: Browse Travel link ${link.text} matches the desktop page (no second model)`,
    )
  }
  const noteHref = articleGroups.find((l) => l.text === expect.noteTitle)?.href
  assert.ok(noteHref, `${label}: Travel groups link ${expect.noteTitle}`)
  // Close Browse with Escape: focus returns to the toggle.
  await page.keyboard.press("Escape")
  await page.waitForFunction(
    () => document.querySelector(".reader-chrome")?.getAttribute("data-browse") === "closed",
    { timeout: 5000 },
  )

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      Array.from(document.querySelectorAll("article .reader-group-list a"))
        .find((el) => el.getAttribute("href") === href)
        ?.click()
    }, noteHref),
  ])
  assert.ok(page.url().includes(expect.notePath), `${label}: nested note route ${expect.notePath}`)
  const note = await page.evaluate(() => ({
    h1: document.querySelector("article h1")?.textContent?.trim() || "",
    crumbs: Array.from(document.querySelectorAll(".reader-breadcrumbs li")).map((li) => ({
      text: li.textContent?.trim() || "",
      href: li.querySelector("a")?.getAttribute("href") || null,
    })),
    h1Rect: document.querySelector("article h1")?.getBoundingClientRect().toJSON() || null,
    tableFits: !document.querySelector("article table"),
    media: {
      tableScroll: document.querySelector("article table")?.scrollWidth || 0,
      tableClient: document.querySelector("article table")?.clientWidth || 0,
      preScroll: document.querySelector("article pre")?.scrollWidth || 0,
      preClient: document.querySelector("article pre")?.clientWidth || 0,
      imgWidth: document.querySelector("article img")?.getBoundingClientRect().width || 0,
      viewport: window.innerWidth,
    },
  }))
  assert.equal(note.h1, expect.noteTitle, `${label}: nested note authored title`)
  assert.ok(note.crumbs.length >= 3, `${label}: breadcrumbs expose folder ancestry`)
  assert.ok(
    note.h1Rect && note.h1Rect.width <= note.media.viewport + 1,
    `${label}: long title stays inside the viewport`,
  )
  await assertNoPageOverflow(page, `${label} note`)
  await assertTouchTargets(page, `${label} note`)
  await assertLandmarks(page, `${label} note`)

  // Breadcrumb returns to Travel, then browser Back walks real history.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate(() => {
      document.querySelector('.reader-breadcrumbs a[href="/travel"]')?.click()
    }),
  ])
  assert.match(page.url(), /\/travel\/?$/, `${label}: breadcrumb returns to Travel`)
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.ok(page.url().includes(expect.notePath), `${label}: Back returns to the note`)
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.match(page.url(), /\/travel\/?$/, `${label}: Back returns to Travel`)
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.match(page.url(), /\/$/, `${label}: Back returns home without a parallel stack`)
}

/** Deep note with long breadcrumbs, long titles, tables, code, and images. */
async function runOverflowProbes(page, baseUrl, label) {
  await goto(page, `${baseUrl}/travel/upcoming/japan/itinerary`)
  const crumbs = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-breadcrumbs li")).map((li) => ({
      text: li.textContent?.trim() || "",
      width: li.getBoundingClientRect().width,
    })),
  )
  assert.ok(crumbs.length >= 4, `${label}: deep note keeps full breadcrumb ancestry`)
  const crumbWidths = await page.evaluate(() => ({
    list: document.querySelector(".reader-breadcrumbs ol")?.scrollWidth || 0,
    inner: window.innerWidth,
  }))
  assert.ok(
    crumbWidths.list <= crumbWidths.inner + 1,
    `${label}: breadcrumbs wrap inside the viewport`,
  )
  await assertNoPageOverflow(page, `${label} deep note`)

  await goto(
    page,
    `${baseUrl}/travel/upcoming/an-extremely-long-packing-checklist-title-for-phone-wrapping`,
  )
  const longTitle = await page.evaluate(() => ({
    h1: document.querySelector("article h1")?.textContent?.trim() || "",
    width: document.querySelector("article h1")?.getBoundingClientRect().width || 0,
    inner: window.innerWidth,
  }))
  assert.ok(longTitle.h1.length > 80, `${label}: probe note carries a long title`)
  assert.ok(
    longTitle.width <= longTitle.inner + 1,
    `${label}: long title wraps without obscuring content`,
  )
  await assertNoPageOverflow(page, `${label} long title`)

  // Wide tables, code blocks, and images stay contained locally.
  await goto(page, `${baseUrl}/travel/upcoming/terradets-2026`)
  const media = await page.evaluate(() => {
    const table = document.querySelector("article table")
    const pre = document.querySelector("article pre")
    const img = document.querySelector("article img")
    return {
      inner: window.innerWidth,
      tableClient: table?.clientWidth || 0,
      preClient: pre?.clientWidth || 0,
      imgWidth: img?.getBoundingClientRect().width || 0,
      doc: document.documentElement.scrollWidth,
      resolved: !!document.querySelector('article a.internal[href="/travel"]'),
      unresolved: !!document.querySelector("article a.internal.new"),
    }
  })
  assert.ok(media.tableClient <= media.inner + 1, `${label}: wide table is contained locally`)
  assert.ok(media.preClient <= media.inner + 1, `${label}: code block is contained locally`)
  assert.ok(media.imgWidth <= media.inner + 1, `${label}: wide image is contained locally`)
  assert.equal(media.doc, media.inner, `${label}: no page-level horizontal overflow`)
  assert.ok(media.resolved, `${label}: resolved wikilink renders`)
  assert.ok(media.unresolved, `${label}: unresolved wikilink stays visible`)
}

/** Keyboard: Tab reaches Browse, Enter opens it, Escape closes it. */
async function runKeyboardChecks(page, baseUrl, label) {
  await goto(page, `${baseUrl}/`)
  let focused = null
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab")
    focused = await page.evaluate(() => document.activeElement?.className || "")
    if (String(focused).includes("reader-browse-toggle")) break
  }
  assert.ok(
    String(focused).includes("reader-browse-toggle"),
    `${label}: keyboard Tab reaches the Browse control`,
  )
  const outline = await page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    const style = getComputedStyle(el)
    return { width: style.outlineWidth, style: style.outlineStyle }
  })
  assert.equal(outline?.style, "solid", `${label}: keyboard focus is visible on Browse`)
  assert.equal(outline?.width, "2px", `${label}: keyboard focus ring is 2px on Browse`)
  await page.keyboard.press("Enter")
  await page.waitForFunction(
    () => document.querySelector(".reader-chrome")?.getAttribute("data-browse") === "open",
    { timeout: 5000 },
  )
  assert.equal(await isVisible(page, ".reader-sidebar"), true, `${label}: Enter opens Browse`)
  await page.keyboard.press("Escape")
  await page.waitForFunction(
    () => document.querySelector(".reader-chrome")?.getAttribute("data-browse") === "closed",
    { timeout: 5000 },
  )
  const returned = await page.evaluate(() => document.activeElement?.className || "")
  assert.ok(
    String(returned).includes("reader-browse-toggle"),
    `${label}: Escape closes Browse and returns focus`,
  )
}

/** Desktop keeps the persistent sidebar and hides the Browse control. */
async function runDesktopChecks(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)
  assert.equal(await isVisible(page, ".reader-sidebar"), true, `${label}: sidebar stays visible`)
  assert.equal(
    await isVisible(page, ".reader-browse-toggle"),
    false,
    `${label}: Browse control stays hidden`,
  )
  assert.deepEqual(
    (await browseAreas(page)).map((a) => a.text).sort(),
    [...expect.areas].sort(),
    `${label}: sidebar links the five areas`,
  )
  await goto(page, `${baseUrl}/travel/upcoming/terradets-2026`)
  await assertNoPageOverflow(page, `${label} note`)
  await assertTouchTargets(page, `${label} note`)
  await assertLandmarks(page, `${label} note`)
}

function listFilesRecursive(dir, relative = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...listFilesRecursive(path.join(dir, entry.name), rel))
    else if (entry.isFile()) files.push(rel)
  }
  return files.sort()
}

function assertAbsentEverywhere(outDir, needle, what) {
  const hits = []
  for (const rel of listFilesRecursive(outDir)) {
    if (fs.readFileSync(path.join(outDir, rel)).includes(needle)) hits.push(rel)
  }
  assert.deepEqual(hits, [], `${what} must appear in no emitted file (found: ${hits.join(", ")})`)
}

/** Static output and repository boundary inspection (C12-C14). */
async function runOutputInspection(outDir, workDir, kbRoot) {
  assertAbsentEverywhere(outDir, "Tolaria Vault", "unselected sentinel")
  assertAbsentEverywhere(outDir, "_list_properties_display", "unselected types sentinel")
  assertAbsentEverywhere(outDir, fs.realpathSync(kbRoot), "original vault path")
  assertAbsentEverywhere(outDir, fs.realpathSync(workDir), "private staging path")
  assertAbsentEverywhere(outDir, fs.realpathSync(PUBLISHER_ROOT), "private publisher path")

  const readerSources = ["source.config.ts", "next.config.mjs"]
    .map((file) => path.join(READER_ROOT, file))
    .concat(
      ["app", "lib", "components"].flatMap((dir) => {
        const abs = path.join(READER_ROOT, dir)
        return fs
          .readdirSync(abs, { recursive: true })
          .filter((entry) => /\.(ts|tsx|mjs|css)$/.test(entry))
          .map((entry) => path.join(abs, entry))
      }),
    )
  const forbidden = [
    "workbox",
    "service-worker",
    "serviceWorker",
    "webmanifest",
    "pagefind",
    "flexsearch",
    "lunr",
    "fumadocs-ui",
    "dockerfile",
  ]
  for (const file of readerSources) {
    const text = fs.readFileSync(file, "utf8")
    for (const token of forbidden) {
      assert.ok(
        !text.toLowerCase().includes(token.toLowerCase()),
        `${path.relative(PUBLISHER_ROOT, file)} must not introduce ${token}`,
      )
    }
  }

  // Static and read-only: fixed dependency set, static export, no routes/API.
  const pkg = JSON.parse(fs.readFileSync(path.join(READER_ROOT, "package.json"), "utf8"))
  const allowedDeps = new Set([
    "@flowershow/remark-wiki-link",
    "fumadocs-core",
    "fumadocs-mdx",
    "next",
    "react",
    "react-dom",
  ])
  for (const name of Object.keys(pkg.dependencies || {})) {
    assert.ok(allowedDeps.has(name), `reader runtime dependency ${name} is expected`)
  }
  const config = fs.readFileSync(path.join(READER_ROOT, "next.config.mjs"), "utf8")
  assert.match(config, /output:\s*["']export["']/, "reader emits a serverless static export")
  const routeFiles = listFilesRecursive(path.join(READER_ROOT, "app")).filter((rel) =>
    /(^|\/)route\.ts$/.test(rel),
  )
  assert.deepEqual(routeFiles, [], "reader has no content API routes")
  const emitted = listFilesRecursive(outDir)
  assert.ok(
    !emitted.some((rel) => /sw\.js$|service-worker|workbox|pagefind/i.test(rel)),
    "static output carries no service worker or search index",
  )

  // Generated content stays untracked and ignored.
  const porcelain = (
    await execFileAsync("git", ["status", "--porcelain"], { cwd: PUBLISHER_ROOT })
  ).stdout
    .split("\n")
    .filter(Boolean)
  const generated = porcelain.filter((line) =>
    /^(?:\?\?|..) (content\/|site-identity\.json|reader\/\.source\/|reader\/\.next\/|reader\/out\/)/.test(
      line,
    ),
  )
  assert.deepEqual(
    generated,
    [],
    `generated content stays untracked (got: ${generated.join("; ")})`,
  )
  for (const ignored of ["reader/.source", "reader/.next", "reader/out"]) {
    const check = await execFileAsync("git", ["check-ignore", ignored], { cwd: PUBLISHER_ROOT })
    assert.match(check.stdout, new RegExp(ignored.replace(/\./g, "\\.")), `${ignored} is ignored`)
  }
}

async function buildAndServe(kbRoot) {
  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(kbRoot, contentDir, identityFile)
  fs.rmSync(path.join(READER_ROOT, ".source"), { recursive: true, force: true })
  fs.rmSync(path.join(READER_ROOT, ".next"), { recursive: true, force: true })
  fs.rmSync(path.join(READER_ROOT, "out"), { recursive: true, force: true })
  await buildReader(contentDir, identityFile)
  const outDir = path.join(READER_ROOT, "out")
  for (const rel of ["index.html", "travel.html", "travel/upcoming/terradets-2026.html"]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `static export emits ${rel}`)
  }
  const { server, baseUrl } = await serveOut(outDir)
  return { server, baseUrl, outDir, work }
}

const NARROW_PHONE = { width: 360, height: 800, isMobile: true, hasTouch: true }
const LARGER_PHONE = { width: 414, height: 896, isMobile: true, hasTouch: true }
const DESKTOP = { width: 1280, height: 800 }

async function withPage(browser, viewport, fn) {
  const page = await browser.newPage()
  try {
    await page.setViewport(viewport)
    await fn(page)
  } finally {
    await page.close()
  }
}

test("synthetic phone journey covers Browse, overflow, keyboard, and refresh", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const kb = makePhoneKb()
  const built = await buildAndServe(kb)
  const browser = await launchBrowser()
  const expect = {
    areas: ["Travel", "Shared Finance", "Pets", "Life Planning", "Household Inbox"],
    travelTitle: "Travel",
    noteTitle: "Terradets",
    notePath: "/travel/upcoming/terradets-2026",
  }
  try {
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "narrow phone")
    })
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runOverflowProbes(page, built.baseUrl, "narrow phone")
    })
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runKeyboardChecks(page, built.baseUrl, "narrow phone")
    })
    await withPage(browser, LARGER_PHONE, async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "larger phone")
    })
    await withPage(browser, LARGER_PHONE, async (page) => {
      await runOverflowProbes(page, built.baseUrl, "larger phone")
      // Direct nested URL and browser refresh through the static fallback.
      await goto(page, `${built.baseUrl}/travel/upcoming/terradets-2026`)
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        "Terradets",
        "larger phone: direct nested URL renders",
      )
      await page.reload({ waitUntil: "networkidle0", timeout: 15000 })
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        "Terradets",
        "larger phone: refresh keeps the nested note",
      )
      await assertNoPageOverflow(page, "larger phone refresh")
    })
    await withPage(browser, DESKTOP, async (page) => {
      await runDesktopChecks(page, built.baseUrl, expect, "desktop")
    })
    await runOutputInspection(built.outDir, built.work, kb)
  } finally {
    await browser.close()
    built.server.close()
  }
})

test("real Shared phone journey covers Browse open/close and home to note", async (t) => {
  const kbRoot = process.env.SHARED_KB_ROOT
  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip(
      "SHARED_KB_ROOT is not set to a Shared vault checkout; skipping real-corpus phone journey",
    )
    return
  }
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const built = await buildAndServe(path.resolve(kbRoot))
  const browser = await launchBrowser()
  const expect = {
    areas: ["Travel", "Shared Finance", "Pets", "Life Planning", "Household Inbox"],
    travelTitle: "Travel",
    noteTitle: "Terradets",
    notePath: "/travel/upcoming/terradets-2026",
  }
  try {
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "real narrow phone")
    })
    await withPage(browser, LARGER_PHONE, async (page) => {
      await runOverflowProbes(page, built.baseUrl, "real larger phone")
      await goto(page, `${built.baseUrl}/travel/upcoming/terradets-2026`)
      await page.reload({ waitUntil: "networkidle0", timeout: 15000 })
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        "Terradets",
        "real larger phone: refresh keeps the nested note",
      )
    })
    await withPage(browser, DESKTOP, async (page) => {
      await runDesktopChecks(page, built.baseUrl, expect, "real desktop")
    })
    await runOutputInspection(built.outDir, built.work, path.resolve(kbRoot))
  } finally {
    await browser.close()
    built.server.close()
  }
})
