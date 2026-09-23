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
 */
const LONG_TITLE =
  "An extremely long packing checklist title that keeps going SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious"
const LONG_SLUG = "long-packing-checklist-title-that-keeps-going-for-wrapping-probes"
const UNSELECTED_SENTINEL = "FIXTURE_UNSELECTED_SENTINEL_7Q2X"

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
    "# Garden Plots\n\nCultivated beds with an authored introduction.\n",
  )
  writeFile(kb, "garden/alpha.md", "# Alpha Bed\n\nFirst bed. See [[Garden Plots]] for the area.\n")
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
  await execFileAsync("npm", ["run", "build"], {
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
    21,
    `expected 21 staged Markdown pages (got ${stagedMarkdown.length})`,
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
    !emitted.some((rel) => /sw\.js$|service-worker|workbox|pagefind/i.test(rel)),
    "static output carries no service worker or search index",
  )

  // Quartz and its rollback build stay available and unchanged. Root
  // package files are Publisher machinery (Step 7 reader scripts live
  // there), so only the Quartz rollback paths are checked here.
  const quartzTouched = porcelain.filter((line) =>
    / (quartz\/|plugins\/|quartz\.config\.yaml|quartz\.lock\.json|nginx\.conf)$/.test(line.trim()),
  )
  assert.deepEqual(
    quartzTouched,
    [],
    `Quartz machinery must be unchanged (got: ${quartzTouched.join("; ")})`,
  )
  assert.ok(fs.existsSync(path.join(PUBLISHER_ROOT, "quartz", "bootstrap-cli.mjs")))
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
