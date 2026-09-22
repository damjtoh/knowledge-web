/**
 * Shared reader static production contract.
 *
 * Critical path for item 01: stage the real Shared vault through the
 * Publication Manifest authority, emit a serverless static export with the
 * headless Fumadocs content source, and inspect the output.
 *
 * - C3: static export builds every staged page (amended: 55 selected
 *   Markdown + synthetic landing = 56 pages).
 * - C4: the direct Travel note renders its authored title and body.
 * - C5: real tables, task lists, external links, external images, and inline
 *   code render through the maintained pipeline (code blocks have no real
 *   instance in the corpus; the synthetic pipeline test below covers them).
 * - C6: non-Markdown staged files never become pages.
 * - C7: generated Shared title and canonical hostname appear in metadata.
 * - C8: no unselected sentinel, vault path, or private build path in output.
 * - C9: staged content, generated modules, and static output stay untracked.
 * - C10: Quartz and its rollback build stay available and unchanged.
 *
 * The real-corpus test needs SHARED_KB_ROOT (path to the Shared vault
 * checkout); it skips with notice when absent. The synthetic pipeline test
 * is self-contained and always runs.
 *
 * Run with:
 *   SHARED_KB_ROOT=/path/to/shared-vault node --test tests/shared-reader-static.test.mjs
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shared-reader-${prefix}-`))
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

function listFilesRecursive(dir, relative = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...listFilesRecursive(path.join(dir, entry.name), rel))
    else if (entry.isFile()) files.push(rel)
  }
  return files.sort()
}

/** Staged Markdown path -> expected static-export HTML path (posix). */
function expectedHtmlForStagedMarkdown(rel) {
  const posix = rel.split(path.sep).join("/")
  if (/^index\.md$/i.test(path.posix.basename(posix))) {
    const dir = path.posix.dirname(posix)
    return dir === "." ? "index.html" : `${dir}.html`
  }
  return `${posix.replace(/\.md$/i, "")}.html`
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
  await execFileAsync("npm", ["run", "build"], {
    cwd: READER_ROOT,
    timeout: 600000,
    env: {
      ...process.env,
      SHARED_CONTENT_DIR: contentDir,
      SHARED_IDENTITY_FILE: identityFile,
    },
  })
}

function readOut(outDir, rel) {
  return fs.readFileSync(path.join(outDir, rel), "utf8")
}

/** Assert a private path or sentinel appears in no emitted file. */
function assertAbsentEverywhere(outDir, needle, label) {
  const hits = []
  for (const rel of listFilesRecursive(outDir)) {
    const abs = path.join(outDir, rel)
    const buffer = fs.readFileSync(abs)
    if (buffer.includes(needle)) hits.push(rel)
  }
  assert.deepEqual(
    hits,
    [],
    `${label} must appear in no emitted file (found in: ${hits.join(", ")})`,
  )
}

function resolveSharedKbRoot() {
  const configured = process.env.SHARED_KB_ROOT
  if (!configured) return null
  const resolved = path.resolve(configured)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null
  return resolved
}

test("real Shared corpus builds a complete static export with a readable Travel note", async (t) => {
  const kbRoot = resolveSharedKbRoot()
  if (!kbRoot) {
    t.skip("SHARED_KB_ROOT is not set to a Shared vault checkout; skipping real-corpus build")
    return
  }
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )

  const work = tmpdir("corpus")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outDir = path.join(READER_ROOT, "out")

  await stageKb(kbRoot, contentDir, identityFile)

  const stagedMarkdown = listFilesRecursive(contentDir).filter((rel) => /\.md$/i.test(rel))
  assert.ok(
    fs.existsSync(path.join(contentDir, "index.md")),
    "staged tree carries the synthetic landing page",
  )
  // Amended C3: the live manifest selects 55 Markdown files; staging adds
  // the synthetic landing page, so the reader input holds 56 pages.
  assert.equal(
    stagedMarkdown.length,
    56,
    `expected 55 selected Markdown + 1 synthetic landing page (got ${stagedMarkdown.length}); ` +
      `if the manifest changed, amend C3 rather than weakening this check`,
  )

  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)

  // C3/C6: every staged Markdown file has exactly one emitted page, and no
  // non-Markdown staged file became a page.
  const expectedPages = stagedMarkdown.map(expectedHtmlForStagedMarkdown).sort()
  for (const rel of expectedPages) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `staged page must be emitted: ${rel}`)
  }
  const emittedContentPages = listFilesRecursive(outDir)
    .filter((rel) => rel.endsWith(".html") && !rel.startsWith("_next"))
    .filter((rel) => rel !== "404.html" && rel !== "_not-found.html")
    .sort()
  assert.deepEqual(
    emittedContentPages,
    expectedPages,
    "emitted pages match staged Markdown exactly",
  )

  // C4: the direct Travel note renders its authored title and body.
  const note = readOut(outDir, "travel/upcoming/terradets-2026.html")
  assert.match(note, /<title>Terradets \| Shared Vault<\/title>/, "note document title")
  assert.match(note, /<h1[^>]*>Terradets<\/h1>/, "note authored H1")
  assert.match(note, /Hotel Terradets/, "note body text")
  assert.match(note, /<table[\s>]/, "note tables")
  assert.match(note, /<a href="https:\/\/[^"]+"/, "note external links")

  // C5: real corpus elements render through the maintained pipeline.
  const porto = readOut(outDir, "travel/past/porto-2026/itinerary.html")
  assert.match(porto, /type="checkbox"/, "real task lists render checkboxes")
  const sardigna = readOut(outDir, "travel/past/sardigna/inbox.html")
  assert.match(sardigna, /<img[^>]+src="https?:\/\/[^"]+"/, "real external images stay usable")
  const postmortem = readOut(outDir, "travel/past/porto-2026/postmortem.html")
  assert.match(
    postmortem,
    /<code>\[\[travel-style\]\]<\/code>/,
    "wikilink-like text inside inline code stays literal",
  )
  const travel = readOut(outDir, "travel.html")
  assert.match(
    travel,
    /\[\[Japan\]\]/,
    "body wikilinks render as authored text (item 02 resolves them)",
  )

  // C7: generated Shared identity appears in document metadata.
  const landing = readOut(outDir, "index.html")
  assert.match(landing, /<title>Shared Vault<\/title>/, "landing document title")
  assert.match(landing, /Shared Vault/, "landing body")
  for (const [label, html] of [
    ["landing", landing],
    ["travel note", note],
  ]) {
    assert.match(html, /shared\.dami\.dev/, `${label} metadata carries the canonical hostname`)
  }
  assert.match(
    note,
    /rel="canonical" href="https:\/\/shared\.dami\.dev\/travel\/upcoming\/terradets-2026"/,
    "note canonical URL",
  )

  // C8: bounded output safety inspection.
  assertAbsentEverywhere(outDir, "Tolaria Vault", "unselected AGENTS.md sentinel")
  assertAbsentEverywhere(outDir, "_list_properties_display", "unselected types/ sentinel")
  assertAbsentEverywhere(outDir, fs.realpathSync(kbRoot), "original vault path")
  assertAbsentEverywhere(outDir, fs.realpathSync(work), "private staging path")
  assertAbsentEverywhere(outDir, fs.realpathSync(PUBLISHER_ROOT), "private publisher checkout path")

  // C9: staged content, generated modules, and static output stay untracked.
  const porcelain = (
    await execFileAsync("git", ["status", "--porcelain"], { cwd: PUBLISHER_ROOT })
  ).stdout
    .split("\n")
    .filter(Boolean)
  const generated = porcelain.filter((line) =>
    /^(?:\?\?|..) (content\/|site-identity\.json|reader\/\.source\/|reader\/\.next\/|reader\/out\/)/.test(
      line,
    ),
  )
  assert.deepEqual(
    generated,
    [],
    `generated content must stay untracked (got: ${generated.join("; ")})`,
  )
  for (const ignored of ["reader/.source", "reader/.next", "reader/out"]) {
    const check = await execFileAsync("git", ["check-ignore", ignored], { cwd: PUBLISHER_ROOT })
    assert.match(
      check.stdout,
      new RegExp(ignored.replace(/\./g, "\\.")),
      `${ignored} is git-ignored`,
    )
  }

  // C10: Quartz and its rollback build stay available and unchanged.
  const quartzTouched = porcelain.filter((line) =>
    / (quartz\/|plugins\/|quartz\.config\.yaml|quartz\.lock\.json|nginx\.conf|package\.json|package-lock\.json)$/.test(
      line.trim(),
    ),
  )
  assert.deepEqual(
    quartzTouched,
    [],
    `Quartz machinery must be unchanged (got: ${quartzTouched.join("; ")})`,
  )
  assert.ok(fs.existsSync(path.join(PUBLISHER_ROOT, "quartz", "bootstrap-cli.mjs")))
})

test("non-Markdown staged files are excluded while code blocks and titles render", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  // Synthetic vault: the selected Shared corpus has no fenced code blocks
  // and no attachments, so this focused fixture proves the identical
  // maintained pipeline renders code blocks and excludes non-Markdown files.
  const kb = tmpdir("kb-synthetic")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.writeFileSync(
    path.join(kb, "notes", "guide.md"),
    [
      "---",
      'title: "Guide Title"',
      "---",
      "",
      "# Ignored H1",
      "",
      "Body with a table:",
      "",
      "| A | B |",
      "|---|---|",
      "| 1 | 2 |",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "```js",
      "const alias = '[[Guide Title]]';",
      "```",
      "",
      "See https://example.com for details.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(path.join(kb, "notes", "plain.md"), "# Plain H1\n\nJust a body.\n")
  fs.writeFileSync(
    path.join(kb, "notes", "untitled.md"),
    ["---", 'title: ""', "---", "", "No heading here, only body text.", ""].join("\n"),
  )
  fs.writeFileSync(path.join(kb, "notes", "photo.png"), "not-a-real-png")
  fs.writeFileSync(path.join(kb, "notes", "doc.pdf"), "not-a-real-pdf")
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    [
      "title: Fixture Garden",
      "canonicalHostname: fixture.example.com",
      "select:",
      "  - notes",
      "",
    ].join("\n"),
  )

  const work = tmpdir("synthetic")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outDir = path.join(READER_ROOT, "out")
  await stageKb(kb, contentDir, identityFile)
  assert.ok(fs.existsSync(path.join(contentDir, "notes", "photo.png")), "attachment is staged")

  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)

  const guide = readOut(outDir, "notes/guide.html")
  assert.match(
    guide,
    /<title>Guide Title \| Fixture Garden<\/title>/,
    "explicit frontmatter title wins",
  )
  assert.match(guide, /<pre[^>]*><code/, "fenced code blocks render")
  assert.match(
    guide,
    /<code[^>]*>[\s\S]*\[\[Guide Title\]\][\s\S]*<\/code>/,
    "wikilink-like text inside code blocks stays literal",
  )
  assert.match(guide, /<table[\s>]/, "tables render")
  assert.match(guide, /type="checkbox"/, "task lists render")
  assert.match(guide, /<a href="https:\/\/example\.com"/, "external links render")

  const plain = readOut(outDir, "notes/plain.html")
  assert.match(plain, /<title>Plain H1 \| Fixture Garden<\/title>/, "first H1 supplies the title")

  const untitled = readOut(outDir, "notes/untitled.html")
  assert.match(
    untitled,
    /<title>notes\/untitled \| Fixture Garden<\/title>/,
    "title falls back to the route when no title exists",
  )

  // C6: attachments are staged content but never become pages.
  for (const missing of ["notes/photo.html", "notes/doc.html", "notes/doc.pdf.html"]) {
    assert.ok(!fs.existsSync(path.join(outDir, missing)), `${missing} must not be emitted`)
  }
  const strayBinaries = listFilesRecursive(outDir).filter((rel) => /\.(png|pdf)$/i.test(rel))
  assert.deepEqual(strayBinaries, [], "no staged binary is emitted as a page asset")
})
