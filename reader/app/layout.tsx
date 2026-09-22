import type { Metadata } from "next"
import { getSiteIdentity, canonicalUrl } from "../lib/site"
import { source } from "../lib/source"
import { getAreaEntries, getTravelGroups } from "../lib/navigation"
import ReaderChrome from "../components/reader-chrome"
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
 * active state comes from the URL. On phones the sidebar becomes a Browse
 * panel with the same area entries and Travel groups. No Fumadocs UI is
 * used anywhere.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const areas = getAreaEntries((slugs) => source.getPage(slugs) as never)
  const travelGroups = getTravelGroups(
    source.getPages().map((page) => ({ slugs: page.slugs, url: page.url, data: page.data })),
  )
  return (
    <html lang="en">
      <body>
        <ReaderChrome title={identity.title} areas={areas} travelGroups={travelGroups}>
          {children}
        </ReaderChrome>
      </body>
    </html>
  )
}
