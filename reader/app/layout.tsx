import type { Metadata } from "next"
import { getSiteIdentity, canonicalUrl } from "../lib/site"
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
 * Minimal reader shell: site header, reading column, footer.
 * No Fumadocs UI is used anywhere in this tree.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="reader-header">
          <a className="reader-home" href="/">
            {identity.title}
          </a>
        </header>
        <main className="reader-main">{children}</main>
        <footer className="reader-footer">
          <span>{identity.title}</span>
        </footer>
      </body>
    </html>
  )
}
