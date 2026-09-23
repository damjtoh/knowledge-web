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
}

export default withMDX(config)
