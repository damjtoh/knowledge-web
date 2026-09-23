import type { Metadata } from "next"
import { getSiteMetadata, canonicalUrl } from "../lib/site"
import { source } from "../lib/source"
import { buildReaderNavigation, type NavigationNode } from "../lib/navigation"
import ReaderChrome from "../components/reader-chrome"
import "./globals.css"

const site = getSiteMetadata()

export const metadata: Metadata = {
  title: {
    default: site.title,
    template: `%s | ${site.title}`,
  },
  metadataBase: new URL(`https://${site.canonicalHostname}`),
  alternates: {
    canonical: canonicalUrl(site.canonicalHostname, "/"),
  },
}

function toClientNode(node: NavigationNode): NavigationNode {
  return {
    slugs: [...node.slugs],
    url: node.url,
    title: node.title,
    isFolder: node.isFolder,
    children: node.children.map(toClientNode),
  }
}

/**
 * Reader shell: site header, persistent desktop section sidebar, reading
 * column, footer. Sidebar labels and routes come from the generic
 * navigation tree built from staged pages and generated metadata roots;
 * active state comes from the URL. On phones the sidebar becomes a Browse
 * panel with the same tree plus the active root's generic groups. No
 * Fumadocs UI is used anywhere.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const metadata = getSiteMetadata()
  const pages = source.getPages().map((page) => ({
    slugs: page.slugs,
    url: page.url,
    data: page.data,
    path: page.path,
  }))
  const navigation = buildReaderNavigation(pages, metadata.navigation)
  const roots = navigation.roots.map(toClientNode)
  return (
    <html lang="en">
      <body className="bg-white text-neutral-900 antialiased">
        <ReaderChrome title={metadata.title} roots={roots}>
          {children}
        </ReaderChrome>
      </body>
    </html>
  )
}
