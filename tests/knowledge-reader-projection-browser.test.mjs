/**
 * Projection switcher browser journey.
 *
 * Production static export + nginx-style server + desktop browser over a
 * tiny synthetic Knowledge Base: the sidebar switcher always shows the
 * current Web Projection, and with declared destinations it lists only
 * those choices as ordinary anchors to distinct HTTPS origins with
 * keyboard open/close and focus return. A second one-projection build
 * shows the current projection only. The phone drawer carries the same
 * switcher.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-projection-browser.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-projection-${prefix}-`))
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

function writeFile(root, rel, content) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/** Tiny synthetic Knowledge Base with an optional destinations block. */
function makeSwitcherKb({ destinations }) {
  const kb = tmpdir("kb-switcher")
  writeFile(kb, "index.md", "# Switch Garden\n\nTiny fixture for the projection switcher.\n")
  writeFile(kb, "notes/alpha.md", "# Alpha Note\n\nFirst note.\n")
  writeFile(kb, "about.md", "# About\n\nAbout page.\n")

  const lines = [
    "title: Switch Garden",
    "canonicalHostname: switch.example.com",
    "select:",
    "  - index.md",
    "  - notes",
    "  - about.md",
    "navigation:",
    "  - about.md",
    "  - notes",
  ]

  if (destinations) {
    lines.push("destinations:")

    for (const { name, origin } of destinations) {
      lines.push(`  - name: ${name}`, `    origin: ${origin}`)
    }
  }

  lines.push("")
  writeFile(kb, "publication.manifest.yaml", lines.join("\n"))

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

async function openSwitcher(page) {
  await page.evaluate(() => document.querySelector(".reader-projection-trigger")?.click())
  await page.waitForSelector(".reader-projection-menu", { visible: true, timeout: 5000 })
}

async function closeSwitcher(page) {
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => !document.querySelector(".reader-projection-menu"), {
    timeout: 5000,
  })
}

test("switcher lists only declared destinations as ordinary cross-origin anchors", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed",
  )
  const browser = await launchBrowser()

  const kb = makeSwitcherKb({
    destinations: [
      { name: "Personal Garden", origin: "https://personal.example.com" },
      { name: "Shared Garden", origin: "https://shared.example.com" },
    ],
  })

  const work = tmpdir("switcher")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outDir = path.join(READER_ROOT, "out")
  await stageKb(kb, contentDir, identityFile)

  const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  assert.deepEqual(identity.destinations, [
    { name: "Personal Garden", origin: "https://personal.example.com" },
    { name: "Shared Garden", origin: "https://shared.example.com" },
  ])

  for (const dir of [".source", ".next", "out"]) {
    fs.rmSync(path.join(READER_ROOT, dir), { recursive: true, force: true })
  }

  await buildReader(contentDir, identityFile)

  // Static export carries the switcher trigger with the current projection.
  const home = fs.readFileSync(path.join(outDir, "index.html"), "utf8")
  assert.ok(home.includes("reader-projection-trigger"), "static HTML carries the switcher")
  assert.ok(home.includes("Switch Garden"), "static HTML names the current projection")

  const { server, baseUrl } = await serveOut(outDir)
  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })

    // The trigger shows the current projection even before opening.
    const trigger = await page.evaluate(() => {
      const el = document.querySelector(".reader-projection-trigger")

      if (!el) return null
      const rect = el.getBoundingClientRect()

      return {
        text: el.textContent?.trim() || "",
        tag: el.tagName,
        visible: rect.width > 0 && rect.height > 0,
      }
    })

    assert.ok(trigger, "sidebar shows a projection switcher trigger")
    assert.ok(trigger.text.includes("Switch Garden"), "trigger names the current projection")
    assert.ok(trigger.visible, "switcher trigger is visible")

    await openSwitcher(page)

    const menu = await page.evaluate(() => {
      const root = document.querySelector(".reader-projection-menu")

      if (!root) return null

      const items = Array.from(root.querySelectorAll('[data-slot="dropdown-menu-item"]')).map(
        (el) => ({
          text: el.textContent?.trim() || "",
          tag: el.tagName,
          href: el.getAttribute("href"),
          target: el.getAttribute("target"),
          current: el.getAttribute("aria-current"),
        }),
      )

      return { text: root.textContent || "", items }
    })

    assert.ok(menu, "switcher opens a menu")
    assert.equal(menu.items.length, 3, "menu holds the current projection plus two choices")
    assert.ok(!menu.text.includes("Add"), "menu offers no add-projection action")

    const [current, ...choices] = menu.items
    assert.equal(current.current, "true", "first item marks the current projection")
    assert.ok(current.text.includes("Switch Garden"), "current item names this projection")
    assert.deepEqual(
      choices.map((choice) => ({ text: choice.text, href: choice.href })),
      [
        { text: "Personal Garden", href: "https://personal.example.com" },
        { text: "Shared Garden", href: "https://shared.example.com" },
      ],
      "choices keep manifest order with absolute HTTPS origins",
    )

    for (const choice of choices) {
      assert.equal(choice.tag, "A", "each choice is an ordinary anchor")
      assert.ok(choice.href?.startsWith("https://"), "each choice targets a secure origin")
      assert.equal(choice.target, null, "choices stay a same-tab normal navigation")
    }

    // Keyboard: Escape closes and returns focus to the trigger.
    await closeSwitcher(page)
    const returned = await page.evaluate(() => document.activeElement?.className || "")
    assert.ok(
      String(returned).includes("reader-projection-trigger"),
      "Escape returns focus to the switcher trigger",
    )

    // Keyboard: focusing the trigger and pressing Enter reopens the menu.
    await page.evaluate(() => document.querySelector(".reader-projection-trigger")?.focus())
    await page.keyboard.press("Enter")
    await page.waitForSelector(".reader-projection-menu", { visible: true, timeout: 5000 })
    await closeSwitcher(page)

    // Selecting a choice follows a normal top-level navigation to its
    // distinct origin. Both choice domains are reserved example names, so
    // the navigation request fails at DNS and the browser leaves this
    // origin for its error page; the failed-request log carries the
    // destination origin as proof of where the anchor pointed.
    await page.evaluate(() => document.querySelector(".reader-projection-trigger")?.click())

    await page.waitForSelector(".reader-projection-menu", { visible: true, timeout: 5000 })

    const failedUrls = []

    page.on("requestfailed", (req) => {
      failedUrls.push(req.url())
    })

    const navigation = page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 })
      .catch(() => null)

    await page.evaluate(() => document.querySelector(".reader-projection-choice")?.click())

    await navigation

    assert.ok(
      failedUrls.some((url) => url.startsWith("https://personal.example.com")),
      `choice navigates to its distinct origin (failed requests: ${failedUrls.join(", ")})`,
    )
    assert.ok(
      !page.url().startsWith(baseUrl),
      `navigation leaves the current origin (got ${page.url()})`,
    )

    // The phone drawer carries the same switcher with the same choices.
    const phone = await browser.newPage()

    try {
      await phone.setViewport({ width: 390, height: 844, isMobile: true })
      await phone.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
      await phone.evaluate(() => document.querySelector(".reader-browse-toggle")?.click())
      await phone.waitForSelector("#reader-browse-panel", { visible: true, timeout: 5000 })

      const drawerSwitcher = await phone.evaluate(() => {
        const el = document.querySelector(
          ".reader-phone-drawer-switcher .reader-projection-trigger",
        )

        if (!el) return null
        const rect = el.getBoundingClientRect()

        return { text: el.textContent?.trim() || "", visible: rect.width > 0 && rect.height > 0 }
      })

      assert.ok(drawerSwitcher, "phone drawer shows the projection switcher")
      assert.ok(
        drawerSwitcher.text.includes("Switch Garden"),
        "drawer switcher names the current projection",
      )
      assert.ok(drawerSwitcher.visible, "drawer switcher is visible")
    } finally {
      await phone.close()
    }
  } finally {
    await page.close()
    await new Promise((resolve) => server.close(resolve))
    await browser.close()
  }
})

test("one-projection site shows the current projection only", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed",
  )
  const browser = await launchBrowser()
  const kb = makeSwitcherKb({ destinations: null })
  const work = tmpdir("single")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outDir = path.join(READER_ROOT, "out")
  await stageKb(kb, contentDir, identityFile)

  const identity = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  assert.deepEqual(identity.destinations, [])

  for (const dir of [".source", ".next", "out"]) {
    fs.rmSync(path.join(READER_ROOT, dir), { recursive: true, force: true })
  }

  await buildReader(contentDir, identityFile)
  const { server, baseUrl } = await serveOut(outDir)
  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })

    const triggerText =
      (await page.evaluate(
        () => document.querySelector(".reader-projection-trigger")?.textContent?.trim() || null,
      )) || ""

    assert.ok(triggerText.includes("Switch Garden"), "single-projection header names the current")

    await openSwitcher(page)

    const menu = await page.evaluate(() => {
      const root = document.querySelector(".reader-projection-menu")

      if (!root) return null

      return {
        text: root.textContent || "",
        choices: root.querySelectorAll(".reader-projection-choice").length,
        currents: root.querySelectorAll(".reader-projection-current").length,
      }
    })

    assert.ok(menu, "single-projection menu still opens")
    assert.equal(menu.choices, 0, "no destination choices without declared destinations")
    assert.equal(menu.currents, 1, "current projection is still shown")
    assert.ok(!menu.text.includes("Add"), "no add-projection action appears")
  } finally {
    await page.close()
    await new Promise((resolve) => server.close(resolve))
    await browser.close()
  }
})
