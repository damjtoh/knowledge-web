/**
 * Knowledge reader home root cards.
 *
 * Synthetic fixtures (no vault needed) prove the Home card slice through
 * the same static-export plus browser seam as the existing reader suites:
 * one card per published navigation root in manifest order with a normal
 * static link and a distinct folder/note cue, accurate immediate-child
 * counts without invented summaries, an authored introduction retained
 * above the cards, a synthetic fallback without a duplicated generated
 * list, no Home self-link, and responsive real navigation at desktop and
 * phone widths.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-home-cards.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-home-cards-${prefix}-`))
  tmpRoots.push(dir)

  return dir
}

function cleanReaderArtifacts() {
  for (const dir of [".source", ".next", "out"]) {
    fs.rmSync(path.join(READER_ROOT, dir), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    })
  }
}

after(() => {
  cleanReaderArtifacts()

  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

function writeFile(root, rel, content) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

const LONG_TITLE =
  "An extremely long packing checklist title that keeps going SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious"

/** Authored Home with mixed note/folder roots, counts, and a long-title note root. */
function makeAuthoredKb() {
  const kb = tmpdir("kb-authored")
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
      "Welcome to the card garden.",
      "",
    ].join("\n"),
  )
  writeFile(kb, "garden/index.md", "# Garden Plots\n\nCultivated beds.\n")
  writeFile(kb, "garden/alpha.md", "# Alpha Bed\n\nFirst bed.\n")
  writeFile(kb, "garden/beta.md", "# Beta Bed\n\nSecond bed.\n")
  writeFile(kb, "notes/plain.md", "# Plain Meadow\n\nJust a body.\n")
  writeFile(kb, "notes/guide.md", "# Field Guide\n\nA short guide.\n")

  for (const n of ["01", "02", "03"]) {
    writeFile(kb, `orchard/note-${n}.md`, `# Orchard Note ${n}\n\nFlat orchard note ${n}.\n`)
  }

  writeFile(kb, "standalone.md", "# Lone Pine\n\nStandalone file.\n")
  writeFile(kb, "long.md", `# ${LONG_TITLE}\n\nA long-titled note root.\n`)
  writeFile(kb, "hidden.md", "# Hidden Hollow\n\nNot in navigation.\n")
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Card Garden",
      "canonicalHostname: cards.example.com",
      "select:",
      "  - index.md",
      "  - garden",
      "  - notes",
      "  - orchard",
      "  - standalone.md",
      "  - long.md",
      "  - hidden.md",
      "navigation:",
      "  - index.md",
      "  - standalone.md",
      "  - orchard",
      "  - notes",
      "  - garden",
      "  - long.md",
      "",
    ].join("\n"),
  )

  return kb
}

/** No authored root: staging emits the synthetic landing; navigation names a Home root. */
function makeSyntheticKb() {
  const kb = tmpdir("kb-synthetic")
  writeFile(kb, "garden/index.md", "# Garden Plots\n\nCultivated beds.\n")
  writeFile(kb, "garden/alpha.md", "# Alpha Bed\n\nFirst bed.\n")
  writeFile(kb, "notes/plain.md", "# Plain Meadow\n\nJust a body.\n")
  writeFile(kb, "standalone.md", "# Lone Pine\n\nStandalone file.\n")
  writeFile(kb, "hidden.md", "# Hidden Hollow\n\nNot in navigation.\n")
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Synthetic Cards",
      "canonicalHostname: synthetic-cards.example.com",
      "select:",
      "  - garden",
      "  - notes",
      "  - standalone.md",
      "  - hidden.md",
      "navigation:",
      "  - standalone.md",
      "  - notes",
      "  - garden",
      "",
    ].join("\n"),
  )

  return kb
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

function readOut(outDir, rel) {
  return fs.readFileSync(path.join(outDir, rel), "utf8")
}

/** Minimal nginx-style static server: try $uri, then $uri.html. */
function createStaticServer(dir) {
  const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
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

async function serveOut(dir) {
  const server = createStaticServer(dir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()

  return { server, baseUrl: `http://${addr.address}:${addr.port}` }
}

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

/** Card links inside the home area list, in rendered order. */
function areaListSection(home) {
  const start = home.indexOf("reader-area-list")

  if (start === -1) return ""

  return home.slice(start).split("</ul>")[0]
}

function areaListLinks(home) {
  const section = areaListSection(home)
  const links = []

  for (const tag of section.matchAll(/<a\b[^>]*>/g)) {
    const href = tag[0].match(/href="([^"]+)"/)?.[1]
    const kind = tag[0].match(/data-kind="(folder|note)"/)?.[1]

    if (href && kind) links.push({ href, kind })
  }

  return links
}

function assertNoHomeSelfLink(home) {
  const section = areaListSection(home)

  assert.ok(!/href="\/"/.test(section), "no Home self-link card")
}

function assertCardMetaOnly(home) {
  const section = areaListSection(home)

  const metas = [...section.matchAll(/reader-home-card-meta[^>]*>([^<]*)</g)].map((m) =>
    m[1].trim(),
  )

  assert.ok(metas.length > 0, "folder/note cards carry a kind meta line")

  for (const meta of metas) {
    assert.match(
      meta,
      /^(Folder|Note)( · \d+ items?)?$/,
      `card meta stays kind plus count: ${meta}`,
    )
  }
}

async function runCardJourney(page, baseUrl, expect, label) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })

  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => ({
      text: a.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
      kind: a.getAttribute("data-kind") || "",
      card: !!a.querySelector('[data-slot="card"]'),
    })),
  )

  assert.deepEqual(
    cards.map((c) => c.href),
    expect.hrefs,
    `${label}: cards link published routes`,
  )
  assert.deepEqual(
    cards.map((c) => c.kind),
    expect.kinds,
    `${label}: cards keep distinct folder/note cues`,
  )

  expect.titles.forEach((title, i) => {
    assert.ok(cards[i].text.includes(title), `${label}: card keeps its published title: ${title}`)
  })

  for (const card of cards) {
    assert.ok(card.card, `${label}: card uses the registry Card surface`)
    assert.ok(card.kind === "folder" || card.kind === "note", `${label}: distinct folder/note cue`)
  }

  assert.ok(!cards.some((c) => c.href === "/"), `${label}: no Home self-link card`)

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))

  assert.ok(
    overflow.doc <= overflow.inner + 1,
    `${label}: document width ${overflow.doc} inside viewport ${overflow.inner}`,
  )

  const titlesFit = await page.evaluate(() => {
    const titles = Array.from(
      document.querySelectorAll(".reader-area-list .reader-home-card-title"),
    )

    return titles.map((el) => ({
      right: el.getBoundingClientRect().right,
      inner: window.innerWidth,
    }))
  })

  for (const title of titlesFit) {
    assert.ok(title.right <= title.inner + 1, `${label}: long card title stays inside the viewport`)
  }

  for (const height of await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-area-list a")).map(
      (a) => a.getBoundingClientRect().height,
    ),
  )) {
    assert.ok(height >= 44, `${label}: card link touch target is ${height}px (expected >= 44)`)
  }

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
    page.evaluate((href) => {
      document.querySelector(`.reader-area-list a[href="${href}"]`)?.click()
    }, expect.visitHref),
  ])
  assert.ok(page.url().includes(expect.visitHref), `${label}: card opens its published route`)
  await page.goBack({ waitUntil: "networkidle0", timeout: 15000 })
  assert.match(page.url(), /\/$/, `${label}: Back returns home`)
}

test("authored Home presents ordered registry cards with Home-root omission and real navigation", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed",
  )
  const kb = makeAuthoredKb()
  const work = tmpdir("authored")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(kb, contentDir, identityFile)
  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)
  const outDir = path.join(READER_ROOT, "out")
  const home = readOut(outDir, "index.html")

  assert.match(home, /Welcome to the card garden\./, "authored Home introduction stays above cards")
  assert.ok(home.includes('data-slot="card"'), "cards use the registry Card surface")

  const positions = ["Lone Pine", "Orchard", "Notes", "Garden Plots", LONG_TITLE].map((text) =>
    home.indexOf(text),
  )

  assert.ok(
    positions.every((pos) => pos !== -1),
    "home cards cover every published root",
  )
  assert.ok(
    positions.every((pos, i, all) => i === 0 || all[i - 1] < pos),
    "home cards keep manifest order",
  )

  const links = areaListLinks(home)

  assert.equal(links.length, 5, "one card per published root, minus the omitted Home root")
  assert.deepEqual(
    links.map((l) => l.href),
    ["/standalone", "/orchard", "/notes", "/garden", "/long"],
    "cards link only published routes in order",
  )
  assert.deepEqual(
    links.map((l) => l.kind),
    ["note", "folder", "folder", "folder", "note"],
    "folder and note cards carry distinct cues",
  )
  assert.match(home, /Folder · 3 items/, "orchard folder count is accurate")
  assert.match(home, /Folder · 2 items/, "folder counts are accurate")
  assertCardMetaOnly(home)
  assert.ok(!home.includes("Hidden Hollow"), "routes outside navigation never become cards")
  assertNoHomeSelfLink(home)

  const { server, baseUrl } = await serveOut(outDir)
  const browser = await launchBrowser()

  try {
    const desktop = await browser.newPage()
    await desktop.setViewport({ width: 1280, height: 800 })
    await runCardJourney(
      desktop,
      baseUrl,
      {
        titles: ["Lone Pine", "Orchard", "Notes", "Garden Plots", LONG_TITLE],
        hrefs: ["/standalone", "/orchard", "/notes", "/garden", "/long"],
        kinds: ["note", "folder", "folder", "folder", "note"],
        visitHref: "/orchard",
      },
      "desktop cards",
    )
    await desktop.close()

    const phone = await browser.newPage()
    await phone.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true })
    await runCardJourney(
      phone,
      baseUrl,
      {
        titles: ["Lone Pine", "Orchard", "Notes", "Garden Plots", LONG_TITLE],
        hrefs: ["/standalone", "/orchard", "/notes", "/garden", "/long"],
        kinds: ["note", "folder", "folder", "folder", "note"],
        visitHref: "/garden",
      },
      "phone cards",
    )
    await phone.close()
  } finally {
    await browser.close()
    server.close()
  }
})

test("synthetic Home keeps its fallback with no duplicated list and no Home self-link", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed",
  )
  const kb = makeSyntheticKb()
  const work = tmpdir("synthetic")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(kb, contentDir, identityFile)
  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)
  const outDir = path.join(READER_ROOT, "out")
  const home = readOut(outDir, "index.html")

  assert.match(
    home,
    /Browse the published sections\./,
    "synthetic fallback introduction is retained",
  )
  assert.ok(
    !home.includes("Browse the published content of this Knowledge Base."),
    "synthetic generated list is not duplicated",
  )
  assert.ok(home.includes('data-slot="card"'), "synthetic cards use the registry Card surface")

  const links = areaListLinks(home)

  assert.deepEqual(
    links.map((l) => l.href),
    ["/standalone", "/notes", "/garden"],
    "synthetic cards follow manifest order without the Home root",
  )
  assert.deepEqual(
    links.map((l) => l.kind),
    ["note", "folder", "folder"],
    "synthetic cards keep distinct folder/note cues",
  )
  assertCardMetaOnly(home)
  assert.ok(!home.includes("Hidden Hollow"), "routes outside navigation never become cards")
  assertNoHomeSelfLink(home)

  const { server, baseUrl } = await serveOut(outDir)
  const browser = await launchBrowser()

  try {
    const phone = await browser.newPage()
    await phone.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true })
    await runCardJourney(
      phone,
      baseUrl,
      {
        titles: ["Lone Pine", "Notes", "Garden Plots"],
        hrefs: ["/standalone", "/notes", "/garden"],
        kinds: ["note", "folder", "folder"],
        visitHref: "/notes",
      },
      "synthetic phone cards",
    )
    await phone.close()
  } finally {
    await browser.close()
    server.close()
  }
})
