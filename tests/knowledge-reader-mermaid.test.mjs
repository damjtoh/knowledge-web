/**
 * Authored Mermaid fences through the real reader Markdown pipeline.
 *
 * Focused seam: one temporary staged note is compiled by the reader's own
 * `source.config.ts` through the supported `fumadocs-mdx/node` loader and
 * rendered with the real `<Mermaid>` component, then asserted on the
 * rendered HTML. This is the public surface: a ```mermaid fence becomes one
 * named diagram figure whose pre-hydration fallback is the escaped diagram
 * source; a plain JS fence stays a normal highlighted code block; a nested
 * mermaid fence keeps its placement; authored angle brackets stay escaped
 * text, never markup.
 *
 * The client half (local on-demand SVG rendering, multiple diagrams, theme
 * changes, invalid-diagram recovery, no-JS source, phone containment, and
 * strict-security directive attempts) is proven in the integrated reader
 * suite over the shared synthetic export.
 *
 * Run with: pnpm test -- tests/knowledge-reader-mermaid.test.mjs
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")

const READER_ROOT = path.join(PUBLISHER_ROOT, "reader")

const CHILD_PROBE = path.join(PUBLISHER_ROOT, "tests", "fixtures", "mermaid-render-probe.mjs")

/** tsx is the repository test runner; the probe needs it for the .tsx import. */
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx")

const PROBE_NOTE = [
  "# Probe Note",
  "",
  "```mermaid",
  "flowchart LR",
  '  A["<not-a-tag>"] --> B[Soil]',
  "```",
  "",
  "```js",
  "const fence = 'unchanged'",
  "```",
  "",
  "> ```mermaid",
  "> flowchart LR",
  ">   X --> Y",
  "> ```",
  "",
].join("\n")

const tmpRoots = []

after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
  tmpRoots.length = 0
})

function writeProbeContent() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-reader-mermaid-"))

  tmpRoots.push(root)

  const contentDir = path.join(root, "content")

  fs.mkdirSync(contentDir, { recursive: true })

  const notePath = path.join(contentDir, "note.md")

  fs.writeFileSync(notePath, PROBE_NOTE)

  // The compiled note imports react/jsx-runtime; the temp tree stands in
  // for the reader package so Node resolves those imports without touching
  // the repository tree.
  fs.symlinkSync(path.join(READER_ROOT, "node_modules"), path.join(root, "node_modules"), "dir")

  return { contentDir, notePath, outDir: path.join(root, "mdx-source") }
}

function countOccurrences(hay, needle) {
  return hay.split(needle).length - 1
}

test("mermaid fences compile through the reader pipeline into escaped diagram figures", async () => {
  const { contentDir, notePath, outDir } = writeProbeContent()

  const { stdout } = await execFileAsync(
    process.execPath,
    ["--no-warnings", "--import", TSX_LOADER, CHILD_PROBE],
    {
      cwd: READER_ROOT,
      timeout: 120000,
      env: {
        ...process.env,
        READER_ROOT,
        READER_CONTENT_DIR: contentDir,
        MDX_OUT_DIR: outDir,
        DOC_PATH: notePath,
      },
    },
  )

  const rendered = JSON.parse(stdout)

  assert.equal(rendered.error, undefined, `Markdown pipeline render failed: ${rendered.error}`)

  const html = rendered.html

  assert.equal(
    countOccurrences(html, "data-mermaid-viewport"),
    2,
    "each authored mermaid fence becomes exactly one diagram figure",
  )
  assert.equal(
    countOccurrences(html, 'class="shiki'),
    1,
    "the plain JS fence stays exactly one highlighted code block",
  )
  assert.ok(!html.includes("<not-a-tag>"), "authored angle brackets stay encoded text, not markup")
  assert.ok(
    html.includes("&lt;not-a-tag&gt;"),
    "diagram source is escaped into the readable fallback",
  )
  assert.ok(html.includes("--&gt;"), "diagram arrows stay escaped text in the fallback")
  assert.match(
    html,
    /<blockquote>[\s\S]*data-mermaid[\s\S]*<\/blockquote>/,
    "a nested mermaid fence keeps its block placement",
  )
  assert.ok(html.includes("X --&gt; Y"), "the nested diagram keeps its source fallback")

  const codeText = html.replace(/<[^>]*>/g, "")

  assert.ok(
    codeText.includes("const fence") && codeText.includes("unchanged"),
    "ordinary code fence content renders unchanged",
  )
})
