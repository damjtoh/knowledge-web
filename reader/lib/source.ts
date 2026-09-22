import { loader } from "fumadocs-core/source"
import { toFumadocsSource } from "fumadocs-mdx/runtime/server"
import { shared } from "@/.source/server"

/**
 * Headless page source for staged Shared Markdown.
 *
 * Fumadocs Core/MDX acts only as the content source: page discovery,
 * Markdown compilation, and route parameters. No Fumadocs UI is used;
 * rendering is the custom reader shell in `app/`.
 */
export const source = loader({
  baseUrl: "/",
  source: toFumadocsSource(shared, []),
})
