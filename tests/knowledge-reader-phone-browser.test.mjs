/**
 * Knowledge reader phone journey.
 *
 * Production static export + nginx-style server + production browser at a
 * narrow phone (360), a larger phone (414), and desktop (1280):
 * - phone layouts hide the permanent sidebar and keep content primary;
 * - a compact Browse control opens/closes the same folder-and-note tree;
 * - home -> folder -> nested note works from Browse tree links and article links;
 * - selecting a tree page closes Browse so reading starts immediately;
 * - breadcrumbs wrap, browser Back returns through real history;
 * - touch targets, visible keyboard focus, landmarks, and no page-level
 *   horizontal overflow hold on long titles, wide tables, code, and images;
 * - direct nested URLs and refresh work through the nginx-style fallback;
 * - the static output stays within the publication boundary.
 * - breadcrumbs wrap, browser Back returns through real history;
 * - touch targets, visible keyboard focus, landmarks, and no page-level
 *   horizontal overflow hold on long titles, wide tables, code, and images;
 * - direct nested URLs and refresh work through the nginx-style fallback;
 * - the static output stays within the publication boundary.
 *
 * The synthetic fixture always runs (no vault needed). Expected areas,
 * folder titles, note routes, and overflow probes derive from staged content
 * and generated metadata, never from fixed subject routes. When
 * KNOWLEDGE_BASE_ROOT points at a vault checkout, the same generic journey
 * runs against the real corpus.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-phone-browser.test.mjs
 *   KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-phone-browser.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-phone-${prefix}-`))
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
  await execFileAsync("pnpm", ["run", "build"], {
    cwd: READER_ROOT,
    timeout: 600000,
    env: {
      ...process.env,
      READER_CONTENT_DIR: contentDir,
      READER_SITE_METADATA_FILE: identityFile,
    },
  })
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

function humanizeSegment(seg) {
  const spaced = seg.replace(/[-_]+/g, " ").trim()

  if (spaced === "") return seg

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function stagedFileTitle(absPath, fallback) {
  let text = ""

  try {
    text = fs.readFileSync(absPath, "utf8")
  } catch {
    return fallback
  }

  const lines = text.split("\n")

  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---")

    if (close !== -1) {
      const fm = lines.slice(1, close).join("\n")
      const m = fm.match(/^title:\s*(.+?)\s*$/m)

      if (m) {
        let v = m[1].trim()

        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1)

        if (v.trim() !== "") return v.trim()
      }
    }
  }

  let fenced = false

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }

    if (fenced) continue
    const m = line.match(/^#\s+(.+?)\s*$/)

    if (m) return m[1].trim()
  }

  return fallback
}

/** Count top-level Markdown H1 headings outside fenced code and frontmatter. */
function countTopLevelH1s(absPath) {
  let text = ""

  try {
    text = fs.readFileSync(absPath, "utf8")
  } catch {
    return 0
  }

  const lines = text.split("\n")
  let start = 0

  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---")

    if (close !== -1) start = close + 1
  }

  let fenced = false
  let count = 0

  for (let index = start; index < lines.length; index++) {
    const line = lines[index]

    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }

    if (fenced) continue

    if (/^\s*#\s+.+?\s*$/.test(line)) count++
  }

  return count
}

const LONG_TITLE =
  "An extremely long packing checklist title that keeps going SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious"

const LONG_SLUG = "long-packing-checklist-title-that-keeps-going-for-wrapping-probes"

const PHONE_SENTINEL = "PHONE_FIXTURE_UNSELECTED_4K8M"

/** Neutral synthetic vault with overflow probes (long titles, wide tables, code, images). */
function makePhoneKb() {
  const kb = tmpdir("kb-phone")
  writeFile(
    kb,
    "index.md",
    [
      "---",
      'title: "Garden Home"',
      "---",
      "",
      "# Garden Home",
      "",
      "Welcome to the neutral phone garden.",
      "",
    ].join("\n"),
  )
  writeFile(
    kb,
    "garden/index.md",
    "# Garden Plots\n\nCultivated beds with an authored introduction.\n",
  )
  writeFile(kb, "garden/alpha.md", "# Alpha Bed\n\nFirst bed.\n")
  writeFile(kb, "garden/beta.md", "# Beta Bed\n\nSecond bed.\n")
  writeFile(
    kb,
    "notes/guide.md",
    [
      "---",
      'title: "Field Guide"',
      "---",
      "",
      "# Ignored H1",
      "",
      "Stay in the meadow. See [[Garden Plots]] for the area and [[Missing Page]] for later.",
      "",
      "| Day | Morning | Midday | Afternoon | Evening | Night | Cost | Notes |",
      "|---|---|---|---|---|---|---|---|",
      "| One | Kayak on the lake | Lunch in town | Trek to the viewpoint | Dinner | Sleep | 85 € | Long day |",
      "",
      "```js",
      "const veryLongLineForPhoneOverflowChecks = 'abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz-1234567890-1234567890';",
      "```",
      "",
      "![Meadow view](https://example.com/photos/very-wide-panoramic-meadow-view.jpg)",
      "",
      "Book via [Example](https://example.com/field-guide).",
      "",
    ].join("\n"),
  )
  writeFile(
    kb,
    "notes/plain.md",
    "# Plain Meadow\n\nJust a body.\n\n## Details\n\nSection content.\n",
  )
  writeFile(kb, "notes/nest/inner/leaf.md", "# Inner Leaf\n\nDeep nested note.\n")
  writeFile(kb, `notes/${LONG_SLUG}.md`, `# ${LONG_TITLE}\n\nPack light.\n`)

  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, "0")
    writeFile(kb, `orchard/note-${n}.md`, `# Orchard Note ${n}\n\nFlat orchard note ${n}.\n`)
  }

  writeFile(kb, "standalone.md", "# Lone Pine\n\nStandalone file.\n")
  writeFile(kb, "assets/photo.png", "not-a-real-png")
  writeFile(kb, "unselected.md", `# Unselected\n\n${PHONE_SENTINEL} must never appear.\n`)
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Phone Garden",
      "canonicalHostname: phone.example.com",
      "select:",
      "  - index.md",
      "  - garden",
      "  - notes",
      "  - orchard",
      "  - standalone.md",
      "  - assets",
      "navigation:",
      "  - standalone.md",
      "  - orchard",
      "  - notes",
      "  - garden",
      "",
    ].join("\n"),
  )

  return kb
}

function routeForStagedMarkdown(rel) {
  const posix = rel.split(path.sep).join("/")

  if (/^index\.md$/i.test(posix)) return "/"
  let route = `/${posix.replace(/\.md$/i, "")}`

  if (route.endsWith("/index")) route = route.slice(0, -"/index".length)

  return route || "/"
}

function expectedRootTitle(navEntry, contentDir) {
  if (navEntry.kind === "markdown") {
    const abs = path.join(contentDir, navEntry.path)
    const fallback = path.posix.basename(navEntry.path).replace(/\.md$/i, "")

    return stagedFileTitle(abs, fallback)
  }

  const indexAbs = path.join(contentDir, navEntry.path, "index.md")

  if (fs.existsSync(indexAbs))
    return stagedFileTitle(indexAbs, humanizeSegment(path.posix.basename(navEntry.path)))

  return humanizeSegment(path.posix.basename(navEntry.path))
}

function rootRoute(navEntry) {
  if (navEntry.kind === "markdown") return routeForStagedMarkdown(navEntry.path)

  return `/${navEntry.path}`
}

/**
 * Derive a folder journey from staged content: prefer a directory root with
 * both direct notes and nested subfolders. Returns areas in metadata order
 * plus the chosen folder and its deepest eligible leaf. The leaf prefers
 * staged Markdown with exactly one top-level H1 so the one-primary-heading
 * landmark check stays meaningful; when no single-H1 leaf exists the deepest
 * leaf is kept so the check still fails instead of weakening.
 */
function deriveJourney(contentDir, metadata) {
  const areas = metadata.navigation.map((entry) => expectedRootTitle(entry, contentDir))
  const dirRoots = metadata.navigation.filter((entry) => entry.kind === "directory")
  let folderEntry = null

  for (const entry of dirRoots) {
    const abs = path.join(contentDir, entry.path)
    let direct = 0
    let nested = 0

    try {
      for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
        if (child.isFile() && /\.md$/i.test(child.name) && !/^index\.md$/i.test(child.name))
          direct++

        if (child.isDirectory()) {
          const sub = path.join(abs, child.name)

          const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
              if (e.isFile() && /\.md$/i.test(e.name)) return true

              if (e.isDirectory() && walk(path.join(dir, e.name))) return true
            }

            return false
          }

          if (walk(sub)) nested++
        }
      }
    } catch {}

    if (direct > 0 && nested > 0) {
      folderEntry = entry
      break
    }
  }

  if (!folderEntry) folderEntry = dirRoots[0] ?? metadata.navigation[0]
  const folderTitle = expectedRootTitle(folderEntry, contentDir)
  const folderRoute = rootRoute(folderEntry)
  const candidates = []

  const walkFiles = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name

      if (e.isDirectory()) walkFiles(path.join(dir, e.name), relPath)
      else if (e.isFile() && /\.md$/i.test(e.name) && !/^index\.md$/i.test(e.name)) {
        const prefix = folderEntry.kind === "directory" ? folderEntry.path : null

        if (prefix && !(relPath === prefix || relPath.startsWith(`${prefix}/`))) continue
        candidates.push(relPath)
      }
    }
  }

  walkFiles(contentDir, "")
  const depthOf = (relPath) => relPath.split("/").length
  candidates.sort((a, b) => depthOf(b) - depthOf(a) || (a < b ? -1 : a > b ? 1 : 0))

  const eligible = candidates.filter(
    (relPath) => countTopLevelH1s(path.join(contentDir, relPath)) === 1,
  )

  const leafRel = (eligible.length > 0 ? eligible : candidates)[0] ?? null
  const leafRoute = leafRel ? routeForStagedMarkdown(leafRel) : folderRoute

  const leafTitle = leafRel
    ? stagedFileTitle(
        path.join(contentDir, leafRel),
        path.posix.basename(leafRel).replace(/\.md$/i, ""),
      )
    : folderTitle

  return { areas, folderEntry, folderTitle, folderRoute, leafRel, leafTitle, leafRoute }
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
  for (const selector of [
    ".reader-browse-toggle",
    ".reader-search-trigger",
    ".reader-search-result",
    ".reader-home",
    ".reader-drawer-close",
    ".reader-drawer-home",
    ".reader-area-list a",
    ".reader-group-list a",
    ".reader-breadcrumbs a",
    ".reader-sidebar-nav a",
    ".reader-tree-toggle",
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
    areasNav: !!document.querySelector('nav[aria-label="Published sections"]'),
    breadcrumbNav: !!document.querySelector('nav[aria-label="Breadcrumb"]'),
  }))

  assert.equal(landmarks.mainCount, 1, `${label}: one main landmark`)
  assert.equal(landmarks.h1s.length, 1, `${label}: one primary heading`)
  assert.ok(landmarks.areasNav, `${label}: Published sections navigation landmark`)

  if (breadcrumb) assert.ok(landmarks.breadcrumbNav, `${label}: breadcrumb navigation landmark`)
}

/** Top-level tree roots in rendered order (published root order). */
async function browseRoots(page) {
  return await page.evaluate(() => {
    const scope =
      document.querySelector("#reader-browse-panel .reader-sidebar-nav") ||
      document.querySelector(".reader-sidebar-nav")

    if (!scope) return []

    return Array.from(scope.querySelectorAll(":scope > ul > li")).map((li) => {
      const row = li.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
      )

      const a = row ? row.querySelector("a") : null

      return {
        text: a?.textContent?.trim() || "",
        href: a?.getAttribute("href") || "",
      }
    })
  })
}

async function treeDisclosure(page, route) {
  return await page.evaluate((target) => {
    const scope = document.querySelector("#reader-browse-panel .reader-sidebar-nav") || document
    const li = scope.querySelector(`li[data-tree-url="${target}"]`)

    const button = li
      ? li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
        )
      : null

    return button ? button.getAttribute("aria-expanded") : null
  }, route)
}

async function ensureTreeOpen(page, route) {
  const state = await treeDisclosure(page, route)

  if (state !== "true") {
    assert.equal(state, "false", `tree branch ${route} has a disclosure control`)
    await page.evaluate((target) => {
      const scope = document.querySelector("#reader-browse-panel .reader-sidebar-nav") || document
      const li = scope.querySelector(`li[data-tree-url="${target}"]`)
      li?.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
      )?.click()
    }, route)
    await page.waitForFunction(
      (target) => {
        const scope = document.querySelector("#reader-browse-panel .reader-sidebar-nav") || document
        const li = scope.querySelector(`li[data-tree-url="${target}"]`)

        const button = li
          ? li.querySelector(
              ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
            )
          : null

        return button && button.getAttribute("aria-expanded") === "true"
      },
      { timeout: 5000 },
      route,
    )
  }
}

async function openBrowse(page) {
  await page.evaluate(() => {
    document.querySelector(".reader-browse-toggle")?.click()
  })
  await page.waitForFunction(
    () => document.querySelector(".reader-chrome")?.getAttribute("data-browse") === "open",
    { timeout: 5000 },
  )
  await page.waitForSelector("#reader-browse-panel", { visible: true, timeout: 5000 })
}

async function closeBrowseViaClose(page) {
  await page.evaluate(() => {
    document.querySelector('#reader-browse-panel [data-slot="sheet-close"]')?.click()
  })
  await page.waitForFunction(
    () => document.querySelector(".reader-chrome")?.getAttribute("data-browse") === "closed",
    { timeout: 5000 },
  )
  // The Sheet exit transition keeps the panel visible briefly; wait for
  // it to hide before asserting dismissal.
  await page.waitForSelector("#reader-browse-panel", { hidden: true, timeout: 5000 })
}

/** Phone drawer fills the usable viewport, respects safe areas, and scrolls the tree independently. */
async function assertPhoneDrawerViewport(page, label) {
  const drawer = await page.evaluate(() => {
    const el = document.querySelector("#reader-browse-panel")

    if (!el) return null
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const tree = document.querySelector(".reader-phone-drawer-tree")
    const treeStyle = tree ? getComputedStyle(tree) : null

    return {
      width: rect.width,
      height: rect.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      overflowX: style.overflowX,
      treeOverflowY: treeStyle ? treeStyle.overflowY : "",
      treeScrollHeight: tree ? tree.scrollHeight : 0,
      treeClientHeight: tree ? tree.clientHeight : 0,
      closeText:
        document
          .querySelector('#reader-browse-panel [data-slot="sheet-close"]')
          ?.textContent?.trim() || "",
      closeHeight:
        document
          .querySelector('#reader-browse-panel [data-slot="sheet-close"]')
          ?.getBoundingClientRect().height || 0,
      homeVisible: (() => {
        const home = document.querySelector("#reader-browse-panel .reader-drawer-home")

        if (!home) return false
        const rect = home.getBoundingClientRect()

        return rect.width > 0 && rect.height > 0
      })(),
      drawerSearchText:
        document
          .querySelector("#reader-browse-panel .reader-search-trigger")
          ?.textContent?.trim() || "",
      drawerSearchHeight:
        document
          .querySelector("#reader-browse-panel .reader-search-trigger")
          ?.getBoundingClientRect().height || 0,
      dialogRole: document.querySelector("#reader-browse-panel")?.getAttribute("role") || "",
      labelledBy:
        document.querySelector("#reader-browse-panel")?.getAttribute("aria-labelledby") || "",
    }
  })

  assert.ok(drawer, `${label}: phone drawer is in the document`)
  assert.ok(
    drawer.width >= drawer.innerWidth - 2,
    `${label}: drawer fills viewport width (${drawer.width}px vs ${drawer.innerWidth}px)`,
  )
  assert.ok(
    drawer.height >= drawer.innerHeight - 2,
    `${label}: drawer fills viewport height (${drawer.height}px vs ${drawer.innerHeight}px)`,
  )
  assert.ok(
    drawer.treeOverflowY === "auto" || drawer.treeOverflowY === "scroll",
    `${label}: tree scrolls independently (overflow-y ${drawer.treeOverflowY})`,
  )
  assert.equal(drawer.closeText, "Close", `${label}: drawer has a visible named Close`)
  assert.ok(drawer.closeHeight >= 44, `${label}: Close is ${drawer.closeHeight}px (expected >= 44)`)
  assert.ok(drawer.homeVisible, `${label}: drawer Home stays reachable`)
  assert.equal(drawer.drawerSearchText, "Search", `${label}: drawer Search stays reachable`)
  assert.ok(
    drawer.drawerSearchHeight >= 44,
    `${label}: drawer Search is ${drawer.drawerSearchHeight}px (expected >= 44)`,
  )
  assert.ok(
    drawer.dialogRole === "dialog" || drawer.dialogRole === "alertdialog",
    `${label}: drawer is a dialog (role ${drawer.dialogRole})`,
  )
}

/** Background stays locked while the drawer is open and releases on close. */
async function assertBackgroundScrollLock(page, label) {
  const locked = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyStyle: document.body.style.overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
  }))

  assert.ok(
    locked.bodyOverflow === "hidden" ||
      locked.bodyStyle === "hidden" ||
      locked.htmlOverflow === "hidden" ||
      document.body.hasAttribute("data-scroll-locked"),
    `${label}: background scroll locks while the drawer is open (body ${locked.bodyOverflow}/${locked.bodyStyle})`,
  )
}

/** Phone assertions: drawer hidden until Browse opens, then home -> folder -> note. */
async function runPhoneJourney(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)
  assert.equal(
    await isVisible(page, "#reader-browse-panel"),
    false,
    `${label}: phone drawer stays hidden until Browse opens`,
  )
  assert.ok(await isVisible(page, ".reader-browse-toggle"), `${label}: Browse control is visible`)

  const toggleHeight = await page.evaluate(
    () => document.querySelector(".reader-browse-toggle")?.getBoundingClientRect().height,
  )

  assert.ok(toggleHeight >= 44, `${label}: Browse control is ${toggleHeight}px (expected >= 44)`)
  await assertNoPageOverflow(page, `${label} home`)
  await assertLandmarks(page, `${label} home`, { breadcrumb: false })

  await openBrowse(page)
  assert.equal(
    await isVisible(page, "#reader-browse-panel"),
    true,
    `${label}: Browse opens the drawer`,
  )
  await assertPhoneDrawerViewport(page, `${label} drawer`)
  await assertBackgroundScrollLock(page, `${label} drawer`)

  // Focus moves into the drawer while it is open.
  const focusInDrawer = await page.evaluate(() => {
    const panel = document.querySelector("#reader-browse-panel")
    const active = document.activeElement

    return !!panel && !!active && panel.contains(active)
  })

  assert.ok(focusInDrawer, `${label}: focus stays in the drawer while open`)

  // Drawer Search opens the one shared dialog; dismissing it returns
  // focus into the still-open drawer without a second dialog.
  await page.evaluate(() => {
    document.querySelector("#reader-browse-panel .reader-search-trigger")?.click()
  })
  await searchDialogOpen(page)
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('[data-slot="dialog-content"]').length),
    1,
    `${label}: drawer Search opens the shared dialog`,
  )
  await page.keyboard.press("Escape")
  await searchDialogClosed(page)

  const focusBackInDrawer = await page.evaluate(() => {
    const panel = document.querySelector("#reader-browse-panel")
    const active = document.activeElement

    return !!panel && !!active && panel.contains(active)
  })

  assert.ok(focusBackInDrawer, `${label}: Search close returns focus into the drawer`)
  assert.equal(
    await isVisible(page, "#reader-browse-panel"),
    true,
    `${label}: drawer stays open after Search closes`,
  )

  const expanded = await page.evaluate(() =>
    document.querySelector(".reader-browse-toggle")?.getAttribute("aria-expanded"),
  )

  assert.equal(expanded, "true", `${label}: Browse reports its open state`)
  const roots = await browseRoots(page)
  assert.deepEqual(
    roots.map((a) => a.text),
    expect.areas,
    `${label}: Browse shows the same tree roots in published order`,
  )

  await closeBrowseViaClose(page)
  assert.equal(
    await isVisible(page, "#reader-browse-panel"),
    false,
    `${label}: Close dismisses the drawer`,
  )
  const focusReturned = await page.evaluate(() => document.activeElement?.className || "")

  assert.ok(
    String(focusReturned).includes("reader-browse-toggle"),
    `${label}: dismissing returns focus to Browse`,
  )

  const folderHref = (
    await page.evaluate(() =>
      Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => ({
        text: a.textContent?.trim() || "",
        href: a.getAttribute("href") || "",
      })),
    )
  ).find((l) => l.text === expect.folderTitle)?.href

  assert.ok(folderHref, `${label}: home links the folder from staged content`)
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      document.querySelector(`.reader-area-list a[href="${href}"]`)?.click()
    }, folderHref),
  ])
  assert.ok(page.url().includes(expect.folderRoute), `${label}: folder opens its route`)
  await assertNoPageOverflow(page, `${label} folder`)
  await assertTouchTargets(page, `${label} folder`)

  await openBrowse(page)
  assert.equal(
    await isVisible(page, "#reader-browse-panel"),
    true,
    `${label}: Browse opens the tree`,
  )

  // The phone tree carries the nested note with its static route.
  const leafInTree = await page.evaluate((route) => {
    const scope = document.querySelector("#reader-browse-panel .reader-sidebar-nav") || document
    const a = scope.querySelector(`a[href="${route}"]`)

    return a ? a.textContent?.trim() || "" : null
  }, expect.leafRoute)

  assert.equal(leafInTree, expect.leafTitle, `${label}: Browse tree reaches the nested note`)

  // Deep branches and long titles stay readable while browsing.
  const panelReadable = await page.evaluate(() => {
    const scope = document.querySelector("#reader-browse-panel .reader-sidebar-nav") || document
    const links = Array.from(scope.querySelectorAll("a"))

    const toggles = Array.from(
      (document.querySelector("#reader-browse-panel") || document).querySelectorAll(
        ".reader-tree-toggle",
      ),
    )

    return {
      widest: Math.max(0, ...links.map((a) => a.getBoundingClientRect().right)),
      inner: window.innerWidth,
      toggleHeights: toggles
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => b.getBoundingClientRect().height),
    }
  })

  assert.ok(
    panelReadable.widest <= panelReadable.inner + 1,
    `${label}: tree links stay inside the phone viewport`,
  )

  for (const height of panelReadable.toggleHeights) {
    assert.ok(height >= 44, `${label}: tree disclosure is ${height}px (expected >= 44)`)
  }

  // Open the nested branches, then select the note: Browse closes and
  // reading starts on the note route.
  const segments = expect.leafRoute.split("/").filter(Boolean)

  for (let i = 1; i < segments.length; i++) {
    await ensureTreeOpen(page, `/${segments.slice(0, i).join("/")}`)
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((route) => {
      const scope = document.querySelector("#reader-browse-panel .reader-sidebar-nav") || document
      scope.querySelector(`a[href="${route}"]`)?.click()
    }, expect.leafRoute),
  ])
  assert.ok(
    page.url().includes(expect.leafRoute),
    `${label}: nested note route ${expect.leafRoute}`,
  )
  await page.waitForFunction(
    () => document.querySelector(".reader-chrome")?.getAttribute("data-browse") === "closed",
    { timeout: 5000 },
  )
  assert.equal(
    await isVisible(page, "#reader-browse-panel"),
    false,
    `${label}: selecting a tree page closes the drawer`,
  )

  const drawerUrlState = await page.evaluate(() => ({
    hash: window.location.hash,
    search: window.location.search,
  }))

  assert.equal(drawerUrlState.hash, "", `${label}: drawer adds no URL hash state`)
  assert.ok(!drawerUrlState.search.includes("browse"), `${label}: drawer adds no URL query state`)

  const note = await page.evaluate(() => ({
    h1: document.querySelector("article h1")?.textContent?.trim() || "",
    crumbs: Array.from(document.querySelectorAll(".reader-breadcrumbs li")).map((li) => ({
      text: li.textContent?.trim() || "",
      href: li.querySelector("a")?.getAttribute("href") || null,
    })),
    h1Rect: document.querySelector("article h1")?.getBoundingClientRect().toJSON() || null,
    media: { viewport: window.innerWidth },
  }))

  assert.equal(note.h1, expect.leafTitle, `${label}: nested note title`)
  assert.ok(note.crumbs.length >= 3, `${label}: breadcrumbs expose folder ancestry`)
  assert.ok(
    note.h1Rect && note.h1Rect.width <= note.media.viewport + 1,
    `${label}: long title stays inside the viewport`,
  )
  await assertNoPageOverflow(page, `${label} note`)
  await assertTouchTargets(page, `${label} note`)
  await assertLandmarks(page, `${label} note`)

  const crumbHref = note.crumbs.length > 1 ? note.crumbs[1].href : null
  assert.ok(crumbHref, `${label}: breadcrumbs link a parent`)
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      document.querySelector(`.reader-breadcrumbs a[href="${href}"]`)?.click()
    }, crumbHref),
  ])
  // Timing-only stabilization: history traversals between static pages
  // can resolve while already idle, so each Back awaits its observable
  // route before the next traversal. Same three traversals, same expected
  // URLs, no fixed sleeps.
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  await page.waitForFunction(
    (route) => window.location.href.includes(route),
    { timeout: 15000 },
    expect.leafRoute,
  )
  assert.ok(page.url().includes(expect.leafRoute), `${label}: Back returns to the note`)
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  await page.waitForFunction(
    (route) => window.location.pathname === route || window.location.pathname === `${route}/`,
    { timeout: 15000 },
    expect.folderRoute,
  )
  assert.ok(page.url().includes(expect.folderRoute), `${label}: Back returns to the folder`)
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  await page.waitForFunction(() => window.location.href.endsWith("/"), { timeout: 15000 })
  assert.match(page.url(), /\/$/, `${label}: Back returns home without a parallel stack`)
}

function listStagedMarkdown(contentDir) {
  const out = []

  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath)
      else if (entry.isFile() && /\.mdx?$/.test(entry.name)) out.push(relPath)
    }
  }

  walk(contentDir, "")

  return out.sort()
}

function firstStagedH1(text) {
  let fenced = false

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }

    if (fenced) continue
    const match = /^\s*#\s+(.+?)\s*$/.exec(line)

    if (match) return match[1].trim()
  }

  return ""
}

function frontmatterTitle(text) {
  const lines = text.split("\n")

  if (lines[0]?.trim() !== "---") return ""
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---")

  if (close === -1) return ""
  const fm = lines.slice(1, close).join("\n")
  const m = fm.match(/^title:\s*(.+?)\s*$/m)

  if (!m) return ""
  let v = m[1].trim()

  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1)

  return v.trim()
}

/**
 * Overflow probes derived from staged content: the deepest staged route
 * keeps breadcrumb ancestry; the longest H1 wraps; the first staged notes
 * carrying a table, code fence, or image keep those elements contained.
 * Every probed page also asserts no page-level overflow. The image probe is
 * required unless `requireImage` is false, so real-corpus runs survive
 * vaults with no Markdown image syntax while the synthetic fixture keeps
 * requiring it.
 */
function deriveProbes(contentDir, { requireImage = true } = {}) {
  const probes = { deep: null, longTitle: null, table: null, code: null, image: null }

  for (const rel of listStagedMarkdown(contentDir)) {
    const text = fs.readFileSync(path.join(contentDir, rel), "utf8")
    const route = routeForStagedMarkdown(rel)

    if (route === "/") continue
    const segments = route.split("/").filter(Boolean).length

    if (!probes.deep || segments > probes.deep.segments) probes.deep = { route, segments }
    const h1 = frontmatterTitle(text) || firstStagedH1(text)

    if (h1 && (!probes.longTitle || h1.length > probes.longTitle.title.length)) {
      probes.longTitle = { route, title: h1 }
    }

    if (!probes.table && /^\s*\|.*\|\s*$/m.test(text)) probes.table = { route }

    if (!probes.code && /^```/m.test(text)) probes.code = { route }

    if (!probes.image && /!\[[^\]]*\]\(/.test(text)) probes.image = { route }
  }

  assert.ok(probes.deep, "staged content has a nested note for breadcrumb probes")
  assert.ok(probes.longTitle, "staged content has a titled note for title probes")
  assert.ok(probes.table, "staged content has a table note for containment probes")

  if (requireImage) {
    assert.ok(probes.image, "staged content has an image note for containment probes")
  }

  return probes
}

async function runDerivedOverflowProbes(
  page,
  baseUrl,
  contentDir,
  label,
  { checkWiki = false, requireImage = true } = {},
) {
  const probes = deriveProbes(contentDir, { requireImage })

  await goto(page, `${baseUrl}${probes.deep.route}`)

  const crumbs = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-breadcrumbs li")).map((li) => ({
      text: li.textContent?.trim() || "",
    })),
  )

  assert.ok(
    crumbs.length >= probes.deep.segments + 1,
    `${label}: deep note keeps full breadcrumb ancestry (${probes.deep.route})`,
  )

  const crumbWidths = await page.evaluate(() => ({
    list: document.querySelector(".reader-breadcrumbs ol")?.scrollWidth || 0,
    inner: window.innerWidth,
  }))

  assert.ok(
    crumbWidths.list <= crumbWidths.inner + 1,
    `${label}: breadcrumbs wrap inside the viewport`,
  )
  await assertNoPageOverflow(page, `${label} deep note`)

  await goto(page, `${baseUrl}${probes.longTitle.route}`)

  const longTitle = await page.evaluate(() => ({
    h1: document.querySelector("article h1")?.textContent?.trim() || "",
    width: document.querySelector("article h1")?.getBoundingClientRect().width || 0,
    inner: window.innerWidth,
  }))

  assert.ok(longTitle.h1.length > 40, `${label}: probe note carries a long title`)
  assert.ok(
    longTitle.width <= longTitle.inner + 1,
    `${label}: long title wraps without obscuring content`,
  )
  await assertNoPageOverflow(page, `${label} long title`)

  await goto(page, `${baseUrl}${probes.table.route}`)

  const table = await page.evaluate(() => {
    const el = document.querySelector("article table")

    return { present: !!el, client: el?.clientWidth || 0, inner: window.innerWidth }
  })

  assert.ok(table.present, `${label}: probe note renders a table (${probes.table.route})`)
  assert.ok(table.client <= table.inner + 1, `${label}: wide table is contained locally`)
  await assertNoPageOverflow(page, `${label} table note`)

  if (probes.image) {
    // External Markdown images can keep the network idle indefinitely, so the
    // image probe navigates on DOM content and still asserts presence,
    // containment, and page overflow below.
    await page.goto(`${baseUrl}${probes.image.route}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    })

    const image = await page.evaluate(() => ({
      present: !!document.querySelector("article img"),
      width: document.querySelector("article img")?.getBoundingClientRect().width || 0,
      inner: window.innerWidth,
    }))

    assert.ok(image.present, `${label}: probe note renders an image (${probes.image.route})`)
    assert.ok(image.width <= image.inner + 1, `${label}: wide image is contained locally`)
    await assertNoPageOverflow(page, `${label} image note`)
  }

  if (probes.code) {
    await goto(page, `${baseUrl}${probes.code.route}`)

    const code = await page.evaluate(() => {
      const el = document.querySelector("article pre")

      return { present: !!el, client: el?.clientWidth || 0, inner: window.innerWidth }
    })

    assert.ok(code.present, `${label}: probe note renders a code block (${probes.code.route})`)
    assert.ok(code.client <= code.inner + 1, `${label}: code block is contained locally`)
    await assertNoPageOverflow(page, `${label} code note`)
  }

  if (checkWiki) {
    await goto(page, `${baseUrl}${probes.table.route}`)

    const wiki = await page.evaluate(() => ({
      resolved: !!document.querySelector("article a.internal:not(.new)"),
      unresolved: !!document.querySelector("article a.internal.new"),
    }))

    assert.ok(wiki.resolved, `${label}: resolved wikilink renders`)
    assert.ok(wiki.unresolved, `${label}: unresolved wikilink stays visible`)
  }
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
  await page.waitForSelector("#reader-browse-panel", { visible: true, timeout: 5000 })
  assert.equal(
    await isVisible(page, "#reader-browse-panel"),
    true,
    `${label}: Enter opens the drawer`,
  )
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

/** Desktop keeps the persistent registry sidebar and hides the Browse control. */
async function runDesktopChecks(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)
  assert.equal(
    await isVisible(page, '[data-slot="sidebar"]'),
    true,
    `${label}: registry sidebar stays visible`,
  )
  assert.equal(
    await isVisible(page, ".reader-browse-toggle"),
    false,
    `${label}: Browse control stays hidden`,
  )
  assert.deepEqual(
    (await browseRoots(page)).map((a) => a.text),
    expect.areas,
    `${label}: sidebar keeps published root order`,
  )
  await goto(page, `${baseUrl}${expect.leafRoute}`)
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

/** Static output and repository boundary inspection. */
async function runOutputInspection(outDir, workDir, kbRoot, sentinel) {
  if (sentinel) assertAbsentEverywhere(outDir, sentinel, "unselected sentinel")
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

  // Offline support is the sanctioned service-worker use: the generated
  // worker and its registration may mention workbox and service workers.
  // Bundled search engines stay out; publication still has no content API.
  const forbidden = ["pagefind", "flexsearch", "lunr", "fumadocs-ui", "dockerfile"]

  for (const file of readerSources) {
    const text = fs.readFileSync(file, "utf8")

    for (const token of forbidden) {
      assert.ok(
        !text.toLowerCase().includes(token.toLowerCase()),
        `${path.relative(PUBLISHER_ROOT, file)} must not introduce ${token}`,
      )
    }
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(READER_ROOT, "package.json"), "utf8"))

  const allowedDeps = new Set([
    "@base-ui/react",
    "@flowershow/remark-wiki-link",
    "class-variance-authority",
    "cn",
    "fumadocs-core",
    "fumadocs-mdx",
    "lucide-react",
    "minisearch",
    "next",
    "react",
    "react-dom",
    "tw-animate-css",
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
    !emitted.some((rel) => /pagefind/i.test(rel)),
    "static output carries no pagefind bundle",
  )
  assert.ok(
    emitted.includes("sw.js") && emitted.includes("offline.json"),
    "static export carries the generated offline worker and manifest",
  )

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
  const metadata = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  const journey = deriveJourney(contentDir, metadata)
  fs.rmSync(path.join(READER_ROOT, ".source"), { recursive: true, force: true })
  fs.rmSync(path.join(READER_ROOT, ".next"), { recursive: true, force: true })
  fs.rmSync(path.join(READER_ROOT, "out"), { recursive: true, force: true })
  await buildReader(contentDir, identityFile)
  const outDir = path.join(READER_ROOT, "out")

  for (const rel of [
    "index.html",
    `${journey.folderRoute.replace(/^\//, "")}.html`,
    `${journey.leafRoute.replace(/^\//, "")}.html`,
  ]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `static export emits ${rel}`)
  }

  const { server, baseUrl } = await serveOut(outDir)

  return { server, baseUrl, outDir, work, contentDir, metadata, journey }
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

/** Wait until the Search dialog is open with its input focused. */
async function searchDialogOpen(page) {
  await page.waitForSelector('[data-slot="dialog-content"]', { visible: true, timeout: 5000 })
  await page.waitForFunction(
    () => document.activeElement && document.activeElement.id === "reader-search-input",
    { timeout: 5000 },
  )
}

async function searchDialogClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'), {
    timeout: 5000,
  })
}

/** Set the dialog query the way React observes it (controlled input). */
async function setPhoneSearchQuery(page, text) {
  await page.evaluate((value) => {
    const el = document.getElementById("reader-search-input")

    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    setter.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }, text)
}

/**
 * Search dialog at phone width: header control, states, touch targets,
 * keyboard journey to a static route, shortcut open, focus return.
 */
async function runPhoneSearchDialog(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)
  assert.ok(
    await isVisible(page, ".reader-search-header"),
    `${label}: header Search control is visible`,
  )
  assert.equal(
    await isVisible(page, ".reader-search-sidebar"),
    false,
    `${label}: sidebar Search stays hidden with the panel`,
  )

  const triggerHeight = await page.evaluate(
    () => document.querySelector(".reader-search-header")?.getBoundingClientRect().height,
  )

  assert.ok(triggerHeight >= 44, `${label}: header Search is ${triggerHeight}px (expected >= 44)`)

  await page.evaluate(() => document.querySelector(".reader-search-header")?.click())
  await searchDialogOpen(page)

  const dialogMeta = await page.evaluate(() => ({
    title:
      document
        .querySelector('[data-slot="dialog-content"] [data-slot="dialog-title"]')
        ?.textContent?.trim() || "",
    labelled: !!document.querySelector('label[for="reader-search-input"]'),
    live: document.querySelector(".reader-search-status")?.getAttribute("aria-live") || "",
    status: document.querySelector(".reader-search-status")?.textContent?.trim() || "",
  }))

  assert.equal(dialogMeta.title, "Search", `${label}: dialog is labelled Search`)
  assert.ok(dialogMeta.labelled, `${label}: search input is labeled`)
  assert.equal(dialogMeta.live, "polite", `${label}: state changes announce politely`)
  assert.ok(dialogMeta.status.includes("Type to find a note"), `${label}: empty state shows`)

  await setPhoneSearchQuery(page, "zzz-no-such-note-qqq9")
  await page.waitForFunction(
    () => document.querySelector(".reader-search-status")?.textContent?.includes("No results"),
    { timeout: 10000 },
  )

  await setPhoneSearchQuery(page, expect.leafTitle)
  await page.waitForSelector(".reader-search-result", { visible: true, timeout: 10000 })

  const results = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-search-result")).map((a) => ({
      title: a.querySelector(".reader-search-result-title")?.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
      excerpt: a.querySelector(".reader-search-result-excerpt")?.textContent?.trim() || "",
    })),
  )

  assert.ok(results.length > 0, `${label}: typing shows ranked results`)

  for (const hit of results) {
    assert.ok(hit.title.length > 0, `${label}: each result carries a title`)
    assert.ok(hit.href.startsWith("/"), `${label}: each result carries a static location`)
    assert.ok(hit.excerpt.length > 0, `${label}: each result carries an excerpt`)
  }

  assert.ok(
    results.some((hit) => hit.href === expect.leafRoute),
    `${label}: results reach the nested note`,
  )

  for (const height of await visibleHeights(page, ".reader-search-result")) {
    assert.ok(height >= 44, `${label}: result touch target is ${height}px (expected >= 44)`)
  }

  await assertNoPageOverflow(page, `${label} search dialog`)

  const firstHref = results[0].href

  const activeEndsWith = async (suffix) =>
    await page.evaluate(
      (end) =>
        document
          .getElementById("reader-search-input")
          ?.getAttribute("aria-activedescendant")
          ?.endsWith(end) || false,
      suffix,
    )

  assert.ok(await activeEndsWith("-option-0"), `${label}: first result starts highlighted`)

  if (results.length > 1) {
    await page.keyboard.press("ArrowDown")
    assert.ok(await activeEndsWith("-option-1"), `${label}: ArrowDown moves the highlight`)
    await page.keyboard.press("ArrowUp")
    assert.ok(await activeEndsWith("-option-0"), `${label}: ArrowUp returns the highlight`)
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.keyboard.press("Enter"),
  ])
  assert.ok(page.url().includes(firstHref), `${label}: Enter opens the static route`)
  assert.equal(
    await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
    results[0].title,
    `${label}: result navigation lands on the right page`,
  )

  await goto(page, `${baseUrl}/`)
  await page.evaluate(() => document.querySelector(".reader-search-header")?.focus())
  await page.keyboard.down("Control")
  await page.keyboard.press("k")
  await page.keyboard.up("Control")
  await searchDialogOpen(page)
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('[data-slot="dialog-content"]').length),
    1,
    `${label}: shortcut opens exactly one dialog`,
  )
  await page.keyboard.press("Escape")
  await searchDialogClosed(page)
  const returned = await page.evaluate(() => document.activeElement?.className || "")
  assert.ok(
    String(returned).includes("reader-search-header"),
    `${label}: Escape returns focus to the header control`,
  )
  await assertTouchTargets(page, `${label} search`)
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
    areas: built.journey.areas,
    folderTitle: built.journey.folderTitle,
    folderRoute: built.journey.folderRoute,
    leafTitle: built.journey.leafTitle,
    leafRoute: built.journey.leafRoute,
  }

  try {
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "narrow phone")
    })
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runDerivedOverflowProbes(page, built.baseUrl, built.contentDir, "narrow phone", {
        checkWiki: true,
        requireImage: true,
      })
    })
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runKeyboardChecks(page, built.baseUrl, "narrow phone")
    })
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runPhoneSearchDialog(page, built.baseUrl, expect, "narrow phone")
    })
    await withPage(browser, LARGER_PHONE, async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "larger phone")
    })
    await withPage(browser, LARGER_PHONE, async (page) => {
      await runDerivedOverflowProbes(page, built.baseUrl, built.contentDir, "larger phone", {
        checkWiki: true,
        requireImage: true,
      })
      await goto(page, `${built.baseUrl}${expect.leafRoute}`)
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        expect.leafTitle,
        "larger phone: direct nested URL renders",
      )
      await page.reload({ waitUntil: "networkidle0", timeout: 15000 })
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        expect.leafTitle,
        "larger phone: refresh keeps the nested note",
      )
      await assertNoPageOverflow(page, "larger phone refresh")
    })
    await withPage(browser, DESKTOP, async (page) => {
      await runDesktopChecks(page, built.baseUrl, expect, "desktop")
    })
    await runOutputInspection(built.outDir, built.work, kb, PHONE_SENTINEL)
  } finally {
    await browser.close()
    built.server.close()
  }
})

test("generic real phone journey covers Browse open/close and home to note", async (t) => {
  const kbRoot = process.env.KNOWLEDGE_BASE_ROOT

  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip("KNOWLEDGE_BASE_ROOT is not set to a vault checkout; skipping real-corpus phone journey")

    return
  }

  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const built = await buildAndServe(path.resolve(kbRoot))
  const browser = await launchBrowser()

  const expect = {
    areas: built.journey.areas,
    folderTitle: built.journey.folderTitle,
    folderRoute: built.journey.folderRoute,
    leafTitle: built.journey.leafTitle,
    leafRoute: built.journey.leafRoute,
  }

  try {
    await withPage(browser, NARROW_PHONE, async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "real narrow phone")
    })
    await withPage(browser, LARGER_PHONE, async (page) => {
      await runDerivedOverflowProbes(page, built.baseUrl, built.contentDir, "real larger phone", {
        requireImage: false,
      })
      await goto(page, `${built.baseUrl}${expect.leafRoute}`)
      await page.reload({ waitUntil: "networkidle0", timeout: 15000 })
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        expect.leafTitle,
        "real larger phone: refresh keeps the nested note",
      )
    })
    await withPage(browser, DESKTOP, async (page) => {
      await runDesktopChecks(page, built.baseUrl, expect, "real desktop")
    })
    await runOutputInspection(built.outDir, built.work, path.resolve(kbRoot), null)
  } finally {
    await browser.close()
    built.server.close()
  }
})
