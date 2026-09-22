"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import Sidebar from "./sidebar"
import type { AreaEntry, PageRef } from "../lib/navigation"

export interface TravelGroupList {
  upcoming: PageRef[]
  past: PageRef[]
  preferences: PageRef[]
  more: PageRef[]
}

function normalize(path: string | null): string {
  if (!path || path === "/") return "/"
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

function GroupLinks({ heading, pages }: { heading: string; pages: PageRef[] }) {
  if (pages.length === 0) return null
  return (
    <section aria-label={heading} className="reader-group reader-nav-group">
      <h2>{heading}</h2>
      <ul className="reader-group-list">
        {pages.map((page) => (
          <li key={page.url}>
            <a href={page.url}>{page.title}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Reader shell: site header with a phone-only Browse toggle, the Shared
 * area sidebar (persistent on desktop, collapsible panel on phones), the
 * reading column, and the footer.
 *
 * There is one navigation model: the same area entries and the same Travel
 * folder groups feed desktop and phone. The toggle keeps no URL or history
 * state, so browser Back always moves through real page history.
 */
export default function ReaderChrome({
  title,
  areas,
  travelGroups,
  children,
}: {
  title: string
  areas: AreaEntry[]
  travelGroups: TravelGroupList
  children: React.ReactNode
}) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const pathname = normalize(usePathname())
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Plain anchors navigate, so leaving Browse is normal page history:
  // close the phone panel whenever the route changes.
  useEffect(() => {
    setBrowseOpen(false)
  }, [pathname])

  // Escape closes the phone panel and returns focus to the toggle.
  useEffect(() => {
    if (!browseOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBrowseOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [browseOpen])

  const inTravel = pathname === "/travel" || pathname.startsWith("/travel/")

  return (
    <div className="reader-chrome" data-browse={browseOpen ? "open" : "closed"}>
      <header className="reader-header">
        <a className="reader-home" href="/">
          {title}
        </a>
        <button
          ref={toggleRef}
          type="button"
          className="reader-browse-toggle"
          aria-expanded={browseOpen}
          aria-controls="reader-browse-panel"
          onClick={() => setBrowseOpen((open) => !open)}
        >
          Browse
        </button>
      </header>
      <div className="reader-shell">
        <aside id="reader-browse-panel" className="reader-sidebar">
          <Sidebar areas={areas} />
          {inTravel ? (
            <nav aria-label="Travel sections" className="reader-nav-travel">
              <GroupLinks heading="Upcoming trips" pages={travelGroups.upcoming} />
              <GroupLinks heading="Past trips" pages={travelGroups.past} />
              <GroupLinks heading="Preferences" pages={travelGroups.preferences} />
              <GroupLinks heading="More in Travel" pages={travelGroups.more} />
            </nav>
          ) : null}
        </aside>
        <main className="reader-main">{children}</main>
      </div>
      <footer className="reader-footer">
        <span>{title}</span>
      </footer>
    </div>
  )
}
