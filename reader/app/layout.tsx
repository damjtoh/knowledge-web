import type { Metadata } from "next"
import { getSiteIdentity, canonicalUrl } from "../lib/site"
import { source } from "../lib/source"
import { getAreaEntries } from "../lib/navigation"
import Sidebar from "../components/sidebar"
import "./globals.css"

const identity = getSiteIdentity()

export const metadata: Metadata = {
  title: {
    default: identity.title,
    template: `%s | ${identity.title}`,
  },
  metadataBase: new URL(`https://${identity.canonicalHostname}`),
  alternates: {
    canonical: canonicalUrl(identity.canonicalHostname, "/"),
  },
}

/**
 * Reader shell: site header, persistent desktop area sidebar, reading
 * column, footer. Sidebar labels and routes come from staged area pages;
 * active state comes from the URL. No Fumadocs UI is used anywhere.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const areas = getAreaEntries((slugs) => source.getPage(slugs) as never)
  return (
    <html lang="en">
      <body>
        <header className="reader-header">
          <a className="reader-home" href="/">
            {identity.title}
          </a>
        </header>
        <div className="reader-shell">
          <aside className="reader-sidebar">
            <Sidebar areas={areas} />
          </aside>
          <main className="reader-main">{children}</main>
        </div>
        <footer className="reader-footer">
          <span>{identity.title}</span>
        </footer>
      </body>
    </html>
  )
}
