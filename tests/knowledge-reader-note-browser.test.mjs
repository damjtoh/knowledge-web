/**
 * Knowledge reader direct-note production-browser check.
 *
 * Serves the static export through an nginx-style static server
 * (extensionless routes resolve via the `.html` fallback, as in nginx.conf)
 * and proves a derived note is readable in a production browser:
 * document title, H1, article body, tables, and canonical metadata.
 * A derived virtual folder route is also readable with its generic groups.
 *
 * The synthetic fixture always runs (no vault needed); expected routes and
 * titles derive from staged content and generated metadata. When
 * KNOWLEDGE_BASE_ROOT points at a vault checkout, the same generic check
 * runs against the real corpus.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-note-browser.test.mjs
 *   KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-note-browser.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-note-browser-${prefix}-`))
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

  for (const line of text.split("\n")) {
    const m = line.match(/^#\s+(.+?)\s*$/)

    if (m) return m[1].trim()
  }

  return fallback
}

/** Neutral synthetic vault with a rich note and a nested virtual folder. */
function makeNoteKb() {
  const kb = tmpdir("kb-note")
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
      "Neutral note garden.",
      "",
    ].join("\n"),
  )
  writeFile(kb, "garden/index.md", "# Garden Plots\n\nAuthored folder.\n")
  writeFile(
    kb,
    "notes/guide.md",
    [
      "# Field Guide",
      "",
      "Meadow body with substantial text for readability checks. " + "Meadow body. ".repeat(40),
      "",
      "| Day | Cost | Notes |",
      "|---|---|---|",
      "| One | 85 € | Long day |",
      "",
      "See [[Garden Plots]] for the area.",
      "",
      "Book via [Example](https://example.com/field-guide).",
      "",
    ].join("\n"),
  )
  writeFile(kb, "notes/plain.md", "# Plain Meadow\n\nJust a body.\n")
  writeFile(kb, "notes/nest/inner/leaf.md", "# Inner Leaf\n\nDeep nested note.\n")
  writeFile(kb, "standalone.md", "# Lone Pine\n\nStandalone file.\n")
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Note Garden",
      "canonicalHostname: note.example.com",
      "select:",
      "  - index.md",
      "  - garden",
      "  - notes",
      "  - standalone.md",
      "navigation:",
      "  - standalone.md",
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

function listStagedMarkdown(contentDir) {
  const out = []

  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(relPath)
    }
  }

  walk(contentDir, "")

  return out.sort()
}

/** Rich note: first staged file with a table; virtual folder: first dir with Markdown but no index. */
function deriveNoteTargets(contentDir) {
  let richRel = null

  for (const rel of listStagedMarkdown(contentDir)) {
    const text = fs.readFileSync(path.join(contentDir, rel), "utf8")

    if (/^\s*\|.*\|\s*$/m.test(text)) {
      richRel = rel
      break
    }
  }

  if (!richRel) richRel = listStagedMarkdown(contentDir).find((rel) => rel !== "index.md")
  const richRoute = routeForStagedMarkdown(richRel)

  const richTitle = stagedFileTitle(
    path.join(contentDir, richRel),
    path.posix.basename(richRel).replace(/\.md$/i, ""),
  )

  let virtualDir = null
  const dirs = new Set()

  for (const rel of listStagedMarkdown(contentDir)) {
    const parts = rel.split(path.sep).join("/").split("/").slice(0, -1)

    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join("/"))
  }

  for (const dir of [...dirs].sort()) {
    let hasIndex = false

    try {
      for (const entry of fs.readdirSync(path.join(contentDir, ...dir.split("/")))) {
        if (/^index\.md$/i.test(entry)) {
          hasIndex = true
          break
        }
      }
    } catch {
      continue
    }

    if (!hasIndex) {
      virtualDir = dir
      break
    }
  }

  const virtualRoute = virtualDir ? `/${virtualDir}` : "/"
  const virtualTitle = virtualDir ? humanizeSegment(virtualDir.split("/").pop()) : "Home"

  return { richRel, richRoute, richTitle, virtualDir, virtualRoute, virtualTitle }
}

async function stageAndBuild(kbRoot) {
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
  await execFileAsync("pnpm", ["run", "build"], {
    cwd: READER_ROOT,
    timeout: 600000,
    env: {
      ...process.env,
      READER_CONTENT_DIR: contentDir,
      READER_SITE_METADATA_FILE: identityFile,
    },
  })
  const metadata = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  const targets = deriveNoteTargets(contentDir)

  return { work, contentDir, metadata, targets, outDir: path.join(READER_ROOT, "out") }
}

async function withBrowser(outDir, fn) {
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
    await fn(baseUrl, browser)
  } finally {
    await browser.close()
    server.close()
  }
}

async function checkDirectNote(
  baseUrl,
  browser,
  { route, title, siteTitle, hostname, bodyMin = 200 },
) {
  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0", timeout: 15000 })

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

    assert.ok(note.title.includes(title), `document title carries the note title ${title}`)
    assert.ok(note.title.includes(siteTitle), "document title carries the generated site title")
    assert.equal(note.mainCount, 1, "one main landmark")
    assert.ok(note.articleExists, "readable article element")
    assert.ok(note.h1Texts.includes(title), `authored H1 rendered (got: ${note.h1Texts.join("|")})`)
    assert.ok(
      note.bodyLength > bodyMin,
      `article body is substantial (got ${note.bodyLength} chars)`,
    )
    assert.ok(note.tableCount >= 1, `tables rendered (got ${note.tableCount})`)
    assert.ok(note.hasExternalLink, "external links rendered")
    assert.equal(note.canonicalHref, `https://${hostname}${route}`, "canonical hostname metadata")
    await page.reload({ waitUntil: "networkidle0", timeout: 15000 })

    const afterReload = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(afterReload, title, "refresh keeps the direct note")
  } finally {
    await page.close()
  }
}

async function checkVirtualFolder(baseUrl, browser, { route, title }) {
  if (route === "/") return
  const page = await browser.newPage()

  try {
    await page.setViewport({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle0", timeout: 15000 })

    const folder = await page.evaluate(() => ({
      h1: document.querySelector("article h1")?.textContent?.trim() || "",
      groups: Array.from(document.querySelectorAll("article h2")).map((h) => h.textContent?.trim()),
    }))

    assert.equal(folder.h1, title, `virtual folder title ${title}`)
    assert.ok(
      folder.groups.includes("Notes") || folder.groups.includes("Folders"),
      "virtual folder uses generic groups",
    )
  } finally {
    await page.close()
  }
}

test("synthetic direct note and virtual folder are readable in a production browser", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const kb = makeNoteKb()
  const built = await stageAndBuild(kb)
  assert.ok(
    fs.existsSync(path.join(built.outDir, `${built.targets.richRoute.replace(/^\//, "")}.html`)),
  )
  await withBrowser(built.outDir, async (baseUrl, browser) => {
    await checkDirectNote(baseUrl, browser, {
      route: built.targets.richRoute,
      title: built.targets.richTitle,
      siteTitle: built.metadata.title,
      hostname: built.metadata.canonicalHostname,
    })
    await checkVirtualFolder(baseUrl, browser, {
      route: built.targets.virtualRoute,
      title: built.targets.virtualTitle,
    })
  })
})

test("generic real direct note is readable in a production browser", async (t) => {
  const kbRoot = process.env.KNOWLEDGE_BASE_ROOT

  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip("KNOWLEDGE_BASE_ROOT is not set to a vault checkout; skipping browser check")

    return
  }

  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const built = await stageAndBuild(path.resolve(kbRoot))
  assert.ok(
    fs.existsSync(path.join(built.outDir, `${built.targets.richRoute.replace(/^\//, "")}.html`)),
  )
  await withBrowser(built.outDir, async (baseUrl, browser) => {
    await checkDirectNote(baseUrl, browser, {
      route: built.targets.richRoute,
      title: built.targets.richTitle,
      siteTitle: built.metadata.title,
      hostname: built.metadata.canonicalHostname,
      bodyMin: 50,
    })
  })
})
