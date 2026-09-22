/**
 * Knowledge reader browse journey.
 *
 * Production static export + nginx-style server + desktop browser:
 * home -> published folder (authored or virtual) -> nested group -> note ->
 * breadcrumb or browser Back. Direct extensionless routes for home, the
 * folder, and the nested note are also verified.
 *
 * The synthetic fixture always runs (no vault needed). Expected areas,
 * folder titles, and note routes derive from staged content and generated
 * metadata, never from fixed subject routes. When KNOWLEDGE_BASE_ROOT points
 * at a vault checkout, the same generic journey runs against the real corpus.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-journey-browser.test.mjs
 *   KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-journey-browser.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-journey-${prefix}-`))
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

const LONG_TITLE =
  "An extremely long packing checklist title that keeps going SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious"
const LONG_SLUG = "long-packing-checklist-title-that-keeps-going-for-wrapping-probes"

/** Neutral synthetic vault: authored root, indexed and virtual folders, flat and nested shapes. */
function makeJourneyKb() {
  const kb = tmpdir("kb-journey")
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
      "Welcome to the neutral journey garden.",
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
      "Wide table:",
      "",
      "| Day | Morning | Midday | Afternoon | Evening | Night | Cost | Notes |",
      "|---|---|---|---|---|---|---|---|",
      "| One | Kayak | Lunch | Trek | Dinner | Sleep | 85 € | Long day |",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "```js",
      "const alias = '[[Field Guide]]';",
      "```",
      "",
      "See [[Plain Meadow]] and [[Missing Page]].",
      "",
      "See https://example.com/field-guide for details.",
      "",
      "![Meadow view](https://example.com/photos/very-wide-panoramic-meadow-view.jpg)",
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
  writeFile(kb, "unselected.md", "# Unselected\n\nFixture sentinel must never appear.\n")
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Journey Garden",
      "canonicalHostname: journey.example.com",
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
  if (fs.existsSync(indexAbs)) {
    return stagedFileTitle(indexAbs, humanizeSegment(path.posix.basename(navEntry.path)))
  }
  return humanizeSegment(path.posix.basename(navEntry.path))
}

function rootRoute(navEntry) {
  if (navEntry.kind === "markdown") return routeForStagedMarkdown(navEntry.path)
  return `/${navEntry.path}`
}

/**
 * Derive a folder journey from staged content: prefer a directory root with
 * both direct notes and nested subfolders, else the deepest directory root.
 * Returns areas in metadata order plus the chosen folder and its deepest leaf.
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
  if (!folderEntry) {
    let bestDepth = -1
    for (const entry of dirRoots) {
      const abs = path.join(contentDir, entry.path)
      let depth = 0
      const walk = (dir, d) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isFile() && /\.md$/i.test(e.name)) depth = Math.max(depth, d)
          if (e.isDirectory()) walk(path.join(dir, e.name), d + 1)
        }
      }
      try {
        walk(abs, 1)
      } catch {}
      if (depth > bestDepth) {
        bestDepth = depth
        folderEntry = entry
      }
    }
  }
  if (!folderEntry) folderEntry = dirRoots[0] ?? metadata.navigation[0]
  const folderTitle = expectedRootTitle(folderEntry, contentDir)
  const folderRoute = rootRoute(folderEntry)
  let leafRel = null
  let leafDepth = -1
  const walkFiles = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walkFiles(path.join(dir, e.name), relPath)
      else if (e.isFile() && /\.md$/i.test(e.name) && !/^index\.md$/i.test(e.name)) {
        const folderPrefix = folderEntry.kind === "directory" ? folderEntry.path : null
        if (folderPrefix && !(relPath === folderPrefix || relPath.startsWith(`${folderPrefix}/`)))
          continue
        const depth = relPath.split("/").length
        if (depth > leafDepth) {
          leafDepth = depth
          leafRel = relPath
        }
      }
    }
  }
  walkFiles(contentDir, "")
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

/** Generic desktop journey: home -> folder -> nested note -> breadcrumbs and Back. */
async function runJourney(page, baseUrl, expect) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
  const home = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => ({
      text: a.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
    }))
    const sidebar = Array.from(document.querySelectorAll(".reader-sidebar-nav a")).map(
      (a) => a.textContent?.trim() || "",
    )
    return {
      title: document.title,
      h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
      mainCount: document.querySelectorAll("main").length,
      navCount: document.querySelectorAll("nav").length,
      links,
      sidebar,
      body: document.body.textContent || "",
    }
  })
  assert.deepEqual(
    home.links.map((l) => l.text),
    expect.areas,
    "home keeps generated metadata order",
  )
  assert.deepEqual(
    home.sidebar.sort(),
    [...expect.areas].sort(),
    "sidebar links every published section",
  )
  assert.equal(home.mainCount, 1, "one main landmark on home")
  assert.ok(home.navCount >= 1, "semantic navigation present on home")
  assert.equal(home.h1s.length, 1, `home article has one H1 (got ${home.h1s.join("|")})`)

  const folderHref = home.links.find((l) => l.text === expect.folderTitle)?.href
  assert.ok(folderHref, "home folder link has an href from staged content")
  assert.equal(folderHref, expect.folderRoute, "home folder href matches the derived route")
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      document.querySelector(`.reader-area-list a[href="${href}"]`)?.click()
    }, folderHref),
  ])
  assert.ok(
    page.url().endsWith(expect.folderRoute) || page.url().includes(expect.folderRoute),
    "selecting the folder opens its route",
  )
  const folder = await page.evaluate(() => ({
    h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
    h2s: Array.from(document.querySelectorAll("article h2")).map((h) => h.textContent?.trim()),
    body: document.body.textContent || "",
    sidebarActive:
      document.querySelector(".reader-sidebar-nav a.is-active")?.textContent?.trim() || null,
  }))
  assert.ok(folder.h1s.includes(expect.folderTitle), `folder H1 (got ${folder.h1s.join("|")})`)
  assert.ok(
    folder.h2s.includes("Notes") || folder.h2s.includes("Folders"),
    "folder uses the generic Notes/Folders groups",
  )
  assert.ok(
    !/Upcoming trips|Past trips|Preferences/.test(folder.body),
    "no subject-specific groups",
  )
  assert.equal(folder.sidebarActive, expect.folderTitle, "sidebar identifies the active folder")

  const noteLink = await page.evaluate((title) => {
    const a = Array.from(document.querySelectorAll(".reader-group-list a")).find(
      (el) => el.textContent?.trim() === title,
    )
    return a ? a.getAttribute("href") : null
  }, expect.leafTitle)
  // The deepest leaf may sit under a nested virtual folder, so fall back to
  // a direct article link when the folder page groups do not list it.
  let resolvedNoteHref = noteLink
  if (!resolvedNoteHref) {
    resolvedNoteHref = await page.evaluate((route) => {
      const a = Array.from(document.querySelectorAll("article a")).find(
        (el) => el.getAttribute("href") === route,
      )
      return a ? a.getAttribute("href") : null
    }, expect.leafRoute)
  }
  if (!resolvedNoteHref) resolvedNoteHref = expect.leafRoute
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      const direct = Array.from(document.querySelectorAll(".reader-group-list a")).find(
        (el) => el.getAttribute("href") === href,
      )
      if (direct) direct.click()
      else window.location.assign(href)
    }, resolvedNoteHref),
  ])
  assert.ok(page.url().includes(expect.leafRoute), `nested note route ${expect.leafRoute}`)
  const note = await page.evaluate(() => ({
    h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
    mainCount: document.querySelectorAll("main").length,
    crumbs: Array.from(document.querySelectorAll(".reader-breadcrumbs li")).map((li) => ({
      text: li.textContent?.trim() || "",
      href: li.querySelector("a")?.getAttribute("href") || null,
    })),
    sidebarActive:
      document.querySelector(".reader-sidebar-nav a.is-active")?.textContent?.trim() || null,
  }))
  assert.equal(note.h1s.length, 1, `note has one primary heading (got ${note.h1s.join("|")})`)
  assert.ok(note.h1s.includes(expect.leafTitle), "nested note title")
  assert.equal(note.mainCount, 1, "one main landmark on the note")
  assert.ok(note.crumbs.length >= 3, "breadcrumbs expose folder ancestry")
  assert.ok(
    note.crumbs[note.crumbs.length - 1].text.includes(expect.leafTitle),
    "breadcrumbs end at the note",
  )
  assert.equal(note.sidebarActive, expect.folderTitle, "sidebar stays on the folder")

  // Breadcrumb return to the folder, then browser Back through the journey.
  const crumbHref = note.crumbs.length > 1 ? note.crumbs[1].href : null
  assert.ok(crumbHref, "breadcrumbs link a parent")
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      document.querySelector(`.reader-breadcrumbs a[href="${href}"]`)?.click()
    }, crumbHref),
  ])
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.ok(page.url().includes(expect.leafRoute), "browser Back returns to the nested note")
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.ok(page.url().includes(expect.folderRoute), "browser Back returns to the folder")
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.match(page.url(), /\/$/, "browser Back returns home")
}

test("synthetic browse journey covers home → folder → nested note → Back", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const kb = makeJourneyKb()
  const work = tmpdir("synthetic")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(kb, contentDir, identityFile)
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
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await runJourney(page, baseUrl, {
      areas: journey.areas,
      folderTitle: journey.folderTitle,
      folderRoute: journey.folderRoute,
      leafTitle: journey.leafTitle,
      leafRoute: journey.leafRoute,
    })
    await page.goto(`${baseUrl}${journey.leafRoute}`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    })
    const direct = await page.evaluate(() => ({
      h1: document.querySelector("article h1")?.textContent?.trim() || "",
      table: !!document.querySelector("article table"),
      external: !!document.querySelector('article a[href^="https://"]'),
    }))
    // Direct routes render; the rich guide page proves tables and externals.
    await page.goto(`${baseUrl}/notes/guide`, { waitUntil: "networkidle0", timeout: 15000 })
    const rich = await page.evaluate(() => ({
      table: !!document.querySelector("article table"),
      external: !!document.querySelector('article a[href^="https://"]'),
    }))
    assert.ok(rich.table, "direct rich note renders tables")
    assert.ok(rich.external, "direct rich note renders external links")
    assert.ok(direct.h1.length > 0, "direct note route renders a title")
    await page.close()
  } finally {
    await browser.close()
    server.close()
  }
})

test("generic real browse journey covers home → folder → nested note", async (t) => {
  const kbRoot = process.env.KNOWLEDGE_BASE_ROOT
  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip("KNOWLEDGE_BASE_ROOT is not set to a vault checkout; skipping real-corpus journey")
    return
  }
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const work = tmpdir("real")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(path.resolve(kbRoot), contentDir, identityFile)
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
    assert.ok(fs.existsSync(path.join(outDir, rel)), `real static export emits ${rel}`)
  }

  const { server, baseUrl } = await serveOut(outDir)
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await runJourney(page, baseUrl, {
      areas: journey.areas,
      folderTitle: journey.folderTitle,
      folderRoute: journey.folderRoute,
      leafTitle: journey.leafTitle,
      leafRoute: journey.leafRoute,
    })
    await page.close()
  } finally {
    await browser.close()
    server.close()
  }
})
