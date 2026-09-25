/**
 * Trustworthy Last edited time on notes (item 06).
 *
 * Focused seam: valid timezone-aware `updated_at` from staged Markdown
 * renders a subdued Last edited line with date, hour, minute, an explicit
 * zone, and a machine-readable `<time datetime>` on the published note
 * and authored folder pages. Missing, invalid, date-only, naive,
 * `created_at`-only, mtime, and build-time values never create a label;
 * virtual folders never guess one. The static text is deterministic and
 * offline-stable; it never describes sync or drift. Source Markdown stays
 * byte-for-byte.
 *
 * Run with: pnpm test -- tests/knowledge-reader-last-edited.test.mjs
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test, after } from "node:test"
import { parseUpdatedAt, updatedAtFromData } from "../reader/lib/last-edited.ts"

const execFileAsync = promisify(execFile)

const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")

const READER_ROOT = path.join(PUBLISHER_ROOT, "reader")

const STAGE_SCRIPT = path.join(PUBLISHER_ROOT, "scripts", "stage-content.mjs")

const tmpRoots = []

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-last-edited-${prefix}-`))
  tmpRoots.push(dir)

  return dir
}

function cleanReaderArtifacts() {
  for (const dir of [".source", ".next", "out"]) {
    fs.rmSync(path.join(READER_ROOT, dir), { recursive: true, force: true })
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

test("parseUpdatedAt accepts only timezone-aware instants with a stable zone display", () => {
  const offset = parseUpdatedAt("2026-09-20T14:30:00+02:00")
  assert.ok(offset, "offset-aware value parses")
  assert.equal(offset.display, "2026-09-20 14:30 UTC+02:00")
  assert.equal(offset.isoDatetime, "2026-09-20T12:30:00.000Z")

  const utc = parseUpdatedAt("2026-08-27T05:49:53.387Z")
  assert.ok(utc, "Zulu value parses")
  assert.equal(utc.display, "2026-08-27 05:49 UTC")
  assert.equal(utc.isoDatetime, "2026-08-27T05:49:53.387Z")

  const neg = parseUpdatedAt("2026-09-06T08:15:04-05:00")
  assert.ok(neg, "negative offset parses")
  assert.equal(neg.display, "2026-09-06 08:15 UTC-05:00")
  assert.equal(neg.isoDatetime, "2026-09-06T13:15:04.000Z")

  const compact = parseUpdatedAt("2026-09-20T14:30:00+0200")
  assert.ok(compact, "compact offset parses")
  assert.equal(compact.display, "2026-09-20 14:30 UTC+02:00")

  const noSeconds = parseUpdatedAt("2026-09-20T14:30+02:00")
  assert.ok(noSeconds, "minute precision parses")
  assert.equal(noSeconds.display, "2026-09-20 14:30 UTC+02:00")

  const leap = parseUpdatedAt("2024-02-29T10:00:00Z")
  assert.ok(leap, "leap-day parses")
  assert.equal(leap.display, "2024-02-29 10:00 UTC")

  // A Date cannot prove the source included a time and timezone (a YAML
  // date-only value decodes to fake UTC midnight), so Dates never render.
  assert.equal(
    parseUpdatedAt(new Date("2026-09-20T12:30:00.000Z")),
    null,
    "rejects valid Date objects",
  )
  assert.equal(parseUpdatedAt(new Date("invalid")), null, "rejects invalid Date")

  for (const bad of [
    undefined,
    null,
    "",
    "   ",
    "not-a-date",
    "2026-09-20",
    "2026-09-20T14:30:00",
    "2026-09-20 14:30:00+02:00",
    "2026-13-01T00:00:00Z",
    "2026-09-20T25:00:00Z",
    "2026-02-30T10:00:00Z",
    "2026-02-29T10:00:00Z",
    "2026-04-31T10:00:00Z",
    "2026-09-20T14:30:00+15:00",
    "2026-09-20T14:30:00+02:60",
    1727265000000,
    true,
  ]) {
    // SAFETY: focused unit check passes non-domain values to prove rejection at runtime.
    assert.equal(parseUpdatedAt(bad), null, `rejects ${JSON.stringify(String(bad))}`)
  }

  // Deterministic: the same source renders the same wall time and zone,
  // never a viewer-local conversion.
  assert.equal(
    parseUpdatedAt("2026-09-20T14:30:00+02:00").display,
    "2026-09-20 14:30 UTC+02:00",
    "offset wall time is preserved, not converted to UTC",
  )

  // Only the named field is read; created_at never supplies a label.
  assert.equal(updatedAtFromData({ title: "Note" }), undefined)
  assert.equal(updatedAtFromData(null), undefined)
  assert.equal(updatedAtFromData(undefined), undefined)
  assert.equal(
    updatedAtFromData({ updated_at: "2026-09-20T14:30:00+02:00" }),
    "2026-09-20T14:30:00+02:00",
  )
})

/** Minimal synthetic Knowledge Base covering valid, absent, and invalid timestamps. */
function makeEditKb() {
  const kb = tmpdir("kb-edit")
  const originals = new Map()

  const put = (rel, content) => {
    writeFile(kb, rel, content)
    originals.set(rel, content)
  }

  put(
    "index.md",
    [
      "---",
      'title: "Edit Home"',
      "---",
      "",
      "# Edit Home",
      "",
      "Home without a timestamp.",
      "",
    ].join("\n"),
  )
  put(
    "notes/valid-offset.md",
    [
      "---",
      'title: "Valid Offset"',
      'updated_at: "2026-09-20T14:30:00+02:00"',
      "---",
      "",
      "# Valid Offset",
      "",
      "Note with a positive offset.",
      "",
    ].join("\n"),
  )
  put(
    "notes/valid-z.md",
    [
      "---",
      'title: "Valid Zulu"',
      'updated_at: "2026-08-27T05:49:53.387Z"',
      "---",
      "",
      "# Valid Zulu",
      "",
      "Note with a Zulu timestamp.",
      "",
    ].join("\n"),
  )
  put(
    "notes/valid-neg.md",
    [
      "---",
      'title: "Valid Negative"',
      'updated_at: "2026-09-06T08:15:04-05:00"',
      "---",
      "",
      "# Valid Negative",
      "",
      "Note with a negative offset.",
      "",
    ].join("\n"),
  )
  put("notes/missing.md", "# Missing Stamp\n\nNo frontmatter timestamp.\n")
  put(
    "notes/invalid.md",
    [
      "---",
      'title: "Invalid Stamp"',
      'updated_at: "not-a-date"',
      "---",
      "",
      "# Invalid Stamp",
      "",
    ].join("\n"),
  )
  put(
    "notes/date-only.md",
    ["---", 'title: "Date Only"', 'updated_at: "2026-09-20"', "---", "", "# Date Only", ""].join(
      "\n",
    ),
  )
  put(
    "notes/naive.md",
    [
      "---",
      'title: "Naive Time"',
      'updated_at: "2026-09-20T14:30:00"',
      "---",
      "",
      "# Naive Time",
      "",
    ].join("\n"),
  )
  put(
    "notes/unquoted-date.md",
    [
      "---",
      'title: "Unquoted Date"',
      "updated_at: 2026-09-25",
      "---",
      "",
      "# Unquoted Date",
      "",
    ].join("\n"),
  )
  put(
    "notes/feb-thirty.md",
    [
      "---",
      'title: "Feb Thirty"',
      'updated_at: "2026-02-30T10:00:00Z"',
      "---",
      "",
      "# Feb Thirty",
      "",
    ].join("\n"),
  )
  put(
    "notes/created-only.md",
    [
      "---",
      'title: "Created Only"',
      'created_at: "2026-08-06T16:54:38.100Z"',
      "---",
      "",
      "# Created Only",
      "",
    ].join("\n"),
  )
  put(
    "garden/index.md",
    [
      "---",
      'title: "Garden Plots"',
      'updated_at: "2026-09-18T09:15:00+01:00"',
      "---",
      "",
      "# Garden Plots",
      "",
      "Authored folder with its own timestamp.",
      "",
    ].join("\n"),
  )
  put("garden/note.md", "# Garden Note\n\nChild without a timestamp.\n")
  put("notes/nest/inner/leaf.md", "# Inner Leaf\n\nDeep nested note.\n")
  put(
    "publication.manifest.yaml",
    [
      "title: Edit Garden",
      "canonicalHostname: edit.example.com",
      "select:",
      "  - index.md",
      "  - notes",
      "  - garden",
      "navigation:",
      "  - notes",
      "  - garden",
      "",
    ].join("\n"),
  )

  return { kb, originals }
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

function lastEditedFromHtml(html) {
  const match = html.match(
    /<p class="reader-last-edited">Last edited <time date[Tt]ime="([^"]+)">([^<]+)<\/time><\/p>/,
  )

  if (!match) return null

  return { datetime: match[1], display: match[2] }
}

test("synthetic static export shows Last edited only for valid authored timestamps", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const { kb, originals } = makeEditKb()
  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outDir = path.join(READER_ROOT, "out")

  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile],
    { cwd: PUBLISHER_ROOT, timeout: 120000 },
  )

  // Source Markdown stays byte-for-byte: staged copies equal the originals.
  for (const [rel, content] of originals) {
    if (rel === "publication.manifest.yaml") continue
    assert.equal(
      fs.readFileSync(path.join(contentDir, rel), "utf8"),
      content,
      `staged copy preserves source: ${rel}`,
    )
  }

  cleanReaderArtifacts()
  await execFileAsync("pnpm", ["run", "build"], {
    cwd: READER_ROOT,
    timeout: 600000,
    env: {
      ...process.env,
      READER_CONTENT_DIR: contentDir,
      READER_SITE_METADATA_FILE: identityFile,
    },
  })

  const readOut = (rel) => fs.readFileSync(path.join(outDir, rel), "utf8")

  // Valid authored notes render date, hour, minute, zone, and machine time.
  const offset = lastEditedFromHtml(readOut("notes/valid-offset.html"))
  assert.ok(offset, "valid offset note renders Last edited")
  assert.equal(offset.display, "2026-09-20 14:30 UTC+02:00")
  assert.equal(offset.datetime, "2026-09-20T12:30:00.000Z")

  const zulu = lastEditedFromHtml(readOut("notes/valid-z.html"))
  assert.ok(zulu, "valid Zulu note renders Last edited")
  assert.equal(zulu.display, "2026-08-27 05:49 UTC")
  assert.equal(zulu.datetime, "2026-08-27T05:49:53.387Z")

  const neg = lastEditedFromHtml(readOut("notes/valid-neg.html"))
  assert.ok(neg, "valid negative offset renders Last edited")
  assert.equal(neg.display, "2026-09-06 08:15 UTC-05:00")
  assert.equal(neg.datetime, "2026-09-06T13:15:04.000Z")

  // Authored folder index owns its folder route and its timestamp.
  const garden = lastEditedFromHtml(readOut("garden.html"))
  assert.ok(garden, "authored folder renders its own Last edited")
  assert.equal(garden.display, "2026-09-18 09:15 UTC+01:00")
  assert.equal(garden.datetime, "2026-09-18T08:15:00.000Z")

  // Absent, invalid, date-only (quoted and unquoted), naive,
  // impossible-calendar, and created-only values never create a label.
  for (const rel of [
    "notes/missing.html",
    "notes/invalid.html",
    "notes/date-only.html",
    "notes/unquoted-date.html",
    "notes/feb-thirty.html",
    "notes/naive.html",
    "notes/created-only.html",
    "garden/note.html",
    "index.html",
  ]) {
    const html = readOut(rel)
    assert.equal(lastEditedFromHtml(html), null, `${rel} omits Last edited`)
    assert.ok(!html.includes("Last edited"), `${rel} shows no freshness claim`)
  }

  // Virtual folders never guess a label.
  for (const rel of ["notes.html", "notes/nest.html", "notes/nest/inner.html"]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `virtual page emitted: ${rel}`)
    const html = readOut(rel)
    assert.equal(lastEditedFromHtml(html), null, `${rel} omits a guessed label`)
  }

  // The label names an edit time only, never sync or drift.
  for (const rel of ["notes/valid-offset.html", "notes/valid-z.html", "garden.html"]) {
    const html = readOut(rel)
    assert.ok(!/synchron/i.test(html), `${rel} never implies sync`)
    assert.ok(!/drift/i.test(html), `${rel} never implies drift`)
    assert.ok(!/up to date/i.test(html), `${rel} never claims freshness`)
  }

  // The same source timestamp stays in the offline-saved static page: the
  // emitted HTML is what the Workbox precache stores, and it is listed.
  const offline = JSON.parse(readOut("offline.json"))

  for (const rel of ["notes/valid-offset.html", "notes/valid-z.html", "garden.html"]) {
    assert.ok(offline.urls.includes(`/${rel}`), `offline manifest covers ${rel}`)
    assert.ok(
      readOut(rel).includes("2026-"),
      `offline-saved page keeps its source timestamp: ${rel}`,
    )
  }

  // Browser regression on the static export: the line renders, the missing
  // page and virtual folder stay clean, and no hydration error appears.
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
  const errors = []
  let browser

  try {
    browser = await puppeteer.launch({
      executablePath: findChrome() || undefined,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
      ],
    })
    const page = await browser.newPage()
    page.on("pageerror", (error) => errors.push(String(error)))

    try {
      await page.setViewport({ width: 1280, height: 800 })
      await page.goto(`${baseUrl}/notes/valid-offset`, {
        waitUntil: "networkidle0",
        timeout: 15000,
      })

      const rendered = await page.evaluate(() => {
        const line = document.querySelector("p.reader-last-edited")
        const time = line?.querySelector("time")

        return {
          text: line?.textContent?.trim() || null,
          datetime: time?.getAttribute("datetime") || null,
          display: time?.textContent?.trim() || null,
        }
      })

      assert.ok(rendered.text?.startsWith("Last edited"), "browser shows Last edited")
      assert.equal(rendered.datetime, "2026-09-20T12:30:00.000Z")
      assert.equal(rendered.display, "2026-09-20 14:30 UTC+02:00")

      await page.goto(`${baseUrl}/notes/missing`, { waitUntil: "networkidle0", timeout: 15000 })
      assert.equal(
        await page.evaluate(() => document.querySelector("p.reader-last-edited")),
        null,
        "browser omits the label without a valid timestamp",
      )

      await page.goto(`${baseUrl}/notes`, { waitUntil: "networkidle0", timeout: 15000 })
      assert.equal(
        await page.evaluate(() => document.querySelector("p.reader-last-edited")),
        null,
        "browser omits a guessed virtual-folder label",
      )
    } finally {
      await page.close()
    }
  } finally {
    if (browser) await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }

  assert.deepEqual(errors, [], "no hydration or page errors on timestamp routes")
})
