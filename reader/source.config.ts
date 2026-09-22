import { defineCollections, defineConfig } from "fumadocs-mdx/config"
import path from "node:path"

/**
 * Headless staged-Markdown content source.
 *
 * Reads ONLY the isolated staged content tree produced by
 * `scripts/stage-content.mjs` (Publication Manifest allowlist authority).
 * It never accepts a Knowledge Base root, manifest path, or vault location:
 * the only input is SHARED_CONTENT_DIR (default: the publisher `./content`
 * staging tree next to this reader). Non-Markdown staged files are ignored
 * by the collection: only `.md`/`.mdx` files become pages.
 */
function resolveContentDir(): string {
  const configured = process.env.SHARED_CONTENT_DIR ?? "../content"
  return path.isAbsolute(configured) ? configured : path.resolve(import.meta.dirname, configured)
}

export const shared = defineCollections({
  type: "doc",
  dir: resolveContentDir(),
})

/**
 * Global MDX preset tuning (defaults otherwise untouched).
 *
 * `remarkImageOptions: false` disables build-time image measurement so
 * external reference images stay plain `<img>` tags: the static export must
 * be hermetic and must not fetch remote assets at build time.
 */
export default defineConfig({
  mdxOptions: {
    remarkImageOptions: false,
  },
})
