import { defineCollections, defineConfig } from "fumadocs-mdx/config"
import wikiLinkPlugin from "@flowershow/remark-wiki-link"
import path from "node:path"
import { buildWikiLinkMaps } from "./lib/wiki-aliases.js"
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
 */
const wikiMaps = buildWikiLinkMaps(resolveContentDir())

export default defineConfig({
  mdxOptions: {
    remarkImageOptions: false,
    remarkPlugins: [
      [
        wikiLinkPlugin,
        { format: "regular", files: wikiMaps.files, permalinks: wikiMaps.permalinks },
      ],
      [remarkRelativeLinks, resolveContentDir()],
    ],
  },
})
