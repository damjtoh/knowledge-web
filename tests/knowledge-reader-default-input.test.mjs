/**
 * Knowledge reader default-input regression.
 *
 * Docker-style production path in an isolated throwaway workspace: staged
 * vault-like content plus generated metadata at publisher defaults
 * (`./content`, `./site-identity.json`) with no READER_CONTENT_DIR /
 * READER_SITE_METADATA_FILE override. The reader build must export every
 * staged page plus nested virtual folders, expose nested navigation (not
 * only root nodes), and keep search result URLs on emitted static pages.
 *
 * Regression for the prior Docker image failure: the search index covered
 * 151 staged pages while the export held only 9 HTML files and the sidebar
 * exposed only five root data-tree-url nodes. Absolute-path coverage in
 * knowledge-reader-static.test.mjs stays intact; this suite is the only
 * caller that builds through the relative defaults.
 *
 * Safety: the suite never reads, moves, or deletes the checkout's
 * publisher `content/` or `site-identity.json` (which may hold private
 * staged content). It materializes a throwaway publisher/reader workspace
 * under a unique `.tmp-...` directory inside the repository root, stages
 * synthetic content there, runs a real `npm ci` in the throwaway reader
 * (needs registry access or a warm npm cache), and builds with the
 * workspace reader as the working directory. Interrupting the suite can
 * only leave an untracked temp workspace behind; the `after` hook removes
 * it on completion.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-default-input.test.mjs
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `knowledge-reader-default-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}

/**
 * Throwaway workspace parent inside the repository root (unique per run).
 * A prior revision placed the isolated publisher/reader workspace under
 * the system temp directory and failed with `Can't resolve
 * '@/.source/server'` despite `.source/server.ts` existing; the remaining
 * environmental difference is workspace location (outside-repo temp dir
 * versus in-repo project tree, where Next.js project detection, tracing
 * roots, and macOS temp symlinks behave differently). This helper keeps
 * one variable changed: the workspace lives under a unique `.tmp-...`
 * directory in the repo root and never touches the real publisher
 * `content/` or `site-identity.json`.
 */
function repoWorkspaceRoot(prefix) {
  const dir = path.join(
    PUBLISHER_ROOT,
    `.tmp-${prefix}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  )
  fs.mkdirSync(dir, { recursive: true })
  tmpRoots.push(dir)
  return dir
}

after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

function writeFile(root, rel, content) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

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

/** Search URL -> expected static-export HTML path. */
function expectedHtmlForSearchUrl(url) {
  const clean = String(url ?? "").split("#")[0]
  if (clean === "/") return "index.html"
  return `${clean.replace(/^\//, "")}.html`
}

/**
 * Vault-like synthetic Knowledge Base: five directory roots in manifest
 * order, no authored root index (so staging emits the synthetic landing
 * like the Damian projection), one nested virtual chain under notes, and
 * one notes leaf whose shape stands in for a deep staged note route.
 */
function makeVaultLikeKb() {
  const kb = tmpdir("kb-vaultlike")
  writeFile(kb, "workout/recovery.md", "# Recovery Run\n\nEasy recovery miles.\n")
  writeFile(
    kb,
    "notes/learning-cluster.md",
    "# Learning Cluster\n\nA deep staged note under notes.\n",
  )
  writeFile(kb, "notes/nest/inner/leaf.md", "# Inner Leaf\n\nDeep nested note.\n")
  writeFile(kb, "personal/journal.md", "# Journal\n\nPersonal entry.\n")
  writeFile(kb, "work/project.md", "# Project\n\nWork entry.\n")
  writeFile(kb, "health/log.md", "# Health Log\n\nHealth entry.\n")
  writeFile(
    kb,
    "publication.manifest.yaml",
    [
      "title: Vaultlike Garden",
      "canonicalHostname: vaultlike.example.com",
      "select:",
      "  - workout",
      "  - notes",
      "  - personal",
      "  - work",
      "  - health",
      "",
    ].join("\n"),
  )
  return kb
}

/**
 * Throwaway publisher/reader workspace mirroring the checkout layout:
 * `<workspace>/publisher/{content,site-identity.json,reader/}`, where the
 * workspace itself is a unique `.tmp-...` directory inside the repository
 * root (never the real publisher `content/` or `site-identity.json`). The
 * reader sources are copied from the checkout (excluding disposable
 * artifacts and dependencies) followed by a real `npm ci` in the
 * throwaway reader, so the build exercises the real reader code through
 * the real relative defaults as a genuine standalone project without
 * touching checkout state.
 */
function materializeIsolatedWorkspace() {
  const work = repoWorkspaceRoot("knowledge-reader-default-publisher")
  const fakePublisher = path.join(work, "publisher")
  const fakeReader = path.join(fakePublisher, "reader")
  fs.mkdirSync(fakeReader, { recursive: true })
  const skip = new Set(["node_modules", ".next", "out", ".source", "tsconfig.tsbuildinfo"])
  for (const entry of fs.readdirSync(READER_ROOT)) {
    if (skip.has(entry)) continue
    fs.cpSync(path.join(READER_ROOT, entry), path.join(fakeReader, entry), { recursive: true })
  }
  return {
    fakePublisher,
    fakeReader,
    fakeContent: path.join(fakePublisher, "content"),
    fakeIdentity: path.join(fakePublisher, "site-identity.json"),
    fakeOut: path.join(fakeReader, "out"),
  }
}

/** Best-effort listing for build-failure diagnostics (never throws). */
function listDirSafe(dir) {
  try {
    return fs.readdirSync(dir).sort().join(", ") || "(empty)"
  } catch (error) {
    return `(unreadable: ${error.message})`
  }
}

test("default-input build exports nested pages and keeps search on emitted routes", async () => {
  const kb = makeVaultLikeKb()
  const { fakeReader, fakeContent, fakeIdentity, fakeOut } = materializeIsolatedWorkspace()

  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", fakeContent, "--identity-file", fakeIdentity],
    { cwd: PUBLISHER_ROOT, timeout: 120000 },
  )

  const stagedMarkdown = listFilesRecursive(fakeContent).filter((rel) => /\.md$/i.test(rel))
  assert.ok(
    stagedMarkdown.includes(path.join("notes", "learning-cluster.md")) ||
      stagedMarkdown.includes("notes/learning-cluster.md"),
    "staged defaults carry the nested notes leaf",
  )

  const env = { ...process.env }
  delete env.READER_CONTENT_DIR
  delete env.READER_SITE_METADATA_FILE
  try {
    await execFileAsync("npm", ["ci", "--no-audit", "--no-fund"], {
      cwd: fakeReader,
      timeout: 600000,
      env,
    })
    await execFileAsync("npm", ["run", "build"], {
      cwd: fakeReader,
      timeout: 600000,
      env,
    })
  } catch (error) {
    const detail = [
      `build failed in isolated workspace ${fakeReader}`,
      `reader: ${listDirSafe(fakeReader)}`,
      `.source: ${listDirSafe(path.join(fakeReader, ".source"))}`,
      `content: ${listDirSafe(fakeContent)}`,
      `stdout: ${(error.stdout ?? "").slice(-4000)}`,
      `stderr: ${(error.stderr ?? "").slice(-4000)}`,
    ].join("\n")
    throw new Error(`${detail}\ncause: ${error.message}`)
  }

  // C1: every staged page plus virtual folders is emitted, including the
  // nested notes leaf and its virtual chain.
  for (const rel of [
    "notes/learning-cluster.html",
    "notes/nest/inner/leaf.html",
    "notes/nest/inner.html",
    "notes/nest.html",
    "notes.html",
    "index.html",
  ]) {
    assert.ok(fs.existsSync(path.join(fakeOut, rel)), `default build emits ${rel}`)
  }
  const stagedHtmls = stagedMarkdown.map(expectedHtmlForStagedMarkdown).sort()
  for (const rel of stagedHtmls) {
    assert.ok(fs.existsSync(path.join(fakeOut, rel)), `staged page emitted: ${rel}`)
  }
  const emittedContentPages = listFilesRecursive(fakeOut)
    .filter((rel) => rel.endsWith(".html") && !rel.startsWith("_next"))
    .filter((rel) => rel !== "404.html" && rel !== "_not-found.html")
    .sort()
  assert.ok(
    emittedContentPages.length >= stagedHtmls.length,
    `export holds every staged page (staged ${stagedHtmls.length}, emitted ${emittedContentPages.length})`,
  )

  // C1: nested navigation survives the static prerender (prior failure
  // held only five root data-tree-url nodes).
  const home = fs.readFileSync(path.join(fakeOut, "index.html"), "utf8")
  const treeUrls = [...home.matchAll(/data-tree-url="([^"]+)"/g)].map((m) => m[1])
  assert.ok(treeUrls.length > 5, `sidebar exposes nested nodes (got ${treeUrls.length})`)
  for (const url of ["/notes", "/notes/learning-cluster", "/notes/nest/inner"]) {
    assert.ok(treeUrls.includes(url), `sidebar exposes nested node ${url}`)
  }
  const notes = fs.readFileSync(path.join(fakeOut, "notes.html"), "utf8")
  assert.ok(
    notes.includes('data-tree-url="/notes/learning-cluster"'),
    "notes folder page exposes its nested leaf",
  )

  // C2: every search result URL resolves to an emitted static page.
  const searchRaw = fs.readFileSync(path.join(fakeOut, "search-index.json"), "utf8")
  assert.ok(searchRaw.includes("Learning Cluster"), "search index covers the nested leaf")
  const searchModule = await import(path.join(fakeReader, "lib", "search.mjs"))
  const index = searchModule.loadSearchIndex(JSON.parse(searchRaw))
  const hits = searchModule.searchNotes(index, "learning")
  assert.ok(
    hits.some((hit) => hit.url.startsWith("/notes/learning-cluster")),
    "search finds the nested leaf",
  )
  const indexedUrls = new Set()
  for (const query of ["learning", "recovery", "journal", "project", "health", "inner"]) {
    for (const hit of searchModule.searchNotes(index, query)) {
      indexedUrls.add(hit.url.split("#")[0])
    }
  }
  indexedUrls.add("/notes/learning-cluster")
  assert.ok(indexedUrls.size >= 4, `search covers staged pages (got ${indexedUrls.size})`)
  for (const url of indexedUrls) {
    const rel = expectedHtmlForSearchUrl(url)
    assert.ok(
      fs.existsSync(path.join(fakeOut, rel)),
      `search URL resolves to an emitted page: ${url} -> ${rel}`,
    )
  }
})
