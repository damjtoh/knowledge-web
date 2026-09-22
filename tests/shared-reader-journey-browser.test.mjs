/**
 * Shared reader browse journey (item 03, C11).
 *
 * Production static export + nginx-style server + desktop browser:
 * Shared home -> Travel (authored area) -> nested group -> real note ->
 * breadcrumb or browser Back. Direct extensionless routes for home, Travel,
 * and the nested note are also verified.
 *
 * The synthetic fixture always runs (no vault needed) and mirrors the real
 * Travel folder shape (upcoming, past, preferences). When SHARED_KB_ROOT
 * points at the Shared vault, the same journey runs against the real corpus
 * (55 selected Markdown + synthetic landing).
 *
 * Run with:
 *   node --test tests/shared-reader-journey-browser.test.mjs
 *   SHARED_KB_ROOT=/path/to/shared-vault node --test tests/shared-reader-journey-browser.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shared-journey-${prefix}-`))
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

/** Synthetic vault mirroring the real Travel shape plus the five areas. */
function makeJourneyKb() {
  const kb = tmpdir("kb-journey")
  writeFile(
    kb,
    "travel/index.md",
    "---\ntype: Area\nstatus: active\n---\n\n# Travel\n\nTravel is the household area for trip planning.\n",
  )
  writeFile(
    kb,
    "travel/upcoming/terradets-2026.md",
    '---\ntype: Trip\nstatus: booked\narea: "[[Travel]]"\n---\n\n# Terradets\n\nStay at Hotel Terradets.\n\n| Activity | Price |\n|---|---|\n| Kayak | 85 € |\n\nBook via [Montsec](https://montsecactiva.com/es/actividades/kayak-trek-mont-rebei/).\n',
  )
  writeFile(
    kb,
    "travel/upcoming/japan/index.md",
    '---\ntype: Trip\nstatus: planning\narea: "[[Travel]]"\n---\n\n# Japan\n\nFirst trip to Japan.\n',
  )
  writeFile(kb, "travel/upcoming/japan/itinerary.md", "# Japan Itinerary\n\nDay one in Osaka.\n")
  writeFile(
    kb,
    "travel/past/porto-2026/index.md",
    '---\ntype: Trip\nstatus: completed\narea: "[[Travel]]"\n---\n\n# Porto\n\nCity break hub.\n',
  )
  writeFile(kb, "travel/past/porto-2026/itinerary.md", "# Porto Itinerary\n\nDay-by-day plan.\n")
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
  // Staged but must stay off the Shared home.
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
      "title: Journey Garden",
      "canonicalHostname: journey.example.com",
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

/**
 * Shared assertions for the desktop journey. `expect` carries the corpus
 * titles so the same flow covers synthetic and real content.
 */
async function runJourney(page, baseUrl, expect) {
  // Home: exactly the five areas, no unselected area or sentinel.
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
  for (const label of expect.areas) {
    assert.ok(
      home.links.some((l) => l.text === label),
      `home shows area ${label} (got: ${home.links.map((l) => l.text).join("|")})`,
    )
  }
  assert.equal(home.links.length, 5, `home shows exactly five areas (got ${home.links.length})`)
  assert.ok(
    !home.body.includes("Mica") || home.sidebar.includes("Mica") === false,
    "home list excludes Mica",
  )
  for (const l of home.links) {
    assert.ok(!/mica/i.test(l.text), `home link excludes unselected area (got ${l.text})`)
    assert.ok(!/mica/i.test(l.href), `home href excludes unselected area (got ${l.href})`)
  }
  assert.ok(!home.body.includes("Tolaria Vault"), "home shows no known sentinel")
  assert.ok(!home.body.includes("_list_properties_display"), "home shows no type sentinel")
  assert.deepEqual(home.sidebar.sort(), [...expect.areas].sort(), "sidebar links the five areas")
  assert.equal(home.mainCount, 1, "one main landmark on home")
  assert.ok(home.navCount >= 1, "semantic navigation present on home")
  assert.equal(home.h1s.length, 1, `home article has one H1 (got ${home.h1s.join("|")})`)

  // Travel: authored area page, not a generic listing.
  const travelHref = home.links.find((l) => l.text === expect.travelTitle)?.href
  assert.ok(travelHref, "home Travel link has an href from staged content")
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      document.querySelector(`.reader-area-list a[href="${href}"]`)?.click()
    }, travelHref),
  ])
  assert.match(page.url(), /\/travel\/?$/, "selecting Travel opens its authored area route")
  const travel = await page.evaluate(() => ({
    h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
    h2s: Array.from(document.querySelectorAll("article h2")).map((h) => h.textContent?.trim()),
    body: document.body.textContent || "",
    sidebarActive:
      document.querySelector(".reader-sidebar-nav a.is-active")?.textContent?.trim() || null,
    sidebarCurrent:
      document.querySelector('.reader-sidebar-nav a[aria-current="page"]')?.textContent?.trim() ||
      null,
  }))
  assert.ok(
    travel.h1s.includes(expect.travelTitle),
    `Travel authored H1 (got ${travel.h1s.join("|")})`,
  )
  assert.match(travel.body, /household area for trip planning/i, "Travel authored introduction")
  for (const group of ["Upcoming trips", "Past trips", "Preferences"]) {
    assert.ok(travel.h2s.includes(group), `Travel groups include ${group}`)
  }
  assert.ok(
    !/broad collections|type collection|all notes/i.test(travel.body),
    "no broad type collections",
  )
  assert.equal(
    travel.sidebarActive,
    expect.travelTitle,
    "sidebar identifies the active Travel area",
  )

  // Nested group -> real note via normal link.
  const noteLink = await page.evaluate((title) => {
    const a = Array.from(document.querySelectorAll(".reader-group-list a")).find(
      (el) => el.textContent?.trim() === title,
    )
    return a ? a.getAttribute("href") : null
  }, expect.noteTitle)
  assert.ok(noteLink, `Travel groups link the nested note ${expect.noteTitle}`)
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      Array.from(document.querySelectorAll(".reader-group-list a"))
        .find((el) => el.getAttribute("href") === href)
        ?.click()
    }, noteLink),
  ])
  assert.ok(page.url().includes(expect.notePath), `nested note route ${expect.notePath}`)
  const note = await page.evaluate(() => ({
    h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
    mainCount: document.querySelectorAll("main").length,
    crumbs: Array.from(document.querySelectorAll(".reader-breadcrumbs li")).map((li) => ({
      text: li.textContent?.trim() || "",
      href: li.querySelector("a")?.getAttribute("href") || null,
    })),
    crumbTravelHref:
      document.querySelector('.reader-breadcrumbs a[href="/travel"]')?.getAttribute("href") || null,
    sidebarActive:
      document.querySelector(".reader-sidebar-nav a.is-active")?.textContent?.trim() || null,
  }))
  assert.equal(note.h1s.length, 1, `note has one primary heading (got ${note.h1s.join("|")})`)
  assert.ok(note.h1s.includes(expect.noteTitle), "nested note authored title")
  assert.equal(note.mainCount, 1, "one main landmark on the note")
  assert.ok(note.crumbs.length >= 3, "breadcrumbs expose folder ancestry")
  assert.equal(note.crumbTravelHref, "/travel", "breadcrumbs link Travel to the correct parent")
  assert.ok(
    note.crumbs[note.crumbs.length - 1].text.includes(expect.noteTitle),
    "breadcrumbs end at the note",
  )
  assert.equal(note.sidebarActive, expect.travelTitle, "sidebar stays on the Travel area")

  // Breadcrumb return, then browser Back through the journey.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate(() => {
      document.querySelector('.reader-breadcrumbs a[href="/travel"]')?.click()
    }),
  ])
  assert.match(page.url(), /\/travel\/?$/, "breadcrumb returns to the Travel parent")
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.ok(page.url().includes(expect.notePath), "browser Back returns to the nested note")
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.match(page.url(), /\/travel\/?$/, "browser Back returns to Travel")
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.match(page.url(), /\/$/, "browser Back returns to the Shared home")
}

test("synthetic browse journey covers home → Travel → nested group → note → Back", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const kb = makeJourneyKb()
  const work = tmpdir("synthetic")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(kb, contentDir, identityFile)
  fs.rmSync(path.join(READER_ROOT, ".source"), { recursive: true, force: true })
  fs.rmSync(path.join(READER_ROOT, ".next"), { recursive: true, force: true })
  fs.rmSync(path.join(READER_ROOT, "out"), { recursive: true, force: true })
  await buildReader(contentDir, identityFile)
  const outDir = path.join(READER_ROOT, "out")
  // Direct static-export routes exist.
  for (const rel of ["index.html", "travel.html", "travel/upcoming/terradets-2026.html"]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `static export emits ${rel}`)
  }

  const { server, baseUrl } = await serveOut(outDir)
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await runJourney(page, baseUrl, {
      areas: ["Travel", "Shared Finance", "Pets", "Life Planning", "Household Inbox"],
      travelTitle: "Travel",
      noteTitle: "Terradets",
      notePath: "/travel/upcoming/terradets-2026",
    })
    // Direct navigation to the nested note works from the static export.
    await page.goto(`${baseUrl}/travel/upcoming/terradets-2026`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    })
    const direct = await page.evaluate(() => ({
      h1: document.querySelector("article h1")?.textContent?.trim() || "",
      table: !!document.querySelector("article table"),
      external: !!document.querySelector('article a[href^="https://"]'),
    }))
    assert.equal(direct.h1, "Terradets", "direct note route renders the authored title")
    assert.ok(direct.table, "direct note renders tables")
    assert.ok(direct.external, "direct note renders external links")
    await page.close()
  } finally {
    await browser.close()
    server.close()
  }
})

test("real Shared browse journey covers home → Travel → nested note", async (t) => {
  const kbRoot = process.env.SHARED_KB_ROOT
  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip("SHARED_KB_ROOT is not set to a Shared vault checkout; skipping real-corpus journey")
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
  fs.rmSync(path.join(READER_ROOT, ".source"), { recursive: true, force: true })
  fs.rmSync(path.join(READER_ROOT, ".next"), { recursive: true, force: true })
  fs.rmSync(path.join(READER_ROOT, "out"), { recursive: true, force: true })
  await buildReader(contentDir, identityFile)
  const outDir = path.join(READER_ROOT, "out")
  for (const rel of ["index.html", "travel.html", "travel/upcoming/terradets-2026.html"]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `real static export emits ${rel}`)
  }

  const { server, baseUrl } = await serveOut(outDir)
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    await runJourney(page, baseUrl, {
      areas: ["Travel", "Shared Finance", "Pets", "Life Planning", "Household Inbox"],
      travelTitle: "Travel",
      noteTitle: "Terradets",
      notePath: "/travel/upcoming/terradets-2026",
    })
    await page.close()
  } finally {
    await browser.close()
    server.close()
  }
})
