/**
 * Focused tests for the wikilink syntax spike.
 *
 * Proves the maintained @flowershow/remark-wiki-link plugin handles the real
 * required body forms through the spike pipeline. No test parses wikilink
 * syntax itself; assertions read plugin-rendered HTML only.
 *
 * Run with: npm run test:contract
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test, after } from "node:test"
import {
  buildProcessor,
  countWikilinks,
  processStagedContent,
  routeForSourcePath,
} from "../scripts/wikilink-spike.mjs"

const execFileAsync = promisify(execFile)

const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")

const SPIKE_SCRIPT = path.join(PUBLISHER_ROOT, "scripts", "wikilink-spike.mjs")

const tmpRoots = []

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wl-spike-${prefix}-`))
  tmpRoots.push(dir)

  return dir
}

function writeStaged(contentDir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(contentDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }
}

async function renderHtml(files, permalinks, markdown) {
  const processor = buildProcessor(files, permalinks)
  const hast = await processor.run(processor.parse(markdown))

  return { hast }
}

after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

test("all four required body forms become internal routes", async () => {
  const files = ["beta.md"]
  const permalinks = { "beta.md": routeForSourcePath("beta.md") }

  const cases = [
    ["[[beta]]", 'href="/beta"', ">beta</a>"],
    ["[[beta|Shown Alias]]", 'href="/beta"', ">Shown Alias</a>"],
    ["[[beta#my-heading]]", 'href="/beta#my-heading"', null],
    ["[[beta#my-heading|Shown]]", 'href="/beta#my-heading"', ">Shown</a>"],
  ]

  for (const [markdown, href, text] of cases) {
    const { hast } = await renderHtml(files, permalinks, markdown)
    const counts = countWikilinks(hast)
    assert.equal(counts.resolved, 1, `${markdown} resolves`)
    assert.equal(counts.unresolved, 0, `${markdown} has no unresolved link`)
    const { unified } = await import("unified")
    const { default: rehypeStringify } = await import("rehype-stringify")
    const html = String(unified().use(rehypeStringify).stringify(hast))
    assert.ok(html.includes(href), `${markdown} links to the internal route`)
    assert.ok(html.includes('class="internal'), `${markdown} carries the plugin class`)

    if (text) assert.ok(html.includes(text), `${markdown} renders its label`)
  }
})

test("shortest-form target resolves to the staged route", async () => {
  const root = tmpdir("shortest")
  const contentDir = path.join(root, "content")
  writeStaged(contentDir, {
    "notes/beta.md": "# Beta\n",
    "start.md": "# Start\n\nSee [[beta]].\n",
  })
  const result = await processStagedContent(contentDir)
  assert.equal(result.files, 2)
  const start = result.pages.find((page) => page.sourcePath === "start.md")
  assert.equal(start.route, "/start")
  assert.equal(start.resolved, 1)
  assert.ok(start.html.includes('href="/notes/beta"'), "shortest form maps to the staged route")
})

test("missing targets use the plugin new class and never fail", async () => {
  const root = tmpdir("missing")
  const contentDir = path.join(root, "content")
  writeStaged(contentDir, { "start.md": "# Start\n\nSee [[no-such-page]].\n" })
  const result = await processStagedContent(contentDir)
  assert.equal(result.files, 1)
  assert.equal(result.resolved, 0)
  assert.equal(result.unresolved, 1)
  const start = result.pages[0]
  assert.ok(start.html.includes("internal new"), "missing target carries the new class")
  assert.ok(start.html.includes("no-such-page"), "missing target stays visible")
})

test("code spans and fenced code stay literal", async () => {
  const files = ["beta.md"]
  const permalinks = { "beta.md": "/beta" }

  const { hast } = await renderHtml(
    files,
    permalinks,
    "Inline `[[beta]]` and:\n\n```md\n[[beta]]\n```\n",
  )

  const counts = countWikilinks(hast)
  assert.equal(counts.resolved, 0, "code never produces links")
  assert.equal(counts.unresolved, 0)
  const { unified } = await import("unified")
  const { default: rehypeStringify } = await import("rehype-stringify")
  const html = String(unified().use(rehypeStringify).stringify(hast))
  assert.ok(html.includes("<code>[[beta]]</code>"), "inline code stays literal")
  assert.ok(html.includes("[[beta]]"), "fenced code stays literal")
})

test("the command rejects vault inputs and staged symlinks", async () => {
  const root = tmpdir("boundary")
  const contentDir = path.join(root, "content")
  writeStaged(contentDir, { "a.md": "# A\n" })
  let vaultRejected = false

  try {
    await execFileAsync(process.execPath, [
      SPIKE_SCRIPT,
      "--kb-root",
      root,
      "--content-dir",
      contentDir,
    ])
  } catch (error) {
    vaultRejected = true
    assert.match(error.stderr, /reads only staged content/)
    assert.equal(error.code, 2)
  }

  assert.ok(vaultRejected, "vault input must be rejected")
  fs.symlinkSync(path.join(contentDir, "a.md"), path.join(contentDir, "link.md"))
  let symlinkRejected = false

  try {
    await execFileAsync(process.execPath, [SPIKE_SCRIPT, "--content-dir", contentDir])
  } catch (error) {
    symlinkRejected = true
    assert.match(error.stderr, /symlink rejected/)
    assert.equal(error.code, 2)
  }

  assert.ok(symlinkRejected, "staged symlinks must be rejected")
})

test("the command processes every staged Markdown file", async () => {
  const root = tmpdir("sweep")
  const contentDir = path.join(root, "content")
  writeStaged(contentDir, {
    "index.md": "# Home\n\nSee [[notes/a]].\n",
    "notes/a.md": "# A\n",
    "notes/b.md": "# B\n\nSee [[a]].\n",
  })

  const { stdout } = await execFileAsync(process.execPath, [
    SPIKE_SCRIPT,
    "--content-dir",
    contentDir,
  ])

  assert.match(stdout, /3 staged Markdown files processed/)
})
