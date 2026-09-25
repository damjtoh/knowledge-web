import { createMDX } from "fumadocs-mdx/next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const readerDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Static reader build: Fumadocs MDX generates the headless staged-Markdown
 * source at build time, Next.js emits static files only. The build runs on
 * webpack because the isolated staged content tree lives outside this
 * project directory. No Node.js production server is required; serve `out/`
 * behind nginx.
 */
const withMDX = createMDX()

/** @type {import('next').NextConfig} */
const config = {
  allowedDevOrigins: ["dev-mac.dami.dev"],
  output: "export",
  poweredByHeader: false,
  outputFileTracingRoot: path.join(readerDir, ".."),
  webpack: (config) => {
    // Next 16 webpack module resolution skips dot directories, so the
    // tsconfig `@/*` alias cannot reach the generated `.source/` tree
    // (Turbopack resolves it, webpack does not). Alias it explicitly or a
    // clean build fails on `@/.source/server`.
    config.resolve.alias["@/.source"] = path.join(readerDir, ".source")

    return config
  },
}

export default withMDX(config)
