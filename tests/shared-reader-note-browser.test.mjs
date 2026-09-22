/**
 * Shared reader production-browser check (C11).
 *
 * Serves the real-corpus static export through an nginx-style static server
 * (extensionless routes resolve via the `.html` fallback, as in nginx.conf)
 * and proves the direct Travel note is readable in a production browser:
 * document title, authored H1, article body, tables, and canonical metadata.
 *
 * Run with:
 *   SHARED_KB_ROOT=/path/to/shared-vault node --test tests/shared-reader-note-browser.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shared-reader-browser-${prefix}-`))
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

/** Minimal nginx-style static server: try $uri, then $uri.html, then $uri/. */
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
      // nginx try_files order: exact file, then $uri.html, then $uri/index.
      // (Exported note routes sit next to per-route data directories, so the
      // directory probe must not shadow the $uri.html fallback.)
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

test("exported direct Travel note is readable in a production browser", async (t) => {
  const kbRoot = process.env.SHARED_KB_ROOT
  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip("SHARED_KB_ROOT is not set to a Shared vault checkout; skipping browser check")
    return
  }
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )

  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
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
  await execFileAsync("npm", ["run", "build"], {
    cwd: READER_ROOT,
    timeout: 600000,
    env: {
      ...process.env,
      SHARED_CONTENT_DIR: contentDir,
      SHARED_IDENTITY_FILE: identityFile,
    },
  })
  const outDir = path.join(READER_ROOT, "out")
  assert.ok(fs.existsSync(path.join(outDir, "travel/upcoming/terradets-2026.html")))

  const chromePath = findChrome()
  let puppeteer
  try {
    puppeteer = await import("puppeteer-core")
  } catch (error) {
    assert.fail(`puppeteer-core not available: ${error.message}`)
  }

  const server = createStaticServer(outDir)
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
  } catch (error) {
    server.close()
    assert.fail(`Failed to launch Chrome: ${error.message}`)
  }

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1280, height: 800 })
    // Extensionless direct route, resolved through the nginx-style fallback.
    await page.goto(`${baseUrl}/travel/upcoming/terradets-2026`, {
      waitUntil: "networkidle0",
      timeout: 15000,
    })
    const note = await page.evaluate(() => {
      const article = document.querySelector("article.reader-article")
      const h1s = Array.from(document.querySelectorAll("article.reader-article h1"))
      const canonical = document.querySelector('link[rel="canonical"]')
      return {
        title: document.title,
        mainCount: document.querySelectorAll("main").length,
        articleExists: !!article,
        h1Texts: h1s.map((h) => h.textContent?.trim() || ""),
        bodyLength: (article?.textContent || "").trim().length,
        tableCount: article ? article.querySelectorAll("table").length : 0,
        hasExternalLink: !!article?.querySelector('a[href^="https://"]'),
        canonicalHref: canonical?.getAttribute("href") || null,
      }
    })
    assert.match(note.title, /Terradets/, "document title carries the authored note title")
    assert.match(note.title, /Shared Vault/, "document title carries the generated site title")
    assert.equal(note.mainCount, 1, "one main landmark")
    assert.ok(note.articleExists, "readable article element")
    assert.ok(
      note.h1Texts.includes("Terradets"),
      `authored H1 rendered (got: ${note.h1Texts.join("|")})`,
    )
    assert.ok(note.bodyLength > 1000, `article body is substantial (got ${note.bodyLength} chars)`)
    assert.ok(note.tableCount >= 1, `real tables rendered (got ${note.tableCount})`)
    assert.ok(note.hasExternalLink, "real external links rendered")
    assert.equal(
      note.canonicalHref,
      "https://shared.dami.dev/travel/upcoming/terradets-2026",
      "canonical hostname metadata",
    )
    await page.close()
  } finally {
    await browser.close()
    server.close()
  }
})
