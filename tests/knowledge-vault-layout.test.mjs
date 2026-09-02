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

async function stageKb(kb, contentDir, configFile) {
  fs.copyFileSync(TRACKED_CONFIG, configFile)
  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", contentDir, "--config-file", configFile],
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

test("collection nav has no horizontal overflow at narrow and desktop widths", async () => {
  const kb = makeKb()
  writeManifest(kb)
  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const configFile = path.join(work, "quartz.config.yaml")
  const outputDir = path.join(work, "public")
  await stageKb(kb, contentDir, configFile)
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
