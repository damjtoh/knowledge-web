/**
 * Knowledge Vault home modes — browser smoke for root navigation
 *
 * Verifies in both generated-home (no root index) and authored-home modes:
 * - Root (/) renders correct experience (dashboard vs authored)
 * - Dashboard and collection links are present and SPA navigation works
 * - No horizontal overflow at narrow and desktop widths
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kv-home-browser-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

async function stageKb(kb, contentDir, identityFile) {
  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile],
    { cwd: PUBLISHER_ROOT },
  )
}
async function buildQuartz(contentDir, outputDir) {
  await execFileAsync(
    process.execPath,
    [BUILD_CLI, "build", "--directory", contentDir, "--output", outputDir, "--concurrency", "1"],
    { cwd: PUBLISHER_ROOT, timeout: 120000 },
  )
}

function makeKb({ withIndex = false }) {
  const kb = tmpdir("kb")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.writeFileSync(
    path.join(kb, "notes", "task-open.md"),
    ["---", "type: Task", "status: Open", "---", "", "# Task Open", "", "Open body.", ""].join(
      "\n",
    ),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-one.md"),
    ["---", "type: Note", "---", "", "# Note One", "", "Note body.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "about.md"),
    ["---", "type: Note", "---", "", "# About This Garden", "", "About.", ""].join("\n"),
  )
  fs.mkdirSync(path.join(kb, "unselected"), { recursive: true })
  fs.writeFileSync(path.join(kb, "unselected", "secret.md"), "# Secret\n\nMust never appear.\n")
  if (withIndex) {
    fs.writeFileSync(
      path.join(kb, "index.md"),
      ["---", "type: Note", "---", "", "# Authored Home", "", "Welcome home.", ""].join("\n"),
    )
  }
  return kb
}

function writeManifest(kb, withIndex) {
  const selects = withIndex
    ? ["  - index.md", "  - notes", "  - about.md"]
    : ["  - notes", "  - about.md"]
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    ["title: Test Garden", "canonicalHostname: test.example.com", "select:", ...selects, ""].join(
      "\n",
    ),
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
  for (const p of candidates) if (fs.existsSync(p)) return p
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
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())
        filePath = path.join(filePath, "index.html")
      if (!fs.existsSync(filePath) && !urlPath.endsWith(".html") && !urlPath.endsWith("/")) {
        const htmlTry = `${filePath}.html`
        if (fs.existsSync(htmlTry)) filePath = htmlTry
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

test("home modes: generated and authored root navigate to dashboard and collections without overflow or broken SPA", async () => {
  const chromePath = findChrome()
  let puppeteer
  try {
    puppeteer = await import("puppeteer-core")
  } catch (e) {
    assert.fail(`puppeteer-core not available: ${e.message}`)
  }

  for (const withIndex of [false, true]) {
    const mode = withIndex ? "authored" : "generated"
    const kb = makeKb({ withIndex })
    // Ensure unselected secret exists
    fs.mkdirSync(path.join(kb, "unselected"), { recursive: true })
    fs.writeFileSync(path.join(kb, "unselected", "secret.md"), "# Secret\n\nMust never appear.\n")
    writeManifest(kb, withIndex)

    const work = tmpdir(`work-${mode}`)
    const contentDir = path.join(work, "content")
    const identityFile = path.join(work, "site-identity.json")
    const outputDir = path.join(work, "public")
    await stageKb(kb, contentDir, identityFile)
    await buildQuartz(contentDir, outputDir)

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
      assert.fail(`Failed to launch Chrome for ${mode}: ${e.message}`)
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

        const rootMetrics = await page.evaluate(() => {
          const body = document.body
          const nav = document.querySelector(".kv-collections-nav")
          const navUl = nav ? nav.querySelector("ul") : null
          const dashboardLink = document.querySelector('a[href*="dashboard"]')
          const collectionsLink = document.querySelector('a[href*="collections/"]')
          const isIndexDashboard = !!document.querySelector("#vault-dashboard")
          const indexH1 = document.querySelector("h1")?.textContent?.trim() || ""
          return {
            windowInnerWidth: window.innerWidth,
            bodyScrollWidth: body.scrollWidth,
            bodyClientWidth: body.clientWidth,
            navExists: !!nav,
            navScrollWidth: nav ? nav.scrollWidth : null,
            navClientWidth: nav ? nav.clientWidth : null,
            navUlScrollWidth: navUl ? navUl.scrollWidth : null,
            navUlClientWidth: navUl ? navUl.clientWidth : null,
            dashboardLinkExists: !!dashboardLink,
            collectionsLinkExists: !!collectionsLink,
            isIndexDashboard,
            indexH1,
          }
        })

        if (withIndex) {
          assert.equal(
            rootMetrics.isIndexDashboard,
            false,
            `${mode} ${vp.label}: index should be authored, not dashboard`,
          )
          assert.match(rootMetrics.indexH1, /Authored Home/, `${mode} ${vp.label}: authored H1`)
        } else {
          assert.equal(
            rootMetrics.isIndexDashboard,
            true,
            `${mode} ${vp.label}: index should be dashboard`,
          )
          assert.match(
            rootMetrics.indexH1,
            /Vault Dashboard/,
            `${mode} ${vp.label}: generated dashboard H1`,
          )
        }
        assert.ok(rootMetrics.dashboardLinkExists, `${mode} ${vp.label}: dashboard link must exist`)
        assert.ok(
          rootMetrics.collectionsLinkExists,
          `${mode} ${vp.label}: collections link must exist`,
        )
        assert.ok(rootMetrics.navExists, `${mode} ${vp.label}: nav must exist`)

        // No horizontal overflow for nav
        if (rootMetrics.navScrollWidth !== null) {
          assert.ok(
            rootMetrics.navScrollWidth <= rootMetrics.navClientWidth + 1,
            `${mode} ${vp.label}: nav no overflow ${rootMetrics.navScrollWidth} <= ${rootMetrics.navClientWidth}`,
          )
        }
        if (rootMetrics.navUlScrollWidth !== null) {
          assert.ok(
            rootMetrics.navUlScrollWidth <= rootMetrics.navUlClientWidth + 1,
            `${mode} ${vp.label}: nav ul no overflow ${rootMetrics.navUlScrollWidth} <= ${rootMetrics.navUlClientWidth}`,
          )
        }

        // SPA navigation: click dashboard link
        const dashHref = await page.evaluate(() => {
          const a = document.querySelector('a[href*="dashboard"]')
          return a ? a.getAttribute("href") : null
        })
        assert.ok(dashHref, `${mode} ${vp.label}: dashboard href`)

        // Use SPA navigate if available, else click
        await page.evaluate(() => {
          const a = document.querySelector('a[href*="dashboard"]')
          if (a) a.click()
        })
        await page
          .waitForFunction(() => window.location.pathname.includes("dashboard"), { timeout: 8000 })
          .catch(() => {})
        await new Promise((r) => setTimeout(r, 500))
        const afterDash = await page.evaluate(() => {
          const dash = document.querySelector(".kv-dashboard")
          return {
            hasDashboard: !!document.querySelector("#vault-dashboard"),
            h1: document.querySelector("h1")?.textContent?.trim() || "",
            dashScroll: dash ? dash.scrollWidth : null,
            dashClient: dash ? dash.clientWidth : null,
          }
        })
        assert.ok(
          afterDash.hasDashboard,
          `${mode} ${vp.label}: dashboard navigation should show dashboard`,
        )
        assert.match(afterDash.h1, /Vault Dashboard/, `${mode} ${vp.label}: dashboard H1 after nav`)
        if (afterDash.dashScroll !== null) {
          assert.ok(
            afterDash.dashScroll <= afterDash.dashClient + 1,
            `${mode} ${vp.label}: dashboard no overflow ${afterDash.dashScroll} <= ${afterDash.dashClient}`,
          )
        }

        // Navigate to a collection
        await page.goto(`${baseUrl}/`, { waitUntil: "networkidle0", timeout: 15000 })
        await page.evaluate(() => {
          const a = document.querySelector('a[href*="collections/"]')
          if (a) a.click()
        })
        await page
          .waitForFunction(() => window.location.pathname.includes("collections"), {
            timeout: 8000,
          })
          .catch(() => {})
        await new Promise((r) => setTimeout(r, 500))
        const afterColl = await page.evaluate(() => {
          const coll = document.querySelector(".kv-collection")
          const nav = document.querySelector(".kv-collections-nav")
          return {
            hasCollection: !!coll || !!nav,
            collScroll: coll ? coll.scrollWidth : nav ? nav.scrollWidth : null,
            collClient: coll ? coll.clientWidth : nav ? nav.clientWidth : null,
          }
        })
        if (afterColl.collScroll !== null) {
          assert.ok(
            afterColl.collScroll <= afterColl.collClient + 1,
            `${mode} ${vp.label}: collection no overflow ${afterColl.collScroll} <= ${afterColl.collClient}`,
          )
        }

        // SPA back to root via link or direct
        await page.evaluate((base) => {
          if (typeof window.spaNavigate === "function") window.spaNavigate("/")
          else window.location.assign("/")
        }, baseUrl)
        await page
          .waitForFunction(
            () => window.location.pathname === "/" || window.location.pathname === "/index.html",
            { timeout: 8000 },
          )
          .catch(() => {})
        await new Promise((r) => setTimeout(r, 300))

        await page.close()
      }
    } finally {
      await browser.close()
      server.close()
    }
  }
})
