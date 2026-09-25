/**
 * Shared reader browser-test environment.
 *
 * One harness for every reader browser journey: temporary directory
 * registration with resilient after-run cleanup, Knowledge Base staging and
 * reader-build spawn helpers, an nginx-style static file server, and lazy
 * Playwright browser launch plus desktop and phone contexts.
 *
 * The module imports cleanly without Playwright installed. Only launching a
 * browser requires it; the launch helpers fail with an actionable message
 * when it is missing.
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { after } from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..", "..")

export const READER_ROOT = path.join(PUBLISHER_ROOT, "reader")

export const STAGE_SCRIPT = path.join(PUBLISHER_ROOT, "scripts", "stage-content.mjs")

const tmpRoots = []

/** Create a tracked temporary directory; cleanup removes every tracked root. */
export function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-reader-${prefix}-`))
  tmpRoots.push(dir)

  return dir
}

/** Tracked temporary roots, oldest first. */
export function getTmpRoots() {
  return [...tmpRoots]
}

/**
 * Remove one directory tree, retrying transient macOS `.next` ENOTEMPTY
 * flakes (plus EBUSY/EPERM/EACCES) with exponential backoff.
 */
export function removeDirResilient(dir, { retries = 10, delayMs = 50 } = {}) {
  let delay = delayMs

  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })

      return
    } catch (error) {
      const code = error?.code

      const retryable =
        code === "ENOTEMPTY" || code === "EBUSY" || code === "EPERM" || code === "EACCES"

      if (!retryable || attempt >= retries) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
      delay = Math.min(delay * 2, 1000)
    }
  }
}

/** Remove generated reader build trees (`.source`, `.next`, `out`). */
export function cleanReaderArtifacts() {
  for (const dir of [".source", ".next", "out"]) {
    removeDirResilient(path.join(READER_ROOT, dir))
  }
}

/** After-run cleanup: reader artifacts plus every tracked temporary root. */
export function cleanupReaderEnv() {
  cleanReaderArtifacts()

  for (const dir of tmpRoots) removeDirResilient(dir)
  tmpRoots.length = 0
}

/** Register after-run cleanup for the importing test file. */
export function installReaderCleanup() {
  after(() => {
    cleanupReaderEnv()
  })
}

/** Stage a Knowledge Base into an isolated content directory plus identity file. */
export async function stageKb(kbRoot, contentDir, identityFile) {
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

/** Build the static reader export against staged content plus site identity. */
export async function buildReader(contentDir, identityFile) {
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

/** Locate a system Chrome/Chromium executable, honoring CHROME_PATH. */
export function findChrome() {
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

/**
 * Minimal nginx-style static server: try $uri, then $uri.html.
 *
 * Mirrors the deployed worker cache headers (no-cache for sw.js and
 * offline.json). Test-only access simulation: when armed via
 * `server.accessRedirectFor`, one published file answers like an online
 * session that expired mid-save (redirect to a same-origin sign-in page).
 */
export function createStaticServer(dir) {
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

/** Serve a static export on a loopback port. */
export async function serveOut(outDir) {
  const server = createStaticServer(outDir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()

  return { server, baseUrl: `http://${addr.address}:${addr.port}` }
}

/** Close a server started by serveOut. */
export async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

export const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
]

/** Exact phone-test viewports: narrow phone, larger phone, and desktop. */
export const NARROW_PHONE_VIEWPORT = { width: 360, height: 800, isMobile: true, hasTouch: true }

export const LARGER_PHONE_VIEWPORT = { width: 414, height: 896, isMobile: true, hasTouch: true }

export const DESKTOP_VIEWPORT = { width: 1280, height: 800 }

function playwrightMissingMessage(error) {
  return (
    `playwright is not installed (${error?.message ?? error}). ` +
    "Install it with `pnpm add -D playwright` then `pnpm exec playwright install chromium`, " +
    "or set CHROME_PATH to a Chrome/Chromium executable. " +
    "Browser journeys are verified by later consolidation items."
  )
}

/** Lazy Playwright import: the module loads without it; only launch needs it. */
async function loadPlaywright() {
  try {
    return await import("playwright")
  } catch (error) {
    assert.fail(playwrightMissingMessage(error))
  }
}

/** Launch Chromium for reader browser journeys. */
export async function launchBrowser(options = {}) {
  const playwright = await loadPlaywright()
  const chromePath = findChrome()

  try {
    return await playwright.chromium.launch({
      executablePath: chromePath || undefined,
      headless: true,
      args: [...CHROMIUM_ARGS],
      ...options,
    })
  } catch (error) {
    assert.fail(`Failed to launch Chromium: ${error.message}`)
  }
}

/** Desktop browsing context at the shared desktop viewport. */
export async function createDesktopContext(browser, options = {}) {
  return browser.newContext({
    viewport: { width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height },
    ...options,
  })
}

/** Phone browsing context: "narrow" (360) or "large" (414). */
export async function createPhoneContext(browser, size = "narrow", options = {}) {
  const viewport = size === "large" ? LARGER_PHONE_VIEWPORT : NARROW_PHONE_VIEWPORT

  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: true,
    hasTouch: true,
    ...options,
  })
}

/** Run one desktop page, closing its context afterwards. */
export async function withDesktopPage(browser, fn) {
  const context = await createDesktopContext(browser)

  try {
    await fn(await context.newPage())
  } finally {
    await context.close()
  }
}

/** Run one phone page (size "narrow" or "large"), closing its context afterwards. */
export async function withPhonePage(browser, size, fn) {
  const context = await createPhoneContext(browser, size)

  try {
    await fn(await context.newPage())
  } finally {
    await context.close()
  }
}
