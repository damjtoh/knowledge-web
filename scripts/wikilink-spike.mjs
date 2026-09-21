#!/usr/bin/env node
/**
 * Wikilink syntax spike.
 *
 * Proves the maintained @flowershow/remark-wiki-link plugin handles the real
 * staged Shared body-wikilink syntax with minimal project-owned code. Reads
 * ONLY an isolated staged content directory. It never scans the source vault:
 * staging (scripts/stage-content.mjs) is the publication authority.
 *
 * Usage:
 *   node scripts/wikilink-spike.mjs --content-dir <staged content>
 *
 * Exit 0 when every staged Markdown file processes. Exit 2 on usage errors
 * or when a symlink is found inside the staged tree.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkGfm from "remark-gfm"
import wikiLinkPlugin from "@flowershow/remark-wiki-link"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import { visit } from "unist-util-visit"

// Vault inputs are rejected so this step cannot mistake itself for a vault
// scan. Only --content-dir is accepted.
const VAULT_FLAGS = new Set([
  "--kb-root",
  "--kb",
  "--vault",
  "--vault-root",
  "--manifest",
  "--original-vault",
  "--source-vault",
])

export function parseArgs(argv) {
  const args = { contentDir: null, errors: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (VAULT_FLAGS.has(arg)) {
      args.errors.push(`${arg} is not accepted: the spike reads only staged content`)
      i++
      continue
    }
    if (arg === "--content-dir") {
      args.contentDir = argv[i + 1] ?? null
      i++
      continue
    }
    args.errors.push(`unknown argument: ${arg}`)
  }
  if (!args.contentDir) args.errors.push("--content-dir is required (staged content directory)")
  return args
}

// Stable route per staged file. Root/nested index.md collapses to the
// directory route; other .md suffixes are removed.
export function routeForSourcePath(sourcePath) {
  const posix = sourcePath.replace(/\\/g, "/")
  const dir = path.posix.dirname(posix)
  const base = path.posix.basename(posix)
  if (/^index\.md$/i.test(base)) return dir === "." || dir === "" ? "/" : `/${dir}`
  return `/${posix.replace(/\.md$/i, "")}`
}

// Discover staged Markdown files in sorted order. Any symlink is rejected:
// staged content must be real files so publication stays auditable.
export function discoverStagedMarkdown(contentDir) {
  const found = []
  const walk = (dir) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      if (entry.isSymbolicLink())
        throw new Error(`symlink rejected inside staged content: ${path.relative(contentDir, abs)}`)
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        found.push(path.relative(contentDir, abs).split(path.sep).join("/"))
      }
    }
  }
  walk(contentDir)
  return found.sort()
}

// Drop YAML frontmatter so only body Markdown reaches the processor.
// Frontmatter wikilink resolution is out of scope for this spike.
export function stripFrontmatter(raw) {
  const text = String(raw ?? "").replace(/\r\n/g, "\n")
  const lines = text.split("\n")
  if (lines[0]?.trim() !== "---") return text
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  return close === -1 ? text : lines.slice(close + 1).join("\n")
}

// The plugin owns wikilink parsing and rendering. Project code only supplies
// shortest-form matching (files), route mapping (permalinks), and the
// standard Unified pipeline. No wikilink regex lives here.
export function buildProcessor(files, permalinks) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(wikiLinkPlugin, { format: "shortestPossible", files, permalinks })
    .use(remarkRehype)
}

// Count plugin-resolved vs plugin-unresolved links from the rendered tree:
// resolved links carry class "internal", missing targets add "new".
export function countWikilinks(hast) {
  const counts = { resolved: 0, unresolved: 0 }
  visit(hast, "element", (node) => {
    if (node.tagName !== "a") return
    const classes = node.properties?.className ?? []
    if (!classes.includes("internal")) return
    if (classes.includes("new")) counts.unresolved += 1
    else counts.resolved += 1
  })
  return counts
}

export async function processStagedContent(contentDir) {
  const sources = discoverStagedMarkdown(contentDir)
  const permalinks = Object.fromEntries(sources.map((rel) => [rel, routeForSourcePath(rel)]))
  const processor = buildProcessor(sources, permalinks)
  const stringifier = unified().use(rehypeStringify)
  const pages = []
  for (const sourcePath of sources) {
    const body = stripFrontmatter(fs.readFileSync(path.join(contentDir, sourcePath), "utf8"))
    const hast = await processor.run(processor.parse(body))
    const counts = countWikilinks(hast)
    pages.push({
      sourcePath,
      route: permalinks[sourcePath],
      html: String(stringifier.stringify(hast)),
      ...counts,
    })
  }
  return {
    pages,
    files: pages.length,
    resolved: pages.reduce((sum, page) => sum + page.resolved, 0),
    unresolved: pages.reduce((sum, page) => sum + page.unresolved, 0),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const contentDir = args.contentDir ? path.resolve(args.contentDir) : null
  if (contentDir && (!fs.existsSync(contentDir) || !fs.statSync(contentDir).isDirectory())) {
    args.errors.push(`staged content directory is not a directory: ${args.contentDir}`)
  }
  if (args.errors.length > 0) {
    for (const error of args.errors) console.error(`✗ ${error}`)
    process.exit(2)
  }
  try {
    const result = await processStagedContent(contentDir)
    console.log(`✓ Wikilink spike: ${result.files} staged Markdown files processed`)
    console.log(`    resolved internal links: ${result.resolved}`)
    console.log(`    unresolved (class "internal new"): ${result.unresolved}`)
  } catch (error) {
    console.error(`✗ Wikilink spike failed: ${error.message}`)
    process.exit(2)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
