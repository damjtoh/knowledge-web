/**
 * Knowledge reader static production contract.
 *
 * Neutral synthetic fixture (no vault required) plus an optional generic
 * real-corpus entry. The fixture covers an authored root, reordered explicit
 * navigation, indexed and virtual folders, a large flat directory, a nested
 * virtual folder, a standalone Markdown root, an asset-only selection, and
 * the full Markdown syntax surface (wikilinks, aliases, fragments, tables,
 * tasks, external links/images, inline and fenced code, long titles, wide
 * content). Expected authored and virtual routes derive from staged content
 * and generated metadata, never from fixed subject routes.
 *
 * Retained checks: page-set equality (authored plus virtual), output safety,
 * canonical metadata, static runtime inspection, and Quartz rollback.
 *
 * The real-corpus entry uses only KNOWLEDGE_BASE_ROOT; the reader receives
 * only staged content and generated metadata.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-static.test.mjs
 *   KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-static.test.mjs
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-reader-${prefix}-`))
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

function routeForStagedMarkdown(rel) {
  const posix = rel.split(path.sep).join("/")

  if (/^index\.md$/i.test(posix)) return "/"
  let route = `/${posix.replace(/\.md$/i, "")}`

  if (route.endsWith("/index")) route = route.slice(0, -"/index".length)

  return route || "/"
}

function humanizeSegment(seg) {
  const spaced = seg.replace(/[-_]+/g, " ").trim()

  if (spaced === "") return seg

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function writeFile(root, rel, content) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/**
 * One neutral synthetic Knowledge Base.
 *
 * - Authored root index.md (Garden Home).
 * - select order differs from explicit navigation order.
 * - garden has an authored index; notes and orchard are virtual folders.
 * - orchard is a large flat directory (12 notes).
 * - notes/nest/inner is a nested virtual folder.
 * - standalone.md is a standalone Markdown root.
 * - assets holds only binaries (staged, never paged, never navigated).
 * - guide.md covers tables, tasks, external links/images, inline and fenced
 *   code, resolved and unresolved wikilinks, aliases, and fragments.
 * - A long-title note and wide table/code/image cover wrapping probes.
 * - Search probes: a published top-level page omitted from `navigation`
 *   (hidden from the tree but searchable), a title/body ranking pair with
 *   shared wording, and tokens that appear only in fenced code or only in
 *   frontmatter (never searchable).
 */
const LONG_TITLE =
  "An extremely long packing checklist title that keeps going SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious"

const LONG_SLUG = "long-packing-checklist-title-that-keeps-going-for-wrapping-probes"

const UNSELECTED_SENTINEL = "FIXTURE_UNSELECTED_SENTINEL_7Q2X"

/** Appears only inside a fenced code block; must never become searchable. */
const CODE_ONLY_TOKEN = "CODE_ONLY_SENTINEL_K7Q2"

/** Appears only as a frontmatter value; must never become searchable. */
const FRONTMATTER_ONLY_TOKEN = "FRONTMATTER_ONLY_SENTINEL_M3P8"

function makeNeutralKb() {
  const kb = tmpdir("kb-neutral")
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
      "Welcome to the neutral fixture garden.",
      "",
    ].join("\n"),
  )
  writeFile(
    kb,
    "garden/index.md",
    "# Garden Plots\n\nCultivated beds with an authored introduction.\n\n[Alpha Bed](alpha.md)\n",
  )
  writeFile(
    kb,
    "garden/alpha.md",
    "# Alpha Bed\n\nFirst bed. See [[Garden Plots]] for the area.\n\n[Garden home](index.md)\n\n[Meadow details](../notes/plain.md#details)\n",
  )
  writeFile(
    kb,
    "garden/beta.md",
    "# Beta Bed\n\nSecond bed. See [[Alpha Bed]] for the first bed.\n",
  )
  writeFile(
    kb,
    "notes/guide.md",
    [
      "---",
      'title: "Field Guide"',
      "---",
      "",
      "# Ignored H1",
      "",
      "Body with a wide table:",
      "",
      "| Day | Morning | Midday | Afternoon | Evening | Night | Cost | Notes |",
      "|---|---|---|---|---|---|---|---|",
      "| One | Kayak on the lake | Lunch in town | Trek to the viewpoint | Dinner | Sleep | 85 € | Long day |",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "```js",
      "const alias = '[[Field Guide]]';",
      `const codeOnly = "${CODE_ONLY_TOKEN}";`,
      "const veryLongLineForOverflowChecks = 'abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz-1234567890-1234567890';",
      "```",
      "",
      "See [[Plain Meadow]] for the title link.",
      "",
      "See [[plain]] for the filename link.",
      "",
      "See [[notes/plain]] for the path link.",
      "",
      "See [[Plain Meadow|custom label]] for the alias link.",
      "",
      "See [[Plain Meadow#Details]] for the heading link.",
      "",
      "See [[Plain Meadow#Details|section label]] for the heading alias link.",
      "",
      "See [[Garden Plots]] for the indexed folder.",
      "",
      "See [[Lone Pine]] for the standalone file.",
      "",
      "See [[Inner Leaf]] for the nested virtual note.",
      "",
      "See [[Missing Page]] for the unresolved link.",
      "",
      "Inline `[[Plain Meadow]]` stays literal.",
      "",
      "Inline `[[Garden Plots]]` stays literal.",
      "",
      "See https://example.com/field-guide for details.",
      "",
      "![Meadow view](https://example.com/photos/very-wide-panoramic-meadow-view.jpg)",
      "",
    ].join("\n"),
  )
  writeFile(
    kb,
    "notes/plain.md",
    "# Plain Meadow\n\nJust a body.\n\n## Details\n\nSection content.\n",
  )
  writeFile(
    kb,
    "notes/nest/inner/leaf.md",
    "# Inner Leaf\n\nDeep nested note in a virtual folder chain.\n",
  )
  writeFile(kb, `notes/${LONG_SLUG}.md`, `# ${LONG_TITLE}\n\nPack light.\n`)

  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, "0")
    writeFile(kb, `orchard/note-${n}.md`, `# Orchard Note ${n}\n\nFlat orchard note ${n}.\n`)
  }

  writeFile(kb, "standalone.md", "# Lone Pine\n\nStandalone selected file at the root.\n")
  writeFile(
    kb,
    "field-notes.md",
    [
      "---",
      'title: "Sunlit Atrium Log"',
      `internalRef: "${FRONTMATTER_ONLY_TOKEN}"`,
      "---",
      "",
      "# Sunlit Atrium Log",
      "",
      "The sunlit atrium gathers morning light. Gardeners rest beside the stone basin and record quiet notes.",
      "",
    ].join("\n"),
  )
  writeFile(
    kb,
    "notes/harbor-ledger.md",
    [
      "---",
      'title: "Harbor Ledger"',
      "---",
      "",
      "# Harbor Ledger",
      "",
      "A quiet ledger kept near the harbor wall. Entries record rope, tide, and lamp oil.",
      "",
    ].join("\n"),
  )
  writeFile(
    kb,
    "notes/inland-journal.md",
    [
      "---",
      'title: "Inland Journal"',
      "---",
      "",
      "# Inland Journal",
      "",
      "Traders compare the inland journal against the Harbor Ledger for the season.",
      "",
    ].join("\n"),
  )
  writeFile(kb, "assets/photo.png", "not-a-real-png")
  writeFile(kb, "assets/doc.pdf", "not-a-real-pdf")
  writeFile(kb, "unselected.md", `# Unselected\n\n${UNSELECTED_SENTINEL} must never appear.\n`)
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Fixture Garden",
      "canonicalHostname: fixture.example.com",
      "select:",
      "  - index.md",
      "  - garden",
      "  - notes",
      "  - orchard",
      "  - standalone.md",
      "  - field-notes.md",
      "  - assets",
      "navigation:",
      "  - standalone.md",
      "  - orchard",
      "  - notes",
      "  - garden",
      "",
    ].join("\n"),
  )

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

function readMetadata(identityFile) {
  return JSON.parse(fs.readFileSync(identityFile, "utf8"))
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

async function serveOut(dir) {
  const server = createStaticServer(dir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()

  return { server, baseUrl: `http://${addr.address}:${addr.port}` }
}

/** Search excerpts highlight matches with <mark>; strip it for text checks. */
function stripSearchMarks(value) {
  return String(value ?? "").replace(/<\/?mark>/g, "")
}

/**
 * Virtual folder HTML paths at or below generated directory navigation
 * roots (dirs with Markdown, no index). Ancestors above a configured nested
 * root never derive folders; Markdown roots create none.
 */
function deriveVirtualHtmls(contentDir, navigationRoots = []) {
  const dirRoots = navigationRoots
    .filter((entry) => entry && entry.kind === "directory" && typeof entry.path === "string")
    .map((entry) => entry.path.split(path.sep).join("/"))

  const isEligible = (dir) => dirRoots.some((root) => dir === root || dir.startsWith(`${root}/`))
  const staged = listFilesRecursive(contentDir)
  const markdown = staged.filter((rel) => /\.md$/i.test(rel))
  const dirs = new Set()

  for (const rel of markdown) {
    const posix = rel.split(path.sep).join("/")
    const parts = posix.split("/").slice(0, -1)

    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join("/")

      if (isEligible(dir)) dirs.add(dir)
    }
  }

  const virtual = []

  for (const dir of dirs) {
    const abs = path.join(contentDir, ...dir.split("/"))
    let hasIndex = false

    try {
      for (const entry of fs.readdirSync(abs)) {
        if (/^index\.md$/i.test(entry)) {
          hasIndex = true
          break
        }
      }
    } catch {
      continue
    }

    if (!hasIndex) virtual.push(`${dir}.html`)
  }

  return virtual.sort()
}

function resolveKnowledgeBaseRoot() {
  const configured = process.env.KNOWLEDGE_BASE_ROOT

  if (!configured) return null
  const resolved = path.resolve(configured)

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return null

  return resolved
}

test("neutral synthetic corpus builds a complete static export with authored and virtual routes", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const kb = makeNeutralKb()
  const work = tmpdir("synthetic")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outDir = path.join(READER_ROOT, "out")
  await stageKb(kb, contentDir, identityFile)

  // Authored root is staged; the asset-only selection is staged but filtered.
  assert.ok(
    fs.existsSync(path.join(contentDir, "index.md")),
    "staged tree carries the authored root",
  )
  assert.ok(
    fs.existsSync(path.join(contentDir, "assets", "photo.png")),
    "asset-only selection is staged",
  )

  // Navigation derives from explicit metadata order, not select order.
  const metadata = readMetadata(identityFile)
  assert.equal(metadata.title, "Fixture Garden")
  assert.equal(metadata.canonicalHostname, "fixture.example.com")
  assert.deepEqual(
    metadata.navigation,
    [
      { path: "standalone.md", kind: "markdown" },
      { path: "orchard", kind: "directory" },
      { path: "notes", kind: "directory" },
      { path: "garden", kind: "directory" },
    ],
    "explicit navigation keeps manifest order and differs from select order",
  )

  const stagedMarkdown = listFilesRecursive(contentDir).filter((rel) => /\.md$/i.test(rel))
  assert.equal(
    stagedMarkdown.length,
    24,
    `expected 24 staged Markdown pages (got ${stagedMarkdown.length})`,
  )

  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)

  // Page-set equality: every staged Markdown file plus every virtual folder
  // has exactly one emitted page, and no non-Markdown file became a page.
  const stagedHtmls = stagedMarkdown.map(expectedHtmlForStagedMarkdown).sort()
  const virtualHtmls = deriveVirtualHtmls(contentDir, metadata.navigation)
  assert.ok(virtualHtmls.includes("notes.html"), "virtual folder notes.html is derived")
  assert.ok(virtualHtmls.includes("orchard.html"), "virtual folder orchard.html is derived")
  assert.ok(virtualHtmls.includes("notes/nest.html"), "nested virtual folder is derived")
  assert.ok(virtualHtmls.includes("notes/nest/inner.html"), "deep nested virtual folder is derived")
  const expectedPages = [...new Set([...stagedHtmls, ...virtualHtmls])].sort()

  for (const rel of expectedPages) {
    assert.ok(
      fs.existsSync(path.join(outDir, rel)),
      `staged or virtual page must be emitted: ${rel}`,
    )
  }

  const emittedContentPages = listFilesRecursive(outDir)
    .filter((rel) => rel.endsWith(".html") && !rel.startsWith("_next"))
    .filter((rel) => rel !== "404.html" && rel !== "_not-found.html")
    .sort()

  assert.deepEqual(
    emittedContentPages,
    expectedPages,
    "emitted pages match staged Markdown plus virtual folders exactly",
  )

  // Authored root renders its introduction plus the ordered roots.
  const home = readOut(outDir, "index.html")
  assert.match(home, /Garden Home/, "authored root introduction renders")
  const standalonePos = home.indexOf("Lone Pine")
  const orchardPos = home.indexOf("Orchard")
  const notesPos = home.indexOf("Notes")
  const gardenPos = home.indexOf("Garden Plots")
  assert.ok(
    standalonePos !== -1 && orchardPos !== -1 && notesPos !== -1 && gardenPos !== -1,
    "home lists all navigation roots",
  )
  assert.ok(
    standalonePos < orchardPos && orchardPos < notesPos && notesPos < gardenPos,
    "home keeps generated metadata order",
  )

  // Indexed folder owns its route and introduction; virtual folders supply titles.
  const garden = readOut(outDir, "garden.html")
  assert.match(garden, /Garden Plots/, "authored folder introduction renders")
  assert.ok(
    garden.includes('href="/garden/alpha">Alpha Bed</a>'),
    "folder body links to emitted note route",
  )
  const alpha = readOut(outDir, "garden/alpha.html")
  assert.ok(alpha.includes('href="/garden">Garden home</a>'), "index.md links to folder route")
  assert.ok(
    alpha.includes('href="/notes/plain#details">Meadow details</a>'),
    "parent-relative links keep headings on emitted note routes",
  )
  const orchard = readOut(outDir, "orchard.html")
  assert.match(orchard, /<h1[^>]*>Orchard<\/h1>/, "virtual flat folder supplies a humanized title")

  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, "0")
    assert.ok(orchard.includes(`Orchard Note ${n}`), `flat directory lists note ${n}`)
  }

  const nested = readOut(outDir, "notes/nest/inner.html")
  assert.match(nested, /<h1[^>]*>Inner<\/h1>/, "nested virtual folder supplies a humanized title")
  assert.match(nested, /Inner Leaf/, "nested virtual folder links its leaf")
  const standalone = readOut(outDir, "standalone.html")
  assert.match(standalone, /Lone Pine/, "standalone Markdown root renders")

  // Rich syntax renders through the maintained pipeline.
  const guide = readOut(outDir, "notes/guide.html")
  assert.match(
    guide,
    /<title>Field Guide \| Fixture Garden<\/title>/,
    "explicit frontmatter title wins",
  )
  assert.match(guide, /<table[\s>]/, "tables render")
  assert.match(guide, /type="checkbox"/, "task lists render")
  assert.match(guide, /<a href="https:\/\/example\.com\/field-guide"/, "external links render")
  assert.match(
    guide,
    /<img[^>]+src="https:\/\/example\.com\/photos\/very-wide-panoramic-meadow-view\.jpg"/,
    "external images render",
  )
  assert.match(guide, /<pre[^>]*><code/, "fenced code blocks render")
  assert.match(
    guide,
    /<code[^>]*>[\s\S]*\[\[Field Guide\]\][\s\S]*<\/code>/,
    "wikilink-like text inside code blocks stays literal",
  )
  assert.match(
    guide,
    /<code>\[\[Plain Meadow\]\]<\/code>/,
    "wikilink-like text inside inline code stays literal",
  )
  assert.match(
    guide,
    /<code>\[\[Garden Plots\]\]<\/code>/,
    "authored folder index inside inline code stays literal",
  )
  assert.match(
    guide,
    /<a href="\/notes\/plain" class="internal"[^>]*>Plain Meadow<\/a>/,
    "title-based wikilink resolves",
  )
  assert.match(
    guide,
    /<a href="\/notes\/plain" class="internal"[^>]*>plain<\/a>/,
    "filename wikilink resolves",
  )
  assert.match(
    guide,
    /<a href="\/notes\/plain" class="internal"[^>]*>notes\/plain<\/a>/,
    "path wikilink resolves",
  )
  assert.match(
    guide,
    /<a href="\/notes\/plain" class="internal"[^>]*>custom label<\/a>/,
    "label alias preserves authored text",
  )
  assert.match(
    guide,
    /<a href="\/notes\/plain#Details" class="internal"/,
    "heading fragment preserves target",
  )
  assert.match(
    guide,
    /<a href="\/notes\/plain#Details" class="internal"[^>]*>section label<\/a>/,
    "heading fragment with alias preserves text",
  )
  assert.match(
    guide,
    /<a href="\/garden" class="internal"[^>]*>Garden Plots<\/a>/,
    "authored folder index title wikilink resolves to folder route",
  )
  assert.match(
    guide,
    /<a href="Missing Page" class="internal new"[^>]*>Missing Page<\/a>/,
    "missing targets render unresolved without failing the build",
  )

  const plain = readOut(outDir, "notes/plain.html")
  assert.match(
    plain,
    /<title>Plain Meadow \| Fixture Garden<\/title>/,
    "first H1 supplies the title",
  )

  const longPage = readOut(outDir, `notes/${LONG_SLUG}.html`)
  assert.ok(longPage.includes(LONG_TITLE), "long title renders")

  // Non-Markdown staged files never become pages.
  for (const missing of ["assets/photo.html", "assets/doc.html", "assets/doc.pdf.html"]) {
    assert.ok(!fs.existsSync(path.join(outDir, missing)), `${missing} must not be emitted`)
  }

  const strayBinaries = listFilesRecursive(outDir).filter((rel) => /\.(png|pdf)$/i.test(rel))
  assert.deepEqual(strayBinaries, [], "no staged binary is emitted as a page asset")

  // Generated canonical metadata.
  const landing = readOut(outDir, "index.html")
  assert.match(
    landing,
    /<title>Garden Home \| Fixture Garden<\/title>|<title>Fixture Garden<\/title>/,
    "landing document title",
  )

  for (const [label, html] of [
    ["landing", landing],
    ["guide", guide],
  ]) {
    assert.match(html, /fixture\.example\.com/, `${label} metadata carries the canonical hostname`)
  }

  assert.match(
    guide,
    /rel="canonical" href="https:\/\/fixture\.example\.com\/notes\/guide"/,
    "note canonical URL",
  )

  // Per-projection install metadata: generated title, site-local start URL,
  // standalone display, and generic Publisher-owned icons.
  assert.ok(
    fs.existsSync(path.join(outDir, "manifest.webmanifest")),
    "static export carries a per-projection app manifest",
  )
  const webManifest = JSON.parse(readOut(outDir, "manifest.webmanifest"))
  assert.equal(webManifest.name, metadata.title, "manifest name uses the generated title")
  assert.equal(webManifest.start_url, "/", "manifest start URL stays site-local")
  assert.equal(webManifest.scope, "/", "manifest scope stays site-local")
  assert.equal(webManifest.display, "standalone", "manifest uses standalone display")
  assert.ok(
    Array.isArray(webManifest.icons) && webManifest.icons.length > 0,
    "manifest lists generic Publisher-owned icons",
  )

  for (const icon of webManifest.icons) {
    assert.ok(
      typeof icon.src === "string" && icon.src.startsWith("/"),
      "manifest icon stays site-local",
    )
    const iconRel = icon.src.replace(/^\//, "")
    assert.ok(fs.existsSync(path.join(outDir, iconRel)), `manifest icon is emitted: ${iconRel}`)
  }

  const manifestLinks = [...landing.matchAll(/<link\b[^>]*\brel="manifest"[^>]*>/g)]
  assert.equal(manifestLinks.length, 1, "landing links one per-projection app manifest")
  assert.match(
    manifestLinks[0][0],
    /\bcrossorigin="use-credentials"/,
    "protected manifest fetch sends the Access session cookie",
  )

  for (const rel of expectedPages) {
    assert.match(
      readOut(outDir, rel),
      /<link rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials"\/>/,
      `published page requests the protected manifest with credentials: ${rel}`,
    )
  }

  // Bounded output safety inspection.
  assertAbsentEverywhere(outDir, UNSELECTED_SENTINEL, "unselected sentinel")
  assertAbsentEverywhere(outDir, fs.realpathSync(kb), "original vault path")
  assertAbsentEverywhere(outDir, fs.realpathSync(work), "private staging path")
  assertAbsentEverywhere(outDir, fs.realpathSync(PUBLISHER_ROOT), "private publisher checkout path")

  // Generated content stays untracked and ignored.
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

  // Static and read-only runtime: fixed deps, static export, no API routes.
  const pkg = JSON.parse(fs.readFileSync(path.join(READER_ROOT, "package.json"), "utf8"))

  const allowedDeps = new Set([
    "@base-ui/react",
    "@flowershow/remark-wiki-link",
    "class-variance-authority",
    "cn",
    "fumadocs-core",
    "fumadocs-mdx",
    "minisearch",
    "next",
    "react",
    "react-dom",
    "tw-animate-css",
  ])

  for (const name of Object.keys(pkg.dependencies || {})) {
    assert.ok(allowedDeps.has(name), `reader runtime dependency ${name} is expected`)
  }

  const config = fs.readFileSync(path.join(READER_ROOT, "next.config.mjs"), "utf8")
  assert.match(config, /output:\s*["']export["']/, "reader emits a serverless static export")

  const routeFiles = listFilesRecursive(path.join(READER_ROOT, "app")).filter((rel) =>
    /(^|\/)route\.ts$/.test(rel),
  )

  assert.deepEqual(routeFiles, [], "reader has no content API routes")
  const emitted = listFilesRecursive(outDir)
  assert.ok(
    !emitted.some((rel) => /pagefind/i.test(rel)),
    "static output carries no pagefind bundle",
  )

  // Offline generation from the finished export: a self-contained Workbox
  // worker plus a reader-facing manifest, both derived from emitted files
  // only (no Knowledge Base, staging tree, or content API input).
  assert.ok(fs.existsSync(path.join(outDir, "sw.js")), "static export carries an offline worker")
  assert.ok(
    fs.existsSync(path.join(outDir, "offline.json")),
    "static export carries an offline manifest",
  )
  const swText = readOut(outDir, "sw.js")
  assert.match(swText, /precache/, "offline worker uses a Workbox revisioned precache")
  assert.match(swText, /self\.location\.origin/, "offline worker stays on the projection origin")
  assert.match(
    swText,
    /uri\.html|index\.html/,
    "offline worker mirrors the nginx extensionless mapping",
  )
  assert.ok(
    !/https?:\/\/[^"'\s]*cloudflare/i.test(swText),
    "offline worker precaches no access host",
  )
  const offlineManifest = JSON.parse(readOut(outDir, "offline.json"))
  assert.ok(
    typeof offlineManifest.version === "string" && offlineManifest.version.length > 0,
    "offline manifest carries a version",
  )
  assert.ok(
    typeof offlineManifest.totalBytes === "number" && offlineManifest.totalBytes > 0,
    "offline manifest carries an estimated size",
  )
  assert.ok(Array.isArray(offlineManifest.urls), "offline manifest lists urls")

  for (const url of offlineManifest.urls) {
    assert.ok(
      typeof url === "string" && url.startsWith("/"),
      `offline url stays site-local: ${url}`,
    )
    assert.ok(!url.split("/").includes(".."), `offline url never traverses: ${url}`)
    assert.ok(!/^https?:/i.test(url), `offline url is never cross-origin: ${url}`)
  }

  // Every published page (authored plus virtual) is listed for the offline
  // save; the search index and the install manifest travel with them.
  for (const rel of expectedPages) {
    assert.ok(
      offlineManifest.urls.includes(`/${rel}`),
      `offline manifest covers published page: ${rel}`,
    )
  }

  for (const rel of ["search-index.json", "manifest.webmanifest"]) {
    assert.ok(
      offlineManifest.urls.includes(`/${rel}`),
      `offline manifest covers required file: ${rel}`,
    )
  }

  let manifestBytes = 0

  for (const url of offlineManifest.urls) {
    const rel = url.replace(/^\//, "")
    manifestBytes += fs.statSync(path.join(outDir, rel)).size
  }

  assert.equal(
    offlineManifest.totalBytes,
    manifestBytes,
    "offline estimated size matches the listed export files",
  )

  // Workbox precache entries revision every listed file by content hash,
  // reuse hashed `_next/static` URLs without a revision query, and guard
  // every fetch with the exact export bytes: a redirected sign-in page
  // fails integrity instead of being cached as publication.
  const precacheEntries = [
    ...swText.matchAll(/\{url:"([^"]+)",revision:("[^"]+"|null)(?:,integrity:"([^"]+)")?\}/g),
  ].map(([, url, revision, integrity]) => ({ url, revision, integrity }))

  assert.ok(precacheEntries.length > 0, "offline worker inlines precache entries")

  for (const url of offlineManifest.urls) {
    const entryUrl = url.replace(/^\//, "")
    assert.ok(
      precacheEntries.some((entry) => entry.url === entryUrl),
      `precache covers offline url: ${url}`,
    )
  }

  for (const entry of precacheEntries) {
    assert.match(
      entry.integrity ?? "",
      /^sha384-[A-Za-z0-9+/]+={0,2}$/,
      `precache entry guards exact bytes: ${entry.url}`,
    )

    if (entry.url.startsWith("_next/static/")) {
      assert.equal(entry.revision, "null", `hashed asset reuses its URL: ${entry.url}`)
    } else if (entry.url.endsWith(".html") || entry.url === "search-index.json") {
      assert.match(
        entry.revision ?? "",
        /^"[0-9a-f]{16,}"$/,
        `published file carries a content revision: ${entry.url}`,
      )
    }
  }

  // The integrity guard matches the real file: recompute it for the search
  // index and one published page.
  for (const rel of ["search-index.json", "standalone.html"]) {
    const entry = precacheEntries.find((candidate) => candidate.url === rel)
    assert.ok(entry, `precache lists ${rel}`)

    const digest = createHash("sha384")
      .update(fs.readFileSync(path.join(outDir, rel)))
      .digest("base64")

    assert.equal(entry.integrity, `sha384-${digest}`, `integrity matches ${rel} bytes`)
  }

  // Build-time full-text search index over staged content only: the export
  // carries one static JSON file, with no runtime service or dynamic route.
  const searchIndexRel = "search-index.json"
  assert.ok(
    fs.existsSync(path.join(outDir, searchIndexRel)),
    "static export carries a build-time search index",
  )
  const searchIndexRaw = readOut(outDir, searchIndexRel)
  JSON.parse(searchIndexRaw) // the static client must be able to parse it

  // Coverage: titles of staged pages, including the published page omitted
  // from navigation; plus heading and body samples.
  for (const title of [
    "Garden Home",
    "Garden Plots",
    "Alpha Bed",
    "Beta Bed",
    "Field Guide",
    "Plain Meadow",
    "Inner Leaf",
    "Lone Pine",
    "Orchard Note 01",
    "Orchard Note 12",
    "Sunlit Atrium Log",
    "Harbor Ledger",
    "Inland Journal",
    LONG_TITLE,
  ]) {
    assert.ok(searchIndexRaw.includes(title), `search index covers staged title: ${title}`)
  }

  for (const token of ["Details", "Cultivated beds", "Flat orchard note", "stone basin"]) {
    assert.ok(searchIndexRaw.includes(token), `search index covers heading/body text: ${token}`)
  }

  // Exclusions: fenced code, frontmatter-only metadata, the unselected
  // sentinel, and binary content never enter the index.
  for (const [label, token] of [
    ["fenced code", CODE_ONLY_TOKEN],
    ["frontmatter metadata", FRONTMATTER_ONLY_TOKEN],
    ["unselected sentinel", UNSELECTED_SENTINEL],
    ["staged binary", "not-a-real-png"],
  ]) {
    assert.ok(!searchIndexRaw.includes(token), `search index excludes ${label}`)
  }

  // The published page omitted from navigation stays out of presentation.
  assert.ok(
    !home.includes("Sunlit Atrium Log"),
    "hidden-navigation page stays out of the home listing",
  )

  // Engine behavior through the reader's own search module against the
  // served export: the same load+search path the Search dialog will use.
  const searchModule = await import(path.join(READER_ROOT, "lib", "search.mjs"))
  const { server, baseUrl } = await serveOut(outDir)

  try {
    const served = await fetch(`${baseUrl}/${searchIndexRel}`)
    assert.ok(served.ok, "search index is served as static JSON")
    const index = searchModule.loadSearchIndex(await served.json())

    // Title matches rank above weaker body matches; every result carries
    // a title, a location, and an excerpt tied to the matching text.
    const harbor = searchModule.searchNotes(index, "harbor")
    assert.ok(harbor.length >= 2, "title and body matches both return")
    assert.equal(harbor[0].url, "/notes/harbor-ledger", "title match ranks above body match")
    assert.ok(
      harbor.some((hit) => hit.url.startsWith("/notes/inland-journal")),
      "weaker body match is returned",
    )

    for (const hit of harbor) {
      assert.ok(
        typeof hit.title === "string" && hit.title.length > 0,
        "each result carries a title",
      )
      assert.ok(
        typeof hit.url === "string" && hit.url.startsWith("/"),
        "each result carries a location",
      )
      assert.ok(
        typeof hit.excerpt === "string" && hit.excerpt.length > 0,
        "each result carries an excerpt",
      )
      assert.ok(
        stripSearchMarks(hit.excerpt).toLowerCase().includes("harbor"),
        "each result excerpt ties to the matching text",
      )
    }

    assert.ok(
      stripSearchMarks(harbor[0].excerpt).includes("Harbor Ledger"),
      "top result carries the page title",
    )

    // Partial words match.
    const partial = searchModule.searchNotes(index, "sunl")
    assert.ok(
      partial.some((hit) => hit.url.startsWith("/field-notes")),
      "partial words match",
    )

    // One small typo matches.
    const typo = searchModule.searchNotes(index, "sunlti")
    assert.ok(
      typo.some((hit) => hit.url.startsWith("/field-notes")),
      "one small typo matches",
    )

    // The published page omitted from navigation is searchable; its body
    // excerpt ties to the match.
    const hidden = searchModule.searchNotes(index, "sunlit")
    assert.ok(hidden.length > 0, "hidden-navigation page is searchable")
    assert.ok(
      hidden.every((hit) => hit.url.startsWith("/field-notes")),
      "hidden query returns only that page",
    )
    const basin = searchModule.searchNotes(index, "basin")
    assert.ok(
      basin.some(
        (hit) =>
          hit.url.startsWith("/field-notes") &&
          stripSearchMarks(hit.excerpt).toLowerCase().includes("basin"),
      ),
      "body excerpt ties to the matching text",
    )

    // Excluded text never surfaces in search output.
    for (const token of [CODE_ONLY_TOKEN, FRONTMATTER_ONLY_TOKEN, UNSELECTED_SENTINEL]) {
      assert.deepEqual(
        searchModule.searchNotes(index, token),
        [],
        "excluded text has no search output",
      )
    }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

  // Publisher machinery stays unchanged by reader test runs. Root package
  // files are Publisher machinery (reader scripts live there).
  const machineryTouched = porcelain.filter((line) =>
    /(^| )(nginx\.conf|package\.json|pnpm-lock\.yaml|scripts\/|tools\/)/.test(line.trim()),
  )

  assert.deepEqual(
    machineryTouched,
    [],
    `Publisher machinery must be unchanged (got: ${machineryTouched.join("; ")})`,
  )
})

test("offline precache revisions follow exported files without a reader build", async () => {
  const offlineScript = path.join(READER_ROOT, "scripts", "build-offline.mjs")
  const dir = tmpdir("offline-revisions")

  const write = (rel, content) => {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }

  write("index.html", '<link rel="manifest" href="/manifest.webmanifest"/><h1>Home</h1>')
  write("note.html", '<link rel="manifest" href="/manifest.webmanifest"/><h1>Note</h1>')
  write("manifest.webmanifest", "{}")
  write("search-index.json", JSON.stringify({ ok: true }))
  write("_next/static/chunks/app-abc123.js", "console.log(1)")

  const runOffline = () =>
    execFileAsync(process.execPath, [offlineScript, "--dir", dir], {
      cwd: PUBLISHER_ROOT,
      timeout: 120000,
    })

  const revisionsOf = () => {
    const sw = fs.readFileSync(path.join(dir, "sw.js"), "utf8")
    const entries = new Map()

    for (const [, url, revision] of sw.matchAll(
      /\{url:"([^"]+)",revision:("[^"]+"|null)(?:,integrity:"[^"]+")?\}/g,
    )) {
      entries.set(url, revision)
    }

    return entries
  }

  await runOffline()
  const before = revisionsOf()
  assert.ok(before.has("note.html"), "precache lists the page")
  assert.ok(before.has("search-index.json"), "precache lists the search index")
  assert.equal(
    before.get("_next/static/chunks/app-abc123.js"),
    "null",
    "hashed asset reuses its URL without a revision query",
  )
  assert.match(
    fs.readFileSync(path.join(dir, "sw.js"), "utf8"),
    /integrity:"sha384-[^"]+"/,
    "precache entries guard exact export bytes",
  )
  const homeBefore = before.get("index.html")
  const hashedBefore = before.get("_next/static/chunks/app-abc123.js")

  write("note.html", '<link rel="manifest" href="/manifest.webmanifest"/><h1>Note changed</h1>')
  write("search-index.json", JSON.stringify({ ok: true, v: 2 }))
  await runOffline()
  const after = revisionsOf()
  assert.notEqual(
    after.get("note.html"),
    before.get("note.html"),
    "changed page gets a new revision",
  )
  assert.notEqual(
    after.get("search-index.json"),
    before.get("search-index.json"),
    "changed search index gets a new revision",
  )
  assert.equal(after.get("index.html"), homeBefore, "unchanged page keeps its revision")
  assert.equal(
    after.get("_next/static/chunks/app-abc123.js"),
    hashedBefore,
    "unchanged hashed asset keeps reusing its URL",
  )

  fs.rmSync(path.join(dir, "note.html"))
  await runOffline()
  assert.equal(
    [
      ...fs
        .readFileSync(path.join(dir, "index.html"), "utf8")
        .matchAll(/crossorigin="use-credentials"/g),
    ].length,
    1,
    "generated manifest link gains credentials only once across repeated offline builds",
  )
  const removed = revisionsOf()
  assert.ok(!removed.has("note.html"), "removed page leaves the precache")
  assert.ok(removed.has("index.html"), "remaining pages stay precached")
  // Update lifecycle preserves the reading session: the generated worker
  // waits for an explicit reload instead of claiming clients, while still
  // cleaning outdated caches so removed pages disappear after activation.
  const offlineSource = fs.readFileSync(offlineScript, "utf8")
  assert.match(offlineSource, /skipWaiting:\s*false/, "updated worker waits for Reload")
  assert.match(offlineSource, /clientsClaim:\s*false/, "updated worker never claims the session")
  assert.match(
    offlineSource,
    /cleanupOutdatedCaches:\s*true/,
    "successful update clears removed pages",
  )
})

test("offline generation rejects an export file omitted from the precache", async () => {
  const dir = tmpdir("offline-oversize")
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>Home</h1>")
  fs.writeFileSync(path.join(dir, "search-index.json"), "{}")
  fs.writeFileSync(path.join(dir, "large.html"), "")
  fs.truncateSync(path.join(dir, "large.html"), 5 * 1024 * 1024 + 1)
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [path.join(READER_ROOT, "scripts", "build-offline.mjs"), "--dir", dir],
      {
        cwd: PUBLISHER_ROOT,
        timeout: 120000,
      },
    ),
    /large\.html|omitted|precache/i,
    "publishing must fail instead of claiming an incomplete offline copy",
  )
})

test("generic real corpus builds a complete static export from staged content only", async (t) => {
  const kbRoot = resolveKnowledgeBaseRoot()

  if (!kbRoot) {
    t.skip("KNOWLEDGE_BASE_ROOT is not set to a vault checkout; skipping real-corpus build")

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

  const metadata = readMetadata(identityFile)
  assert.ok(metadata.title && metadata.title.trim() !== "", "generated metadata carries a title")
  assert.ok(
    metadata.canonicalHostname && metadata.canonicalHostname.trim() !== "",
    "generated metadata carries a canonical hostname",
  )
  assert.ok(
    Array.isArray(metadata.navigation) && metadata.navigation.length > 0,
    "generated navigation is non-empty",
  )

  for (const entry of metadata.navigation) {
    assert.ok(!path.isAbsolute(entry.path), "navigation paths stay relative")
    assert.ok(!entry.path.includes(".."), "navigation paths never traverse")
  }

  const stagedMarkdown = listFilesRecursive(contentDir).filter((rel) => /\.md$/i.test(rel))
  assert.ok(stagedMarkdown.length > 0, "staged tree holds Markdown pages")

  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)

  const stagedHtmls = stagedMarkdown.map(expectedHtmlForStagedMarkdown).sort()
  const virtualHtmls = deriveVirtualHtmls(contentDir, metadata.navigation)
  const expectedPages = [...new Set([...stagedHtmls, ...virtualHtmls])].sort()

  for (const rel of expectedPages) {
    assert.ok(
      fs.existsSync(path.join(outDir, rel)),
      `staged or virtual page must be emitted: ${rel}`,
    )
  }

  const emittedContentPages = listFilesRecursive(outDir)
    .filter((rel) => rel.endsWith(".html") && !rel.startsWith("_next"))
    .filter((rel) => rel !== "404.html" && rel !== "_not-found.html")
    .sort()

  assert.deepEqual(
    emittedContentPages,
    expectedPages,
    "emitted pages match staged Markdown plus virtual folders exactly",
  )

  // The generic build path inherits the search index without new orchestration.
  assert.ok(
    fs.existsSync(path.join(outDir, "search-index.json")),
    "generic build also emits the search index",
  )

  // Canonical metadata derives from generated metadata, not fixed subjects.
  const home = readOut(outDir, "index.html")
  assert.ok(home.includes(metadata.title), "home carries the generated title")
  assert.ok(home.includes(metadata.canonicalHostname), "home carries the canonical hostname")
  const firstPageRel = expectedPages.find((rel) => rel !== "index.html")
  assert.ok(firstPageRel, "staged corpus has a non-home page")
  const firstPage = readOut(outDir, firstPageRel)
  const firstRoute = `/${firstPageRel.replace(/\.html$/, "")}`
  assert.match(
    firstPage,
    new RegExp(
      `rel="canonical" href="https://${metadata.canonicalHostname.replace(/\./g, "\\.")}${firstRoute.replace(/\//g, "\\/")}"`,
    ),
    "page canonical URL uses generated hostname",
  )

  // Output safety stays generic: no private checkout paths in output.
  assertAbsentEverywhere(outDir, fs.realpathSync(kbRoot), "original vault path")
  assertAbsentEverywhere(outDir, fs.realpathSync(work), "private staging path")
  assertAbsentEverywhere(outDir, fs.realpathSync(PUBLISHER_ROOT), "private publisher checkout path")
})
