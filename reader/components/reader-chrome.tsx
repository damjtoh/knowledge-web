"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import AppearanceControl from "./appearance-control"
import OfflineSave from "./offline-save"
import SearchDialog, { SEARCH_INPUT_ID } from "./search-dialog"
import Sidebar from "./sidebar"
import type { NavigationNode } from "../lib/navigation"

function normalize(path: string | null): string {
  if (!path || path === "/") return "/"

  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

/**
 * Reader shell: site header with phone-only Search and Browse controls, the
 * published folder-and-note tree (persistent on desktop with its own Search
 * control, collapsible panel on phones), the reading column, and the footer.
 *
 * There is one navigation model: the same generic tree feeds desktop and
 * phone. The toggle keeps no URL or history state, so browser Back always
 * moves through real page history. There is one Search dialog: both trigger
 * controls and Command+K/Control+K share its open state, and closing it
 * returns focus to the control that had focus before it opened.
 */
export default function ReaderChrome({
  title,
  roots,
  children,
}: {
  title: string
  roots: NavigationNode[]
  children: React.ReactNode
}) {
  const [browseOpen, setBrowseOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const pathname = normalize(usePathname())
  const toggleRef = useRef<HTMLButtonElement>(null)
  // The control focused before Search opened; focus returns there on close.
  const searchOpenerRef = useRef<HTMLElement | null>(null)
  const searchOpenRef = useRef(false)
  searchOpenRef.current = searchOpen

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

  const openSearch = useCallback((origin: HTMLElement | null) => {
    searchOpenerRef.current = origin
    setSearchOpen(true)
  }, [])

  const handleSearchOpenChange = useCallback((open: boolean) => {
    setSearchOpen(open)

    if (!open) {
      const opener = searchOpenerRef.current
      searchOpenerRef.current = null
      opener?.focus()
    }
  }, [])

  // One global shortcut: Command+K or Control+K opens Search, or focuses
  // its input when already open. preventDefault wins over the browser
  // find shortcut; a single listener means no double-open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()

        if (searchOpenRef.current) {
          document.getElementById(SEARCH_INPUT_ID)?.focus()
        } else {
          searchOpenerRef.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null
          setSearchOpen(true)
        }
      }
    }

    document.addEventListener("keydown", onKeyDown)

    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <div
      className="reader-chrome min-h-screen bg-white text-neutral-900 antialiased dark:bg-neutral-950 dark:text-neutral-100"
      data-browse={browseOpen ? "open" : "closed"}
    >
      <header className="reader-header bg-white dark:bg-neutral-950">
        <a className="reader-home" href="/">
          {title}
        </a>
        <div className="reader-header-actions">
          <AppearanceControl />
          <button
            type="button"
            className="reader-search-trigger reader-search-header"
            onClick={(event) => openSearch(event.currentTarget)}
          >
            Search
          </button>
          <button
            ref={toggleRef}
            type="button"
            className="reader-browse-toggle shrink-0"
            aria-expanded={browseOpen}
            aria-controls="reader-browse-panel"
            onClick={() => setBrowseOpen((open) => !open)}
          >
            Browse
          </button>
        </div>
      </header>
      <div className="reader-shell">
        <aside
          id="reader-browse-panel"
          className="reader-sidebar rounded-lg bg-white dark:bg-neutral-950"
        >
          <button
            type="button"
            className="reader-search-trigger reader-search-sidebar"
            onClick={(event) => openSearch(event.currentTarget)}
          >
            <span>Search</span>
            <kbd aria-hidden="true">⌘K</kbd>
          </button>
          <Sidebar roots={roots} />
        </aside>
        <main className="reader-main">{children}</main>
      </div>
      <SearchDialog open={searchOpen} onOpenChange={handleSearchOpenChange} />
      <footer className="reader-footer">
        <span>{title}</span>
        <OfflineSave />
      </footer>
    </div>
  )
}
