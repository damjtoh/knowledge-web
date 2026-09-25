/**
 * Build-time full-text search index for the generic static reader.
 *
 * Reads ONLY the isolated staged Markdown tree (Publication Manifest
 * Allowlist authority, via READER_CONTENT_DIR) and writes a single static
 * JSON file into the export output (`out/search-index.json`). The file is
 * served as static JSON; no API route, server, or runtime service is
 * involved (`reader/app` stays free of `route.ts`).
 *
 * Indexing and query behavior belong to MiniSearch, the
 * spec-sanctioned fallback after measured limits in the bundled
 * engines: page text is extracted with Fumadocs `structure()` (titles,
 * headings, readable body text; fenced code and frontmatter stay out
 * by construction) and indexed through the generic search module in
 * `reader/lib/search.mjs`. The browser Search dialog (a later item)
 * loads the file with the same module.
 *
 * Coverage is deliberately broader than presentation: every staged
 * Markdown page is indexed, including published pages the generated
 * `navigation` metadata omits from the visible tree.
 *
 * Runs as part of the standard reader build:
 * `npm run build` in `reader/`.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildSearchIndex } from "../lib/search.mjs"
import { structure } from "fumadocs-core/mdx-plugins/remark-structure"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const READER_ROOT = path.resolve(scriptDir, "..")

/** Same input rule as `source.config.ts`: staged tree only, never a vault. */
function resolveContentDir() {
  const configured = process.env.READER_CONTENT_DIR ?? "../content"
  if (path.isAbsolute(configured)) return configured
  return path.resolve(READER_ROOT, configured)
}

const OUT_FILE = path.join(READER_ROOT, "out", "search-index.json")

function discoverMarkdown(contentDir) {
  const out = []
  const walk = (dir) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) {
        out.push(path.relative(contentDir, abs).split(path.sep).join("/"))
      }
    }
  }
  walk(contentDir)
  return out.sort()
}

function splitFrontmatter(raw) {
  const text = String(raw ?? "").replace(/\r\n/g, "\n")
  const lines = text.split("\n")
  if (lines[0]?.trim() !== "---") return { data: "", body: text }
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---")
  if (close === -1) return { data: "", body: text }
  return {
    data: lines.slice(1, close).join("\n"),
    body: lines.slice(close + 1).join("\n"),
  }
}

/** Mirrors `reader/lib/wiki-aliases.ts`: explicit frontmatter title only. */
function frontmatterTitle(data) {
  const match = data.match(/^title:\s*(.+?)\s*$/m)
  if (!match) return ""
  let value = match[1].trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  const title = value.trim()
  if (title === "" || title.toLowerCase() === "null" || title === "~") return ""
  return title
}

/** Mirrors `reader/lib/wiki-aliases.ts`: first H1 outside fenced code. */
function firstH1(body) {
  let fenced = false
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = line.match(/^#\s+(.+?)\s*$/)
    if (match) return match[1].trim()
  }
  return ""
}

function fallbackTitle(rel) {
  const base = rel.split("/").pop() ?? rel
  if (/^index\.mdx?$/i.test(base)) {
    const dir = rel.split("/").slice(0, -1).pop()
    return dir && dir !== "" ? dir : "index"
  }
  return base.replace(/\.mdx?$/i, "")
}

/** Mirrors the reader route rule: nested indexes own their folder route. */
function slugsForRel(rel) {
  const withoutExt = rel.replace(/\.mdx?$/i, "")
  const parts = withoutExt.split("/").filter((segment) => segment !== "")
  if (parts.length > 0 && /^index$/i.test(parts[parts.length - 1])) parts.pop()
  return parts
}

async function main() {
  const contentDir = resolveContentDir()
  const rels = discoverMarkdown(contentDir)
  // Field mapping and excerpt shaping live in the shared search module;
  // the script only feeds it the staged extraction.
  const pages = rels.map((rel) => {
    const raw = fs.readFileSync(path.join(contentDir, ...rel.split("/")), "utf8")
    const { data, body } = splitFrontmatter(raw)
    // Frontmatter contributes the title only; every other frontmatter
    // value stays out of the index. Only the body is structured, so
    // fenced code blocks never become searchable text either.
    const title = frontmatterTitle(data) || firstH1(body) || fallbackTitle(rel)
    const slugs = slugsForRel(rel)
    const url = slugs.length === 0 ? "/" : `/${slugs.join("/")}`
    return {
      title,
      url,
      structuredData: structure(body),
    }
  })

  const exported = buildSearchIndex(pages)
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(exported))
  console.log(
    `[search-index] indexed ${pages.length} staged pages -> ${path.relative(READER_ROOT, OUT_FILE)}`,
  )
}

await main()
