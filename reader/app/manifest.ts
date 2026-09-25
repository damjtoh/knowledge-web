import type { MetadataRoute } from "next"
import { getSiteMetadata } from "../lib/site"

/**
 * Per-Web-Projection install metadata.
 *
 * Each static export generates its own manifest from the staged
 * `site-identity.json` (Publication Manifest title). The start URL stays
 * site-local (`/`) so the installed app launches that same origin's home
 * and never shares another projection's identity. Icons are generic
 * Publisher-owned artwork; no per-site art and no new Publication Manifest
 * fields are involved.
 *
 * Forced static: the reader is a static export with no server, so this
 * route must prerender at build time from the staged site identity.
 */
export const dynamic = "force-static"

export default function manifest(): MetadataRoute.Manifest {
  const site = getSiteMetadata()

  return {
    name: site.title,
    short_name: site.title,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  }
}
