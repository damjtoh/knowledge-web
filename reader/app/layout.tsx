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
 * Reader shell: site header, persistent desktop tree sidebar, reading
 * column, footer. Sidebar labels and routes come from the generic
 * navigation tree built from staged pages and generated metadata roots;
 * active state comes from the URL. On phones the sidebar becomes a Browse
 * panel with the same tree. No
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * Appearance bootstrap: apply the saved explicit choice (or the
         * device theme when no choice is saved) before first paint so
         * switching modes restores without a light/dark flash. Runs in
         * the static export with no server or build input.
         */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var k="knowledge-reader-appearance";var s=null;try{s=localStorage.getItem(k)}catch(e){}var m="light";try{m=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){}var v=s==="light"||s==="dark"?s:m;var d=document.documentElement;d.classList.toggle("dark",v==="dark");d.setAttribute("data-appearance",s==="light"||s==="dark"?v:"system");}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <ReaderChrome title={metadata.title} roots={roots}>
          {children}
        </ReaderChrome>
      </body>
    </html>
  )
}
