/**
 * Knowledge reader browse journey.
 *
 * Production static export + nginx-style server + desktop browser:
 * home -> published folder (authored or virtual) -> nested group -> note ->
 * breadcrumb or browser Back. Direct extensionless routes for home, the
 * folder, and the nested note are also verified. The persistent sidebar
 * renders the folder-and-note tree: published roots in metadata order,
 * nested children in tree order, and current-page indication.
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
    ".webmanifest": "application/manifest+json",
    ".svg": "image/svg+xml",
  }

  const loginPage =
    "<html><head><title>Sign in</title></head>" +
    "<body><h1>Sign in</h1><p>Cloudflare Access sign in to continue.</p></body></html>"

  const server = http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0])

      // Test-only access simulation: when armed, one published file answers
      // like an online session that expired mid-save (redirect to a
      // same-origin sign-in page), so the save must stay incomplete and
      // cache no login output as publication. The stub itself is not an
      // export file and never enters the precache.
      if (server.accessRedirectFor && urlPath === server.accessRedirectFor) {
        res.writeHead(302, { Location: "/access-signin" })
        res.end("redirect")

        return
      }

      if (urlPath === "/access-signin") {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(loginPage)

        return
      }

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

      const headers = {
        "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      }

      // Mirror the deployed worker cache headers so update checks see a
      // new publication instead of a cached worker.
      if (filePath.endsWith("sw.js") || filePath.endsWith("offline.json")) {
        headers["Cache-Control"] = "no-cache"
      }

      res.writeHead(200, headers)
      fs.createReadStream(filePath).pipe(res)
    } catch (error) {
      res.writeHead(500)
      res.end(String(error))
    }
  })

  server.accessRedirectFor = null

  return server
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
 * Returns areas in metadata order plus the chosen folder and its deepest
 * eligible leaf. The leaf prefers staged Markdown with exactly one top-level
 * H1 so the one-primary-heading landmark check stays meaningful; when no
 * single-H1 leaf exists the deepest leaf is kept so the check still fails
 * instead of weakening.
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
  const candidates = []

  const walkFiles = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name

      if (e.isDirectory()) walkFiles(path.join(dir, e.name), relPath)
      else if (e.isFile() && /\.md$/i.test(e.name) && !/^index\.md$/i.test(e.name)) {
        const folderPrefix = folderEntry.kind === "directory" ? folderEntry.path : null

        if (folderPrefix && !(relPath === folderPrefix || relPath.startsWith(`${folderPrefix}/`)))
          continue
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

/** Generic desktop journey: home -> folder -> nested note -> breadcrumbs and Back. */
async function runJourney(page, baseUrl, expect) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })

  const home = await page.evaluate((leafRoute) => {
    const links = Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => ({
      text: a.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
    }))

    // Top-level tree rows keep published root order (metadata order).
    const roots = Array.from(document.querySelectorAll(".reader-sidebar-nav > ul > li")).map(
      (li) => {
        const row = li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
        )

        const a = row ? row.querySelector("a") : null

        return a ? a.textContent?.trim() || "" : ""
      },
    )

    const leaf = document.querySelector(`.reader-sidebar-nav a[href="${leafRoute}"]`)

    return {
      title: document.title,
      h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
      mainCount: document.querySelectorAll("main").length,
      navCount: document.querySelectorAll("nav").length,
      links,
      roots,
      leafText: leaf ? leaf.textContent?.trim() || "" : null,
      body: document.body.textContent || "",
    }
  }, expect.leafRoute)

  assert.deepEqual(
    home.links.map((l) => l.text),
    expect.areas,
    "home keeps generated metadata order",
  )
  assert.deepEqual(home.roots, expect.areas, "tree keeps published root order")
  assert.equal(home.leafText, expect.leafTitle, "tree renders the nested leaf")
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

  const folder = await page.evaluate(() => {
    const groupNodes = document.querySelectorAll("article .reader-group h2")

    return {
      h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
      groupHeadings: Array.from(groupNodes).map((h) => h.textContent?.trim()),
      sidebarCurrent:
        document.querySelector('.reader-sidebar-nav a[aria-current="page"]')?.textContent?.trim() ||
        null,
    }
  })

  assert.ok(folder.h1s.includes(expect.folderTitle), `folder H1 (got ${folder.h1s.join("|")})`)
  assert.ok(
    folder.groupHeadings.length > 0,
    `folder exposes generic groups (got ${folder.groupHeadings.join("|")})`,
  )

  for (const heading of folder.groupHeadings) {
    assert.ok(
      heading === "Notes" || heading === "Folders",
      `folder group heading is generic (got ${heading})`,
    )
  }

  assert.ok(
    folder.groupHeadings.includes("Notes") || folder.groupHeadings.includes("Folders"),
    "folder uses the generic Notes/Folders groups",
  )
  assert.equal(folder.sidebarCurrent, expect.folderTitle, "tree indicates the open folder")

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

  const note = await page.evaluate((folderRoute) => {
    const folderLi = document.querySelector(
      `.reader-sidebar-nav li[data-tree-url="${folderRoute}"]`,
    )

    const folderRow = folderLi
      ? folderLi.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
        )
      : null

    const folderLink = folderRow ? folderRow.querySelector("a") : null

    return {
      h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
      mainCount: document.querySelectorAll("main").length,
      crumbs: Array.from(document.querySelectorAll(".reader-breadcrumbs li")).map((li) => ({
        text: li.textContent?.trim() || "",
        href: li.querySelector("a")?.getAttribute("href") || null,
      })),
      sidebarCurrent:
        document.querySelector('.reader-sidebar-nav a[aria-current="page"]')?.textContent?.trim() ||
        null,
      folderMarked:
        !!folderLink &&
        (folderLink.getAttribute("aria-current") === "true" ||
          folderLink.classList.contains("is-active")),
    }
  }, expect.folderRoute)

  assert.equal(note.h1s.length, 1, `note has one primary heading (got ${note.h1s.join("|")})`)
  assert.ok(note.h1s.includes(expect.leafTitle), "nested note title")
  assert.equal(note.mainCount, 1, "one main landmark on the note")
  assert.ok(note.crumbs.length >= 3, "breadcrumbs expose folder ancestry")
  assert.ok(
    note.crumbs[note.crumbs.length - 1].text.includes(expect.leafTitle),
    "breadcrumbs end at the note",
  )
  assert.equal(note.sidebarCurrent, expect.leafTitle, "tree indicates the open note")
  assert.ok(note.folderMarked, "tree keeps the section indicated")

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

/** Direct children of one tree branch, in rendered order. */
async function directTreeChildren(page, folderRoute) {
  return await page.evaluate((route) => {
    const li = document.querySelector(`.reader-sidebar-nav li[data-tree-url="${route}"]`)

    if (!li) return null
    const panel = li.querySelector(":scope > .reader-tree-collapsible > .reader-tree-panel")

    if (!panel) return []

    return Array.from(panel.querySelectorAll(":scope > ul > li")).map((child) => {
      const row = child.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
      )

      const a = row ? row.querySelector("a") : null

      return { text: a?.textContent?.trim() || "", href: a?.getAttribute("href") || "" }
    })
  }, folderRoute)
}

async function disclosureState(page, folderRoute) {
  return await page.evaluate((route) => {
    const li = document.querySelector(`.reader-sidebar-nav li[data-tree-url="${route}"]`)

    const button = li
      ? li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
        )
      : null

    return button ? button.getAttribute("aria-expanded") : null
  }, folderRoute)
}

async function setDisclosure(page, folderRoute, open) {
  await page.evaluate((route) => {
    const li = document.querySelector(`.reader-sidebar-nav li[data-tree-url="${route}"]`)
    li?.querySelector(
      ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
    )?.click()
  }, folderRoute)
  await page.waitForFunction(
    (route, want) => {
      const li = document.querySelector(`.reader-sidebar-nav li[data-tree-url="${route}"]`)

      const button = li
        ? li.querySelector(
            ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
          )
        : null

      return button && button.getAttribute("aria-expanded") === want
    },
    { timeout: 5000 },
    folderRoute,
    open ? "true" : "false",
  )
}

async function treeLinkVisible(page, href) {
  return await page.evaluate((target) => {
    const a = document.querySelector(`.reader-sidebar-nav a[href="${target}"]`)

    if (!a) return false
    const rect = a.getBoundingClientRect()

    return rect.width > 0 && rect.height > 0
  }, href)
}

async function treeCurrent(page) {
  return await page.evaluate(
    () =>
      document.querySelector('.reader-sidebar-nav a[aria-current="page"]')?.getAttribute("href") ||
      null,
  )
}

/** Expected direct-child titles of a staged directory, in tree order. */
function expectedFolderChildren(contentDir, folderPath) {
  const abs = path.join(contentDir, folderPath)

  const hasMarkdown = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.md$/i.test(entry.name)) return true

      if (entry.isDirectory() && hasMarkdown(path.join(dir, entry.name))) return true
    }

    return false
  }

  const entries = []

  for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${folderPath}/${child.name}`

    if (child.isFile() && /\.md$/i.test(child.name) && !/^index\.md$/i.test(child.name)) {
      entries.push({
        title: stagedFileTitle(path.join(contentDir, rel), child.name.replace(/\.md$/i, "")),
        slug: child.name.replace(/\.md$/i, ""),
      })
    } else if (child.isDirectory() && hasMarkdown(path.join(abs, child.name))) {
      const indexAbs = path.join(contentDir, rel, "index.md")
      entries.push({
        title: fs.existsSync(indexAbs)
          ? stagedFileTitle(indexAbs, humanizeSegment(child.name))
          : humanizeSegment(child.name),
        slug: child.name,
      })
    }
  }

  entries.sort((a, b) => a.title.localeCompare(b.title) || (a.slug < b.slug ? -1 : 1))

  return entries.map((entry) => entry.title)
}

/**
 * Tree sidebar behavior on a fresh desktop page: nested rendering and
 * ordering, folder link versus disclosure, multiple expanded branches,
 * ancestor auto-expansion with current indication, deliberate close,
 * session survival across navigation and Back, and readability.
 */
async function runTreeBehavior(page, baseUrl, expect) {
  const { folderRoute, leafRoute, leafTitle, folderChildren } = expect
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })

  const children = await directTreeChildren(page, folderRoute)
  assert.ok(children, "tree renders the folder branch")
  assert.deepEqual(
    children.map((c) => c.text),
    folderChildren,
    "folder children follow tree ordering",
  )

  // Folder link navigates; the disclosure only expands.
  const folderHref = await page.evaluate((route) => {
    const li = document.querySelector(`.reader-sidebar-nav li[data-tree-url="${route}"]`)

    const row = li
      ? li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
        )
      : null

    return row ? row.querySelector("a")?.getAttribute("href") || null : null
  }, folderRoute)

  assert.equal(folderHref, folderRoute, "folder name links to its own page")
  assert.equal(await disclosureState(page, folderRoute), "false", "folder starts closed on home")
  const homeUrl = page.url()
  await setDisclosure(page, folderRoute, true)
  assert.equal(page.url(), homeUrl, "disclosure expands without navigating")
  assert.ok(await treeLinkVisible(page, children[0].href), "disclosure reveals the branch children")

  // A second branch stays open alongside the first.
  const otherRoot = await page.evaluate((route) => {
    const tops = Array.from(document.querySelectorAll(".reader-sidebar-nav > ul > li"))

    for (const li of tops) {
      const url = li.getAttribute("data-tree-url") || ""

      if (url && url !== route) {
        const button = li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
        )

        if (button) return url
      }
    }

    return null
  }, folderRoute)

  assert.ok(otherRoot, "a second expandable root exists")
  await setDisclosure(page, otherRoot, true)
  assert.equal(await disclosureState(page, folderRoute), "true", "first branch stays expanded")
  assert.equal(await disclosureState(page, otherRoot), "true", "second branch stays expanded")

  // The folder name reaches its page through a normal static URL.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((route) => {
      document.querySelector(`.reader-sidebar-nav a[href="${route}"]`)?.click()
    }, folderRoute),
  ])
  assert.ok(page.url().includes(folderRoute), "folder link opens its route")
  assert.equal(await treeCurrent(page), folderRoute, "tree indicates the open folder")

  // Arriving at a deep page expands its ancestors and indicates it.
  await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "networkidle0", timeout: 15000 })
  const segments = leafRoute.split("/").filter(Boolean)
  const prefixes = segments.map((_, i) => `/${segments.slice(0, i + 1).join("/")}`)

  for (const prefix of prefixes.slice(0, -1)) {
    const state = await disclosureState(page, prefix)

    if (state !== null) assert.equal(state, "true", `ancestor branch ${prefix} expands`)
  }

  assert.equal(await treeCurrent(page), leafRoute, "tree indicates the open note")
  assert.ok(await treeLinkVisible(page, leafRoute), "current note stays readable in the tree")

  // A deliberately collapsed branch stays closed on the current page.
  await setDisclosure(page, folderRoute, false)
  assert.equal(page.url().includes(leafRoute), true, "deliberate close does not navigate")
  assert.equal(await treeLinkVisible(page, leafRoute), false, "deliberate close hides the branch")
  assert.equal(
    await disclosureState(page, folderRoute),
    "false",
    "automatic expansion does not override the deliberate close",
  )

  // Open branches survive navigation; the deliberate close holds where
  // the page did not change, then releases on the next navigation.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((route) => {
      document.querySelector(`.reader-sidebar-nav a[href="${route}"]`)?.click()
    }, otherRoot),
  ])
  assert.ok(page.url().includes(otherRoot), "second branch link opens its route")
  assert.equal(await disclosureState(page, otherRoot), "true", "opened branch survives navigation")
  assert.equal(await disclosureState(page, folderRoute), "false", "closed branch stays closed away")
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  await page.waitForFunction(
    (route) => window.location.href.includes(route),
    { timeout: 15000 },
    leafRoute,
  )
  assert.equal(await disclosureState(page, otherRoot), "true", "opened branch survives Back")
  assert.equal(
    await disclosureState(page, folderRoute),
    "true",
    "navigation reopens the current page ancestors",
  )
  assert.equal(await treeCurrent(page), leafRoute, `tree still indicates ${leafTitle} after Back`)

  // Deep branches and long titles stay readable at desktop width.
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))

  assert.ok(
    overflow.doc <= overflow.inner + 1,
    `tree keeps document width ${overflow.doc} inside viewport ${overflow.inner}`,
  )

  const readability = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll(".reader-sidebar-nav a"))
    const toggles = Array.from(document.querySelectorAll(".reader-tree-toggle"))
    const widest = Math.max(0, ...links.map((a) => a.getBoundingClientRect().right))

    return {
      widest,
      inner: window.innerWidth,
      toggleHeights: toggles
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => b.getBoundingClientRect().height),
    }
  })

  assert.ok(
    readability.widest <= readability.inner + 1,
    "tree links stay inside the desktop viewport",
  )

  for (const height of readability.toggleHeights) {
    assert.ok(height >= 44, `tree disclosure is ${height}px (expected >= 44)`)
  }
}

/** Wait until the Search dialog is open with its input focused. */
async function dialogOpen(page) {
  await page.waitForSelector('[data-slot="dialog-content"]', { visible: true, timeout: 5000 })
  await page.waitForFunction(
    () => document.activeElement && document.activeElement.id === "reader-search-input",
    { timeout: 5000 },
  )
}

async function dialogClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'), {
    timeout: 5000,
  })
}

/** Set the dialog query the way React observes it (controlled input). */
async function setSearchQuery(page, text) {
  await page.evaluate((value) => {
    const el = document.getElementById("reader-search-input")

    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    setter.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }, text)
}

async function pressShortcut(page, modifier) {
  await page.keyboard.down(modifier)
  await page.keyboard.press("k")
  await page.keyboard.up(modifier)
}

/**
 * Search dialog behavior on desktop: visible sidebar control, labelled
 * dialog with empty/no-results/results states, full keyboard journey to a
 * static route, shortcut open, Escape with focus return.
 */
async function runSearchDialog(page, baseUrl, expect) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })

  const controls = await page.evaluate(() => {
    const each = (sel) => {
      const el = document.querySelector(sel)

      if (!el) return { present: false, visible: false, text: "" }
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()

      return {
        present: true,
        visible: style.display !== "none" && rect.width > 0 && rect.height > 0,
        text: el.textContent?.trim() || "",
      }
    }

    return {
      sidebar: each(".reader-search-sidebar"),
      header: each(".reader-search-header"),
    }
  })

  assert.ok(
    controls.sidebar.present && controls.sidebar.visible,
    "desktop sidebar shows a Search control",
  )
  assert.ok(controls.sidebar.text.includes("Search"), "sidebar Search control is labeled")
  assert.ok(!controls.header.visible, "phone header Search stays hidden on desktop")

  await page.evaluate(() => document.querySelector(".reader-search-sidebar")?.click())
  await dialogOpen(page)

  const dialogMeta = await page.evaluate(() => ({
    title:
      document
        .querySelector('[data-slot="dialog-content"] [data-slot="dialog-title"]')
        ?.textContent?.trim() || "",
    labelled: !!document.querySelector('label[for="reader-search-input"]'),
    live: document.querySelector(".reader-search-status")?.getAttribute("aria-live") || "",
    status: document.querySelector(".reader-search-status")?.textContent?.trim() || "",
    combobox: document.getElementById("reader-search-input")?.getAttribute("role") || "",
  }))

  assert.equal(dialogMeta.title, "Search", "dialog is labelled Search")
  assert.ok(dialogMeta.labelled, "search input is labeled")
  assert.equal(dialogMeta.live, "polite", "state changes announce politely")
  assert.ok(dialogMeta.status.includes("Type to find a note"), "empty state invites a query")
  assert.equal(dialogMeta.combobox, "combobox", "input exposes the combobox pattern")

  await setSearchQuery(page, "zzz-no-such-note-qqq9")
  await page.waitForFunction(
    () => document.querySelector(".reader-search-status")?.textContent?.includes("No results"),
    { timeout: 10000 },
  )

  await setSearchQuery(page, expect.leafTitle)
  await page.waitForSelector(".reader-search-result", { visible: true, timeout: 10000 })

  const results = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-search-result")).map((a) => ({
      title: a.querySelector(".reader-search-result-title")?.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
      excerpt: a.querySelector(".reader-search-result-excerpt")?.textContent?.trim() || "",
    })),
  )

  assert.ok(results.length > 0, "typing shows ranked results")

  for (const hit of results) {
    assert.ok(hit.title.length > 0, "each result carries a title")
    assert.ok(hit.href.startsWith("/"), "each result carries a static location")
    assert.ok(hit.excerpt.length > 0, "each result carries an excerpt")
  }

  assert.ok(
    results.some((hit) => hit.href === expect.leafRoute),
    "results reach the nested note",
  )

  // Keyboard journey: arrows move the highlight, Enter follows the static URL.
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

  assert.ok(await activeEndsWith("-option-0"), "first result starts highlighted")

  if (results.length > 1) {
    await page.keyboard.press("ArrowDown")
    assert.ok(await activeEndsWith("-option-1"), "ArrowDown moves the highlight")
    await page.keyboard.press("ArrowUp")
    assert.ok(await activeEndsWith("-option-0"), "ArrowUp returns the highlight")
  }

  const highlighted = await page.evaluate(
    () =>
      document
        .querySelector('.reader-search-option[data-active="true"] .reader-search-result')
        ?.getAttribute("href") || null,
  )

  assert.equal(highlighted, firstHref, "highlight tracks the first result")
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.keyboard.press("Enter"),
  ])
  assert.ok(page.url().includes(firstHref), "Enter opens the highlighted static route")

  const landed = await page.evaluate(
    () => document.querySelector("article h1")?.textContent?.trim() || "",
  )

  assert.ok(landed.length > 0, "result navigation lands on a readable page")

  // Shortcut opens and focuses; repeating it keeps exactly one dialog.
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
  await page.evaluate(() => document.querySelector(".reader-search-sidebar")?.focus())
  await pressShortcut(page, "Control")
  await dialogOpen(page)

  const countDialogs = async () =>
    await page.evaluate(() => document.querySelectorAll('[data-slot="dialog-content"]').length)

  assert.equal(await countDialogs(), 1, "Control+K opens exactly one dialog")
  await pressShortcut(page, "Control")
  assert.equal(await countDialogs(), 1, "shortcut while open keeps one dialog")
  assert.equal(
    await page.evaluate(() => document.activeElement?.id || ""),
    "reader-search-input",
    "shortcut focuses the dialog input",
  )

  // Escape closes and returns focus to the control that opened it.
  await page.keyboard.press("Escape")
  await dialogClosed(page)
  const returned = await page.evaluate(() => document.activeElement?.className || "")
  assert.ok(
    String(returned).includes("reader-search-sidebar"),
    "Escape returns focus to the opener",
  )

  // Meta+K opens the same dialog.
  await pressShortcut(page, "Meta")
  await dialogOpen(page)
  await page.keyboard.press("Escape")
  await dialogClosed(page)
}

/** Loading state: the dialog announces while the static index is in flight. */
async function runSearchIndexLoading(browser, baseUrl) {
  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.setRequestInterception(true)
    let releaseIndex = () => {}

    const gate = new Promise((resolve) => {
      releaseIndex = resolve
    })

    page.on("request", (req) => {
      try {
        if (req.url().endsWith("/search-index.json")) {
          gate.then(() => Promise.resolve(req.continue()).catch(() => {}))
        } else {
          Promise.resolve(req.continue()).catch(() => {})
        }
      } catch {}
    })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
    await pressShortcut(page, "Control")
    await dialogOpen(page)
    await setSearchQuery(page, "garden")
    await page.waitForFunction(
      () => document.querySelector(".reader-search-status")?.textContent?.includes("Searching"),
      { timeout: 10000 },
    )
    assert.equal(
      await page.evaluate(() => document.querySelectorAll(".reader-search-result").length),
      0,
      "no results render before the index arrives",
    )
    releaseIndex()
    await page.waitForSelector(".reader-search-result", { visible: true, timeout: 15000 })
  } finally {
    await page.close()
  }
}

/** Failed index fetch: graceful feedback, no crash, dialog still closes. */
async function runSearchIndexFailure(browser, baseUrl) {
  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.setRequestInterception(true)
    page.on("request", (req) => {
      try {
        if (req.url().endsWith("/search-index.json")) {
          Promise.resolve(req.abort()).catch(() => {})
        } else {
          Promise.resolve(req.continue()).catch(() => {})
        }
      } catch {}
    })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
    await pressShortcut(page, "Control")
    await dialogOpen(page)
    await setSearchQuery(page, "garden")
    await page.waitForFunction(
      () => document.querySelector(".reader-search-status")?.textContent?.includes("unavailable"),
      { timeout: 10000 },
    )
    assert.equal(
      await page.evaluate(() => document.querySelectorAll(".reader-search-result").length),
      0,
      "failed fetch shows feedback instead of results",
    )
    await page.keyboard.press("Escape")
    await dialogClosed(page)
  } finally {
    await page.close()
  }
}

/**
 * Offline probes derived from staged content: a published folder and a
 * published note the journey above never visits, so the offline run proves
 * an unvisited page and folder work after restart. Prefers a directory
 * root other than the journey folder; falls back to a standalone Markdown
 * root when no second directory exists.
 */
function deriveOfflineProbes(contentDir, metadata, journey) {
  const dirRoots = metadata.navigation.filter((entry) => entry && entry.kind === "directory")

  const folderEntry =
    dirRoots.find((entry) => `/${entry.path}` !== journey.folderRoute) || dirRoots[0] || null

  if (!folderEntry) {
    const markdownRoot = metadata.navigation.find((entry) => entry && entry.kind === "markdown")
    const route = markdownRoot ? rootRoute(markdownRoot) : journey.folderRoute
    const title = markdownRoot ? expectedRootTitle(markdownRoot, contentDir) : journey.folderTitle

    return {
      offlineFolderRoute: route,
      offlineFolderTitle: title,
      offlineLeafRoute: route,
      offlineLeafTitle: title,
    }
  }

  const folderRoute = `/${folderEntry.path}`
  const folderTitle = expectedRootTitle(folderEntry, contentDir)
  const candidates = []

  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath)
      else if (
        entry.isFile() &&
        /\.md$/i.test(entry.name) &&
        !/^index\.md$/i.test(entry.name) &&
        (relPath === folderEntry.path || relPath.startsWith(`${folderEntry.path}/`))
      ) {
        candidates.push(relPath)
      }
    }
  }

  walk(contentDir, "")
  candidates.sort()

  const leafRel =
    candidates.find((rel) => routeForStagedMarkdown(rel) !== journey.leafRoute) || candidates[0]

  if (!leafRel) {
    return {
      offlineFolderRoute: folderRoute,
      offlineFolderTitle: folderTitle,
      offlineLeafRoute: folderRoute,
      offlineLeafTitle: folderTitle,
    }
  }

  const leafRoute = routeForStagedMarkdown(leafRel)

  const leafTitle = stagedFileTitle(
    path.join(contentDir, leafRel),
    path.posix.basename(leafRel).replace(/\.md$/i, ""),
  )

  return {
    offlineFolderRoute: folderRoute,
    offlineFolderTitle: folderTitle,
    offlineLeafRoute: leafRoute,
    offlineLeafTitle: leafTitle,
  }
}

/**
 * Explicit offline save plus offline browsing and search on one origin.
 *
 * Reuses the synthetic build above (no second build): the Save action is
 * visible with its size and trusted-device note, starts no worker before
 * the reader chooses it, reports progress, then reports Ready offline only
 * after the whole export is cached. A fresh page with the network off then
 * launches home, opens an unvisited folder and note through extensionless
 * URLs, browses the same tree, and searches to the unvisited note.
 */
async function runOfflineSave(browser, baseUrl, server, expect) {
  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })

    const pre = await page.evaluate(async () => {
      const save = document.querySelector(".reader-offline-save")
      const size = document.querySelector(".reader-offline-size")?.textContent || ""
      const trust = document.querySelector(".reader-offline-trust")?.textContent || ""
      let hasReg = false
      let cacheCount = 0

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        cacheCount = (await caches.keys()).length
      } catch {}

      return { hasSave: !!save, size, trust, hasReg, cacheCount }
    })

    assert.ok(pre.hasSave, "Save for offline use is visible")
    assert.match(pre.size, /B/, "estimated download size is shown")
    assert.match(pre.trust, /trust/i, "trusted-device note is shown")
    assert.equal(pre.hasReg, false, "no worker starts before Save")
    assert.equal(pre.cacheCount, 0, "no offline cache starts before Save")

    // An online session that expires mid-save: one published file redirects
    // to a same-origin sign-in page. The integrity guard fails that fetch,
    // so the save stays incomplete with a retry and caches no login output.
    server.accessRedirectFor = expect.failureTarget
    await page.evaluate(() => document.querySelector(".reader-offline-save")?.click())
    await page.waitForSelector(".reader-offline-progress", { visible: true, timeout: 15000 })
    await page.waitForSelector(".reader-offline-retry", { visible: true, timeout: 90000 })

    const incompleteText = await page.evaluate(
      () => document.querySelector(".reader-offline section, .reader-offline")?.textContent || "",
    )

    assert.match(incompleteText, /incomplete/i, "redirected save reports an incomplete state")
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      false,
      "redirected save never claims Ready offline",
    )

    const loginCached = await page.evaluate(async (target) => {
      try {
        const hit = await caches.match(target, { ignoreSearch: true })

        if (!hit) return "miss"
        const text = await hit.clone().text()

        return text.includes("Sign in") ? "login-cached" : "other-cached"
      } catch {
        return "error"
      }
    }, expect.failureTarget)

    assert.equal(loginCached, "miss", "sign-in response is not cached as publication")
    // No destructive behavior: the reader still works online.
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })

    const homeH1 = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.ok(homeH1.length > 0, "failed save leaves online reading intact")

    // Access restored: saving again completes with no rebuild. After the
    // reload the control offers the explicit Save action again (a failed
    // install keeps no worker); either control starts the same save.
    server.accessRedirectFor = null
    await page.waitForSelector(".reader-offline-retry, .reader-offline-save", {
      visible: true,
      timeout: 15000,
    })
    await page.evaluate(() => {
      const retry = document.querySelector(".reader-offline-retry")

      if (retry) {
        retry.click()

        return
      }

      document.querySelector(".reader-offline-save")?.click()
    })
    await page.waitForSelector(".reader-offline-progress", { visible: true, timeout: 15000 })
    await page.waitForSelector(".reader-offline-ready", { visible: true, timeout: 90000 })

    const readyText = await page.evaluate(
      () => document.querySelector(".reader-offline-ready")?.textContent || "",
    )

    assert.match(readyText, /Ready offline/, "retry after access restores Ready offline")
  } finally {
    await page.close()
  }

  // Restart: a fresh page with the network off proves the saved copy
  // launches and serves unvisited routes without a connection.
  const offline = await browser.newPage()

  try {
    await offline.setViewport({ width: 1280, height: 800 })
    await offline.setOfflineMode(true)
    await offline.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 15000 })

    const homeH1 = await offline.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.ok(homeH1.length > 0, "saved site launches offline")

    await offline.goto(`${baseUrl}${expect.offlineFolderRoute}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    })

    const folderH1 = await offline.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(folderH1, expect.offlineFolderTitle, "unvisited folder opens offline")

    const treeHasLeaf = await offline.evaluate(
      (route) => !!document.querySelector(`.reader-sidebar-nav a[href="${route}"]`),
      expect.offlineLeafRoute,
    )

    assert.ok(treeHasLeaf, "Browse tree works offline")

    await offline.goto(`${baseUrl}${expect.offlineLeafRoute}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    })

    const leafH1 = await offline.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(
      leafH1,
      expect.offlineLeafTitle,
      "unvisited page opens offline by extensionless URL",
    )

    await pressShortcut(offline, "Control")
    await dialogOpen(offline)
    await setSearchQuery(offline, expect.offlineLeafTitle)
    await offline.waitForSelector(".reader-search-result", { visible: true, timeout: 15000 })

    const hrefs = await offline.evaluate(() =>
      Array.from(document.querySelectorAll(".reader-search-result")).map(
        (a) => a.getAttribute("href") || "",
      ),
    )

    assert.ok(
      hrefs.some((href) => href === expect.offlineLeafRoute),
      "offline search reaches the unvisited page",
    )
    await Promise.all([
      offline.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }),
      offline.keyboard.press("Enter"),
    ])
    assert.ok(
      offline.url().includes(expect.offlineLeafRoute),
      "offline result opens the saved page",
    )
  } finally {
    await offline.setOfflineMode(false).catch(() => {})
    await offline.close()
  }
}

/**
 * Explicit publication update on the same export (no second Next.js build).
 *
 * Mutates the served export directly (changed page H1 plus the same title
 * inside the static search index, one removed page), regenerates only the
 * Workbox output, then proves the observable update behavior: no prompt
 * before the new publication, Update ready — Reload only after the complete
 * replacement downloads with no forced reload, and after Reload the updated
 * page and search come from the same new version while the removed page is
 * gone offline. Worker update checks use no-cache headers.
 */
async function runOfflineUpdate(browser, baseUrl, outDir, expect) {
  const { leafRoute, leafTitle, removedRoute } = expect
  const newTitle = `${leafTitle} Updated`
  const leafRel = `${leafRoute.replace(/^\//, "")}.html`
  const leafAbs = path.join(outDir, leafRel)
  const removedRel = `${removedRoute.replace(/^\//, "")}.html`
  const removedAbs = path.join(outDir, removedRel)
  assert.ok(fs.existsSync(leafAbs), `update target exists: ${leafRel}`)
  assert.ok(fs.existsSync(removedAbs), `removal target exists: ${removedRel}`)
  const oldVersion = JSON.parse(fs.readFileSync(path.join(outDir, "offline.json"), "utf8")).version

  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "networkidle0", timeout: 15000 })

    const beforeH1 = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(beforeH1, leafTitle, "update starts from the saved publication")
    assert.ok(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      "saved copy is Ready before the update",
    )
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-reload")),
      false,
      "no update prompt before the new publication",
    )

    // New publication from the finished export only: changed page plus the
    // same title in the static search index, with one page removed.
    const leafHtml = fs.readFileSync(leafAbs, "utf8")
    assert.ok(leafHtml.includes(leafTitle), "export holds the old title before the update")
    fs.writeFileSync(leafAbs, leafHtml.split(leafTitle).join(newTitle))
    const indexRaw = fs.readFileSync(path.join(outDir, "search-index.json"), "utf8")
    assert.ok(indexRaw.includes(leafTitle), "search index holds the old title before the update")
    fs.writeFileSync(
      path.join(outDir, "search-index.json"),
      indexRaw.split(leafTitle).join(newTitle),
    )
    fs.rmSync(removedAbs, { force: true })
    await execFileAsync(
      process.execPath,
      [path.join(READER_ROOT, "scripts", "build-offline.mjs"), "--dir", outDir],
      { cwd: PUBLISHER_ROOT, timeout: 120000 },
    )
    const afterManifest = JSON.parse(fs.readFileSync(path.join(outDir, "offline.json"), "utf8"))
    assert.notEqual(afterManifest.version, oldVersion, "new publication carries a new version")
    assert.ok(
      !fs.readFileSync(path.join(outDir, "sw.js"), "utf8").includes(removedRel),
      "removed page leaves the new precache",
    )

    // Deployed-style update check: worker inputs bypass the HTTP cache.
    const cacheHeaders = await page.evaluate(async (base) => {
      const sw = await fetch(`${base}/sw.js`, { cache: "no-store" }).then(
        (res) => res.headers.get("cache-control") || "",
      )

      const manifest = await fetch(`${base}/offline.json`, { cache: "no-store" }).then(
        (res) => res.headers.get("cache-control") || "",
      )

      return { sw, manifest }
    }, baseUrl)

    assert.match(cacheHeaders.sw, /no-cache/i, "worker update check bypasses the cache")
    assert.match(cacheHeaders.manifest, /no-cache/i, "manifest update check bypasses the cache")

    // A reader leaves this tab open while a new publication arrives. An
    // online/visibility check must find the update without a manual call to
    // ServiceWorkerRegistration.update() from the test.
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await page.waitForSelector(".reader-offline-reload", { visible: true, timeout: 90000 })

    const prompt = await page.evaluate(
      () => document.querySelector(".reader-offline-reload")?.textContent?.trim() || "",
    )

    assert.equal(prompt, "Update ready — Reload", "complete replacement offers Reload")
    assert.ok(page.url().includes(leafRoute), "update never navigates the session away")

    const duringH1 = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(duringH1, leafTitle, "session keeps the old publication until Reload")

    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }),
      page.evaluate(() => document.querySelector(".reader-offline-reload")?.click()),
    ])

    const afterH1 = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(afterH1, newTitle, "Reload serves the updated page")
    assert.ok(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      "updated copy stays Ready",
    )

    // Offline after Reload: updated page and search use the new version;
    // the removed page is no longer available offline.
    await page.setOfflineMode(true)
    await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "domcontentloaded", timeout: 15000 })
    assert.equal(
      await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim() || ""),
      newTitle,
      "updated page serves offline",
    )

    const offlineIndexNew = await page.evaluate(async () => {
      try {
        const res = await fetch("/search-index.json")

        if (!res.ok) return false

        return (await res.text()).includes("Updated")
      } catch {
        return false
      }
    })

    assert.ok(offlineIndexNew, "offline search index is the new version")
    // Workbox precaches the `.html` export key (not the extensionless
    // route), so check the actual cache keys: a stale removed entry would
    // still match the `.html` lookup and fail this assertion.
    const removedUrl = `/${removedRel.split(path.sep).join("/")}`

    const removedHits = await page.evaluate(
      async ([htmlUrl, route]) => {
        const found = { htmlHit: true, routeHit: true }

        try {
          const htmlMatch = await caches.match(htmlUrl, { ignoreSearch: true })
          found.htmlHit = !!(htmlMatch && htmlMatch.ok)
        } catch {
          found.htmlHit = true
        }

        try {
          const routeMatch = await caches.match(route, { ignoreSearch: true })
          found.routeHit = !!(routeMatch && routeMatch.ok)
        } catch {
          found.routeHit = true
        }

        return found
      },
      [removedUrl, removedRoute],
    )

    assert.equal(removedHits.htmlHit, false, "removed .html is gone from the precache")
    assert.equal(removedHits.routeHit, false, "removed route leaves no offline entry")
    // Observable reader behavior in an isolated probe page (keeps this
    // page's JS context intact for the search check below): offline
    // navigation to the removed page must not serve the old publication.
    const probe = await browser.newPage()

    try {
      await probe.setViewport({ width: 1280, height: 800 })
      await probe.setOfflineMode(true)
      let removedServed = false

      try {
        await probe.goto(`${baseUrl}${removedRoute}`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        })

        const removedH1 = await probe.evaluate(
          () => document.querySelector("article h1")?.textContent?.trim() || "",
        )

        removedServed = removedH1.includes("Orchard Note 12")
      } catch {
        removedServed = false
      }

      assert.equal(removedServed, false, "removed page no longer opens offline")
    } finally {
      await probe.setOfflineMode(false).catch(() => {})
      await probe.close()
    }

    await pressShortcut(page, "Control")
    await dialogOpen(page)
    await setSearchQuery(page, leafTitle)
    await page.waitForSelector(".reader-search-result", { visible: true, timeout: 15000 })

    const updateHits = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".reader-search-result")).map((a) => ({
        title: a.querySelector(".reader-search-result-title")?.textContent?.trim() || "",
        href: a.getAttribute("href") || "",
      })),
    )

    assert.ok(
      updateHits.some((hit) => hit.href === leafRoute && hit.title === newTitle),
      "offline search reaches the updated page version",
    )
    await page.keyboard.press("Escape")
    await dialogClosed(page)
  } finally {
    await page.setOfflineMode(false).catch(() => {})
    await page.close()
  }
}

/**
 * Explicit removal on the same export (no second Next.js build).
 *
 * From the updated Ready copy: Remove offline copy unregisters this
 * projection's worker and deletes only its Workbox precache caches, so an
 * unrelated same-origin cache stays. Ready clears to the explicit Save
 * action, a later online visit starts no silent download, and an explicit
 * Save restores Ready. A simulated storage eviction (precache deleted,
 * worker left) must also clear Ready on the next visit.
 */
async function runOfflineRemove(browser, baseUrl, expect) {
  const { leafRoute } = expect
  const leafHtml = leafRoute === "/" ? "/index.html" : `${leafRoute}.html`
  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
    await page.waitForSelector(".reader-offline-ready", { visible: true, timeout: 15000 })
    await page.waitForSelector(".reader-offline-remove", { visible: true, timeout: 15000 })

    await page.evaluate(async () => {
      try {
        const keep = await caches.open("sentinel-keep-v1")
        await keep.put(
          "/sentinel-keep",
          new Response("keep", { headers: { "Content-Type": "text/plain" } }),
        )
        await caches.open(`workbox-precache-v2-${location.origin}/other/`)
      } catch {}
    })

    const before = await page.evaluate(async () => {
      let hasReg = false
      let keys = []

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        keys = await caches.keys()
      } catch {}

      return {
        hasReg,
        precacheCount: keys.filter((name) => name === `workbox-precache-v2-${location.origin}/`)
          .length,
      }
    })

    assert.ok(before.hasReg, "saved worker present before removal")
    assert.ok(before.precacheCount > 0, "saved precache present before removal")

    // Failure to identify this worker's scope must not delete every Workbox
    // precache on the origin or claim that removal succeeded.
    await page.evaluate(() => {
      const container = navigator.serviceWorker
      window.__originalGetRegistration = container.getRegistration.bind(container)
      container.getRegistration = async () => {
        throw new Error("registration unavailable")
      }
    })
    await page.evaluate(() => document.querySelector(".reader-offline-remove")?.click())
    await page.waitForSelector(".reader-offline-remove-error", { visible: true, timeout: 15000 })
    assert.ok(
      await page.evaluate(async () =>
        (await caches.keys()).some((name) => name.includes("-precache-")),
      ),
      "failed removal keeps the saved precache",
    )
    await page.evaluate(() => {
      navigator.serviceWorker.getRegistration = window.__originalGetRegistration
      delete window.__originalGetRegistration
    })

    // An unregister that succeeds before cache deletion fails must still
    // allow a scoped retry. Never display Save while saved bytes remain.
    await page.evaluate(() => {
      window.__originalCacheDelete = caches.delete.bind(caches)
      caches.delete = async () => false
    })
    await page.evaluate(() => document.querySelector(".reader-offline-remove")?.click())
    await page.waitForSelector(".reader-offline-remove-error", { visible: true, timeout: 15000 })
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-save")),
      false,
      "failed cache deletion never claims that removal succeeded",
    )
    await page.evaluate(() => {
      caches.delete = window.__originalCacheDelete
      delete window.__originalCacheDelete
    })

    await page.evaluate(() => document.querySelector(".reader-offline-remove")?.click())
    await page.waitForSelector(".reader-offline-save", { visible: true, timeout: 15000 })
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      false,
      "Ready offline clears after removal",
    )
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-remove")),
      false,
      "Remove action leaves with the saved copy",
    )
    // Give a later visit no chance to hide a silent re-download.
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const after = await page.evaluate(async () => {
      let hasReg = false
      let keys = []

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        keys = await caches.keys()
      } catch {}

      return {
        hasReg,
        precacheCount: keys.filter((name) => name === `workbox-precache-v2-${location.origin}/`)
          .length,
        kept: keys.includes("sentinel-keep-v1"),
        otherScopeKept: keys.includes(`workbox-precache-v2-${location.origin}/other/`),
      }
    })

    assert.equal(after.hasReg, false, "removal unregisters this projection's worker")
    assert.equal(after.precacheCount, 0, "removal deletes this projection's precache")
    assert.equal(after.kept, true, "unrelated same-origin cache stays")
    assert.equal(after.otherScopeKept, true, "another same-origin scope's precache stays")

    const stillCached = await page.evaluate(async (htmlUrl) => {
      try {
        const hit = await caches.match(htmlUrl, { ignoreSearch: true })

        return !!(hit && hit.ok)
      } catch {
        return true
      }
    }, leafHtml)

    assert.equal(stillCached, false, "removed page leaves no precache entry")

    // Later online visit: explicit Save stays, but no silent whole-site fetch.
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
    await page.waitForSelector(".reader-offline-save", { visible: true, timeout: 15000 })
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      false,
      "later visit does not claim Ready offline",
    )
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const later = await page.evaluate(async () => {
      let hasReg = false
      let keys = []

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        keys = await caches.keys()
      } catch {}

      return {
        hasReg,
        precacheCount: keys.filter((name) => name === `workbox-precache-v2-${location.origin}/`)
          .length,
      }
    })

    assert.equal(later.hasReg, false, "later visit does not re-register")
    assert.equal(later.precacheCount, 0, "later visit does not re-download")

    // Explicit re-save restores the offline copy with no rebuild.
    await page.evaluate(() => document.querySelector(".reader-offline-save")?.click())
    await page.waitForSelector(".reader-offline-progress", { visible: true, timeout: 15000 })
    await page.waitForSelector(".reader-offline-ready", { visible: true, timeout: 90000 })
    await page.waitForSelector(".reader-offline-remove", { visible: true, timeout: 15000 })

    const resaved = await page.evaluate(async () => {
      let hasReg = false
      let keys = []

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        keys = await caches.keys()
      } catch {}

      return {
        hasReg,
        precacheCount: keys.filter((name) => name.includes("-precache-")).length,
      }
    })

    assert.ok(resaved.hasReg, "explicit re-save registers the worker again")
    assert.ok(resaved.precacheCount > 0, "explicit re-save restores the precache")

    await page.setOfflineMode(true)
    await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "domcontentloaded", timeout: 15000 })
    assert.ok(
      (await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim() || ""))
        .length > 0,
      "re-saved page opens offline",
    )
    await page.setOfflineMode(false)

    // Simulated browser storage eviction: precache gone, worker left.
    // The next online visit must not keep a stale Ready label.
    await page.evaluate(async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(
          keys
            .filter((name) => name === `workbox-precache-v2-${location.origin}/`)
            .map((name) => caches.delete(name)),
        )
      } catch {}
    })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
    await page.waitForSelector(".reader-offline-save, .reader-offline-retry", {
      visible: true,
      timeout: 15000,
    })
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      false,
      "storage eviction clears Ready offline",
    )
    await page.evaluate(async () => {
      try {
        await caches.delete("sentinel-keep-v1")
        await caches.delete(`workbox-precache-v2-${location.origin}/other/`)
      } catch {}
    })
  } finally {
    await page.setOfflineMode(false).catch(() => {})
    await page.close()
  }
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
  const folderChildren = expectedFolderChildren(contentDir, journey.folderEntry.path)

  try {
    const treePage = await browser.newPage()
    await treePage.setViewport({ width: 1280, height: 800 })
    await runTreeBehavior(treePage, baseUrl, {
      folderTitle: journey.folderTitle,
      folderRoute: journey.folderRoute,
      leafTitle: journey.leafTitle,
      leafRoute: journey.leafRoute,
      folderChildren,
    })
    await treePage.close()
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
    const searchPage = await browser.newPage()
    await searchPage.setViewport({ width: 1280, height: 800 })
    await runSearchDialog(searchPage, baseUrl, {
      leafTitle: journey.leafTitle,
      leafRoute: journey.leafRoute,
    })
    await searchPage.close()
    await runSearchIndexLoading(browser, baseUrl)
    await runSearchIndexFailure(browser, baseUrl)
    const offlineProbes = deriveOfflineProbes(contentDir, metadata, journey)
    await runOfflineSave(browser, baseUrl, server, {
      offlineFolderRoute: offlineProbes.offlineFolderRoute,
      offlineFolderTitle: offlineProbes.offlineFolderTitle,
      offlineLeafRoute: offlineProbes.offlineLeafRoute,
      offlineLeafTitle: offlineProbes.offlineLeafTitle,
      failureTarget:
        offlineProbes.offlineLeafRoute === "/"
          ? "/index.html"
          : `${offlineProbes.offlineLeafRoute}.html`,
    })
    await runOfflineUpdate(browser, baseUrl, outDir, {
      leafRoute: journey.leafRoute,
      leafTitle: journey.leafTitle,
      removedRoute: "/orchard/note-12",
    })
    await runOfflineRemove(browser, baseUrl, {
      leafRoute: journey.leafRoute,
    })
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
