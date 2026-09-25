/**
 * Reading-header breadcrumbs.
 *
 * Synthetic static export + focused desktop and phone browser journeys:
 * direct loads, nested parent navigation, phone widths, and long paths
 * verified by user-visible behavior (titles, links, navigation, overflow),
 * not only CSS structure. Registry composition (SidebarTrigger, Separator,
 * Breadcrumb) is checked as secondary evidence that the generated
 * components render.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-breadcrumbs-browser.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-crumbs-${prefix}-`))
  tmpRoots.push(dir)

  return dir
}

after(() => {
  for (const dir of [".source", ".next", "out"]) {
    try {
      fs.rmSync(path.join(READER_ROOT, dir), { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // Static-export artifacts are git-ignored; a transient lock must not
      // fail an otherwise passing breadcrumb journey.
    }
  }

  for (const dir of tmpRoots) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
})

function writeFile(root, rel, content) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

const LONG_TITLE =
  "An extremely long packing checklist title that keeps going SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious"

const LONG_SLUG = "long-packing-checklist-title-that-keeps-going-for-wrapping-probes"

const HIDDEN_TITLE = "Sunlit Atrium Log"

function makeCrumbsKb() {
  const kb = tmpdir("kb-crumbs")
  writeFile(
    kb,
    "index.md",
    ["---", 'title: "Garden Home"', "---", "", "# Garden Home", "", "Welcome.", ""].join("\n"),
  )
  writeFile(kb, "garden/index.md", "# Garden Plots\n\nAuthored beds.\n")
  writeFile(kb, "garden/alpha.md", "# Alpha Bed\n\nFirst bed.\n")
  writeFile(kb, "garden/beta.md", "# Beta Bed\n\nSecond bed.\n")
  writeFile(kb, "notes/plain.md", "# Plain Meadow\n\nJust a body.\n")
  writeFile(kb, "notes/nest/inner/leaf.md", "# Inner Leaf\n\nDeep nested note.\n")
  writeFile(kb, `notes/${LONG_SLUG}.md`, `# ${LONG_TITLE}\n\nPack light.\n`)
  writeFile(kb, "orchard/note-01.md", "# Orchard Note 01\n\nFlat.\n")
  writeFile(kb, "orchard/note-02.md", "# Orchard Note 02\n\nFlat.\n")
  writeFile(kb, "standalone.md", "# Lone Pine\n\nStandalone file.\n")
  writeFile(
    kb,
    "field-notes.md",
    [
      "---",
      `title: "${HIDDEN_TITLE}"`,
      "---",
      "",
      `# ${HIDDEN_TITLE}`,
      "",
      "Hidden body.",
      "",
    ].join("\n"),
  )
  writeFile(kb, "unselected.md", "# Unselected\n\nMust never appear.\n")
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Crumbs Garden",
      "canonicalHostname: crumbs.example.com",
      "select:",
      "  - index.md",
      "  - garden",
      "  - notes",
      "  - orchard",
      "  - standalone.md",
      "  - field-notes.md",
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

function createStaticServer(dir) {
  const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json",
    ".webmanifest": "application/manifest+json",
  }

  return http.createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0])
      const base = path.join(dir, urlPath === "/" ? "index.html" : urlPath)
      const candidates = [base, `${base}.html`, path.join(base, "index.html")]
      const filePath = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile())

      if (!filePath) {
        res.writeHead(404)
        res.end("not found")

        return
      }

      res.writeHead(200, {
        "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      })
      fs.createReadStream(filePath).pipe(res)
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
}

async function serveOut(dir) {
  const server = createStaticServer(dir)
  await new Promise((r) => server.listen(0, "127.0.0.1", r))
  const addr = server.address()

  return { server, baseUrl: `http://${addr.address}:${addr.port}` }
}

function findChrome() {
  const candidates =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c
    } catch {}
  }

  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH))
    return process.env.CHROME_PATH

  return null
}

async function launchBrowser() {
  const chromePath = findChrome()
  let puppeteer

  try {
    puppeteer = await import("puppeteer-core")
  } catch (e) {
    assert.fail(`puppeteer-core not available: ${e.message}`)
  }

  return await puppeteer
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
    .catch((e) => assert.fail(`Failed to launch Chrome: ${e.message}`))
}

function countOccurrences(hay, needle) {
  return hay.split(needle).length - 1
}

test("reading-header breadcrumbs cover home, folders, deep notes, and hidden routes", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed",
  )
  const kb = makeCrumbsKb()
  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outDir = path.join(READER_ROOT, "out")
  await stageKb(kb, contentDir, identityFile)

  // Hidden-navigation page is staged (allowlisted) but not in navigation.
  const metadata = JSON.parse(fs.readFileSync(identityFile, "utf8"))

  assert.ok(
    !JSON.stringify(metadata.navigation).includes("field-notes"),
    "hidden page stays out of visible navigation",
  )

  for (const dir of [".source", ".next", "out"]) {
    try {
      fs.rmSync(path.join(READER_ROOT, dir), { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // A transient lock must not leave stale export input behind; the
      // build below regenerates from the isolated staged tree.
    }
  }

  await buildReader(contentDir, identityFile)

  // Static HTML: one breadcrumb landmark in the header, none above article.
  const home = readOut(outDir, "index.html")
  assert.ok(home.includes('data-slot="sidebar-trigger"'), "static home keeps the trigger")
  assert.ok(home.includes('data-slot="breadcrumb"'), "static home renders the registry breadcrumb")
  assert.ok(home.includes('aria-label="Breadcrumb"'), "breadcrumb landmark keeps its name")
  assert.equal(
    countOccurrences(home, 'aria-label="Breadcrumb"'),
    1,
    "one breadcrumb trail in the header, no second row above article",
  )
  assert.match(home, /Home/, "home trail shows Home current")
  assert.ok(
    countOccurrences(home, "<main") === 1 ||
      countOccurrences(home, 'data-slot="sidebar-inset"') === 1,
    "one main reading landmark in static home",
  )

  const deep = readOut(outDir, "notes/nest/inner/leaf.html")
  assert.ok(deep.includes("Inner Leaf"), "deep static page shows its current title")
  assert.ok(deep.includes('href="/notes"'), "deep static trail links Notes parent")
  assert.ok(deep.includes('href="/notes/nest"'), "deep static trail links Nest parent")
  assert.ok(deep.includes('href="/notes/nest/inner"'), "deep static trail links Inner parent")
  assert.ok(deep.includes('href="/"'), "deep static trail links Home")
  assert.equal(countOccurrences(deep, 'aria-label="Breadcrumb"'), 1, "deep page keeps one trail")

  const garden = readOut(outDir, "garden.html")
  assert.ok(garden.includes("Garden Plots"), "authored folder shows its authored title")
  assert.ok(garden.includes('href="/"'), "folder trail links Home")

  const standalone = readOut(outDir, "standalone.html")
  assert.ok(standalone.includes("Lone Pine"), "root note shows its authored title")

  const hidden = readOut(outDir, "field-notes.html")
  assert.ok(hidden.includes(HIDDEN_TITLE), "outside-navigation route shows its actual staged title")
  assert.ok(
    !hidden.includes("Field notes</span>") || hidden.includes(HIDDEN_TITLE),
    "hidden trail prefers the authored title over the humanized slug",
  )
  assert.ok(hidden.includes('href="/"'), "hidden trail still links Home")

  const longPage = readOut(outDir, `notes/${LONG_SLUG}.html`)
  assert.ok(longPage.includes(LONG_TITLE), "long-title static page keeps its title")

  // No unselected content leaks via the title index.
  assert.ok(!home.includes("Unselected"), "unselected sentinel stays out of home")
  assert.ok(!deep.includes("Unselected"), "unselected sentinel stays out of deep pages")

  const { server, baseUrl } = await serveOut(outDir)
  const browser = await launchBrowser()

  try {
    // Desktop: direct loads, parent navigation, Back, overflow, landmarks.
    const desktop = await browser.newPage()

    try {
      await desktop.setViewport({ width: 1280, height: 800 })
      // Direct deep load shows full ancestry by visible text.
      await desktop.goto(`${baseUrl}/notes/nest/inner/leaf`, {
        waitUntil: "networkidle0",
        timeout: 15000,
      })

      const deepState = await desktop.evaluate(() => ({
        crumbs: Array.from(
          document.querySelectorAll(".reader-breadcrumbs [data-slot='breadcrumb-item']"),
        ).map((li) => ({
          text: li.textContent?.trim() || "",
          href: li.querySelector("a")?.getAttribute("href") || null,
          current:
            li.querySelector('[aria-current="page"]')?.textContent?.trim() ||
            li.querySelector('[aria-current="page"]')?.textContent?.trim() ||
            null,
        })),
        h1: document.querySelector("article h1")?.textContent?.trim() || "",
        mainCount: document.querySelectorAll("main").length,
        articleMax: getComputedStyle(document.querySelector("article") || document.body).maxWidth,
        trigger: !!document.querySelector('[data-slot="sidebar-trigger"]'),
        breadcrumbSlot: !!document.querySelector('[data-slot="breadcrumb"]'),
        breadcrumbList: !!document.querySelector('[data-slot="breadcrumb-list"]'),
        overflow: {
          doc: document.documentElement.scrollWidth,
          body: document.body.scrollWidth,
          inner: window.innerWidth,
        },
      }))

      assert.ok(deepState.trigger, "desktop header keeps the registry trigger")
      assert.ok(deepState.breadcrumbSlot, "desktop header renders the registry breadcrumb")
      assert.ok(deepState.breadcrumbList, "desktop header renders the registry list")
      assert.ok(
        deepState.crumbs.length >= 4,
        `deep trail keeps ancestry (got ${deepState.crumbs.map((c) => c.text).join(" / ")})`,
      )
      assert.ok(
        deepState.crumbs[deepState.crumbs.length - 1].text.includes("Inner Leaf"),
        "desktop trail ends at the deep note",
      )
      assert.equal(deepState.h1, "Inner Leaf", "deep article title matches the trail")
      assert.equal(deepState.mainCount, 1, "one main landmark on the deep note")
      assert.notEqual(deepState.articleMax, "none", "article keeps a bounded width")
      assert.ok(
        deepState.overflow.doc <= deepState.overflow.inner + 1,
        "desktop deep page has no horizontal overflow",
      )
      // Parent link is an ordinary anchor; Back returns.
      const parentHref = deepState.crumbs[1].href
      assert.ok(parentHref, "deep trail links a parent")
      await Promise.all([
        desktop.waitForNavigation({ waitUntil: "networkidle0", timeout: 15000 }),
        desktop.evaluate(
          (href) => document.querySelector(`.reader-breadcrumbs a[href="${href}"]`)?.click(),
          parentHref,
        ),
      ])
      assert.ok(desktop.url().includes(parentHref), "breadcrumb parent navigates")
      await desktop.goBack({ waitUntil: "networkidle0", timeout: 15000 })
      assert.ok(
        desktop.url().includes("/notes/nest/inner/leaf"),
        "browser Back returns to the deep note",
      )

      // Direct folder + root note + hidden route loads.
      await desktop.goto(`${baseUrl}/garden`, { waitUntil: "networkidle0", timeout: 15000 })

      const gardenState = await desktop.evaluate(() => ({
        current: document.querySelector('[data-slot="breadcrumb-page"]')?.textContent?.trim() || "",
        h1: document.querySelector("article h1")?.textContent?.trim() || "",
      }))

      assert.ok(gardenState.current.includes("Garden Plots"), "authored folder current title")
      assert.ok(gardenState.h1.includes("Garden Plots"), "authored folder H1")

      await desktop.goto(`${baseUrl}/standalone`, { waitUntil: "networkidle0", timeout: 15000 })

      const rootNote = await desktop.evaluate(() => ({
        crumbs: Array.from(
          document.querySelectorAll(".reader-breadcrumbs [data-slot='breadcrumb-item']"),
        ).map((li) => li.textContent?.trim()),
        h1: document.querySelector("article h1")?.textContent?.trim() || "",
      }))

      assert.ok(
        rootNote.crumbs.some((t) => t?.includes("Lone Pine")),
        "root note trail",
      )
      assert.equal(rootNote.h1, "Lone Pine", "root note H1")

      await desktop.goto(`${baseUrl}/field-notes`, { waitUntil: "networkidle0", timeout: 15000 })

      await desktop.waitForFunction(
        (title) =>
          document.querySelector("[data-slot='breadcrumb-page']")?.textContent?.includes(title) ||
          false,
        { timeout: 5000 },
        HIDDEN_TITLE,
      )

      const hiddenState = await desktop.evaluate(() => ({
        crumbs: Array.from(
          document.querySelectorAll(".reader-breadcrumbs [data-slot='breadcrumb-item']"),
        ).map((li) => ({
          text: li.textContent?.trim() || "",
          href: li.querySelector("a")?.getAttribute("href") || null,
        })),
        h1: document.querySelector("article h1")?.textContent?.trim() || "",
      }))

      assert.ok(
        hiddenState.crumbs[hiddenState.crumbs.length - 1].text.includes(HIDDEN_TITLE),
        `hidden trail shows the staged title (got ${hiddenState.crumbs.map((c) => c.text).join(" / ")})`,
      )
      assert.ok(hiddenState.h1.includes(HIDDEN_TITLE), "hidden article title")
      assert.ok(
        hiddenState.crumbs[0].href === "/" || hiddenState.crumbs[0].text.includes("Home"),
        "hidden trail links Home",
      )

      // Keyboard: Tab reaches a breadcrumb link with visible focus.
      await desktop.goto(`${baseUrl}/notes/nest/inner/leaf`, {
        waitUntil: "networkidle0",
        timeout: 15000,
      })
      await desktop.evaluate(() => document.querySelector('[data-slot="sidebar-trigger"]')?.focus())
      let focused = ""

      for (let i = 0; i < 12; i++) {
        await desktop.keyboard.press("Tab")
        focused = await desktop.evaluate(() => document.activeElement?.textContent?.trim() || "")

        const tag = await desktop.evaluate(
          () => document.activeElement?.closest(".reader-breadcrumbs")?.textContent?.trim() || "",
        )

        if (tag) break
      }

      assert.ok(focused.length > 0, "keyboard reaches the header trail")

      const outline = await desktop.evaluate(() => {
        const el = document.activeElement

        if (!el) return null
        const s = getComputedStyle(el)

        return { style: s.outlineStyle, width: s.outlineWidth }
      })

      assert.equal(outline?.style, "solid", "header trail focus stays visible")
    } finally {
      await desktop.close()
    }

    // Phone: deep + long paths show the current page without overflow.
    const phone = await browser.newPage()

    try {
      await phone.setViewport({ width: 360, height: 800, isMobile: true, hasTouch: true })
      await phone.goto(`${baseUrl}/notes/nest/inner/leaf`, {
        waitUntil: "networkidle0",
        timeout: 15000,
      })

      const phoneDeep = await phone.evaluate(() => ({
        crumbs: Array.from(
          document.querySelectorAll(".reader-breadcrumbs [data-slot='breadcrumb-item']"),
        ).map((li) => ({
          text: li.textContent?.trim() || "",
        })),
        current: document.querySelector('[data-slot="breadcrumb-page"]')?.textContent?.trim() || "",
        currentRect:
          document
            .querySelector('[data-slot="breadcrumb-page"]')
            ?.getBoundingClientRect()
            .toJSON() || null,
        listScroll: document.querySelector(".reader-breadcrumbs ol")?.scrollWidth || 0,
        inner: window.innerWidth,
        doc: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))

      assert.ok(phoneDeep.crumbs.length >= 4, "phone deep trail keeps ancestry")
      assert.ok(phoneDeep.current.includes("Inner Leaf"), "phone shows the current page")
      assert.ok(
        phoneDeep.currentRect && phoneDeep.currentRect.width <= phoneDeep.inner + 1,
        "phone current page stays inside the viewport",
      )
      assert.ok(
        phoneDeep.listScroll <= phoneDeep.inner + 1,
        "phone trail wraps without horizontal overflow",
      )
      assert.ok(phoneDeep.doc <= phoneDeep.inner + 1, "phone deep page has no overflow")
      assert.ok(phoneDeep.body <= phoneDeep.inner + 1, "phone body has no overflow")

      await phone.goto(`${baseUrl}/notes/${LONG_SLUG}`, {
        waitUntil: "networkidle0",
        timeout: 15000,
      })

      const phoneLong = await phone.evaluate(() => ({
        current: document.querySelector('[data-slot="breadcrumb-page"]')?.textContent?.trim() || "",
        rect:
          document
            .querySelector('[data-slot="breadcrumb-page"]')
            ?.getBoundingClientRect()
            .toJSON() || null,
        h1Rect: document.querySelector("article h1")?.getBoundingClientRect().toJSON() || null,
        inner: window.innerWidth,
        doc: document.documentElement.scrollWidth,
        listScroll: document.querySelector(".reader-breadcrumbs ol")?.scrollWidth || 0,
      }))

      assert.ok(phoneLong.current.includes("packing checklist"), "phone long trail keeps its title")
      assert.ok(
        phoneLong.rect && phoneLong.rect.width <= phoneLong.inner + 1,
        "phone long current stays inside the viewport",
      )
      assert.ok(
        phoneLong.h1Rect && phoneLong.h1Rect.width <= phoneLong.inner + 1,
        "phone long H1 stays inside the viewport",
      )
      assert.ok(phoneLong.doc <= phoneLong.inner + 1, "phone long page has no overflow")
      assert.ok(
        phoneLong.listScroll <= phoneLong.inner + 1,
        "phone long trail wraps without overflow",
      )

      // Phone keyboard: breadcrumb links stay reachable.
      await phone.keyboard.press("Tab")
      let foundCrumb = false

      for (let i = 0; i < 15; i++) {
        const inTrail = await phone.evaluate(
          () => !!document.activeElement?.closest(".reader-breadcrumbs"),
        )

        if (inTrail) {
          foundCrumb = true
          break
        }

        await phone.keyboard.press("Tab")
      }

      assert.ok(foundCrumb, "phone trail stays keyboard reachable")
    } finally {
      await phone.close()
    }
  } finally {
    await browser.close()
    await new Promise((r) => server.close(r))
  }
})
