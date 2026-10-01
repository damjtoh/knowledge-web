import { defineCollections, defineConfig } from "fumadocs-mdx/config"
import wikiLinkPlugin from "@flowershow/remark-wiki-link"
import path from "node:path"
import { buildWikiLinkMaps } from "./lib/wiki-aliases.js"
import remarkReadingTime from "./lib/reading-time.js"
import remarkMermaid from "./lib/remark-mermaid.js"
import remarkRelativeLinks from "./lib/relative-links.js"

/**
 * Headless staged-Markdown content source.
 *
 * Reads ONLY the isolated staged content tree produced by
 * `scripts/stage-content.mjs` (Publication Manifest allowlist authority).
 * It never accepts a Knowledge Base root, manifest path, or vault location:
 * the only input is READER_CONTENT_DIR (default: the publisher `./content`
 * staging tree next to this reader). Non-Markdown staged files are ignored
 * by the collection: only `.md`/`.mdx` files become pages.
 */
function resolveContentDir(): string {
  const configured = process.env.READER_CONTENT_DIR ?? "../content"

  // Relative defaults resolve from the build working directory (the reader
  // package root). import.meta.dirname is unavailable here: the config is
  // bundled by fumadocs-mdx into reader/.source, so it would resolve to
  // reader/content instead of the publisher ./content staging tree.
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
}

export const content = defineCollections({
  type: "doc",
  dir: resolveContentDir(),
})

/**
 * Global MDX preset tuning (defaults otherwise untouched).
 *
 * `remarkImageOptions: false` disables build-time image measurement so
 * external reference images stay plain `<img>` tags: the static export must
 * be hermetic and must not fetch remote assets at build time.
 *
 * Body wikilinks stay owned by the maintained plugin. The small repository
 * adapter supplies title, filename, path, and nested-index aliases plus
 * stable permalinks from staged page metadata; missing targets keep the
 * plugin `internal new` unresolved state and frontmatter stays untouched.
 *
 * Read-time stays a repository heuristic (decision 2, quality not a
 * concern): remarkReadingTime counts body text words and writes
 * `read_minutes` onto parsed frontmatter, where it flows to page data like
 * `updated_at`. The collection declares no schema, so the unknown field
 * passes through without validation changes.
 *
 * Authored ```mermaid fences stay standard Markdown here and become one
 * `<Mermaid source="..." />` MDX element through `remarkMermaid`; the
 * shared component map in `components/mdx-components.tsx` binds that
 * element to the local client renderer in every body renderer. The diagram
 * text crosses as a serialized string, never as executable MDX.
 */
const wikiMaps = buildWikiLinkMaps(resolveContentDir())

export default defineConfig({
  mdxOptions: {
    remarkImageOptions: false,
    remarkPlugins: [
      // Authored ```mermaid fences become the local <Mermaid> client
      // component (serialized source string only); every other fence stays
      // a plain code block.
      remarkMermaid,
      [
        wikiLinkPlugin,
        { format: "regular", files: wikiMaps.files, permalinks: wikiMaps.permalinks },
      ],
      [remarkRelativeLinks, resolveContentDir()],
      remarkReadingTime,
    ],
  },
})
