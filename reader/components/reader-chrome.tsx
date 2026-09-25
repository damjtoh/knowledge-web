"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import AppearanceControl from "./appearance-control"
import OfflineSave from "./offline-save"
import SearchDialog, { SEARCH_INPUT_ID } from "./search-dialog"
import ReaderTree from "./sidebar"
import { AppSidebar } from "./app-sidebar"
import { Separator } from "./ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar"
import type { NavigationNode } from "../lib/navigation"

function normalize(path: string | null): string {
  if (!path || path === "/") return "/"

  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

/**
 * Reader shell adapted from registry sidebar-11.
 *
 * The desktop sidebar is the registry Sidebar (offcanvas, fully hidden,
 * no icon rail) with a SidebarHeader (current Web Projection, Home,
 * Search) and SidebarContent (published tree). The reading inset holds a
 * header with the registry SidebarTrigger, the reading column, and the
 * footer. Block sample data is not used: shell structure only.
 *
 * There is one navigation model: the same generic tree feeds the desktop
 * Sidebar and the transitional phone Browse panel. The Browse toggle keeps
 * no URL or history state, so browser Back always moves through real page
 * history. Hiding the desktop sidebar keeps the same mounted tree, so
 * restoring exposes identical branches. There is one Search dialog: all
 * trigger controls and Command+K/Control+K share its open state, and
 * closing it returns focus to the control that had focus before it
 * opened.
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
      className="reader-chrome min-h-screen antialiased"
      data-browse={browseOpen ? "open" : "closed"}
    >
      <SidebarProvider>
        <AppSidebar title={title} roots={roots} onSearch={openSearch} />
        <SidebarInset>
          <header className="reader-header">
            <SidebarTrigger className="-ml-1 max-md:hidden" />
            <Separator orientation="vertical" className="mr-2 hidden md:block" />
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
            <aside id="reader-browse-panel" className="reader-sidebar rounded-lg">
              <ReaderTree roots={roots} />
            </aside>
            <div className="reader-main">{children}</div>
          </div>
          <SearchDialog open={searchOpen} onOpenChange={handleSearchOpenChange} />
          <footer className="reader-footer">
            <span>{title}</span>
            <OfflineSave />
          </footer>
        </SidebarInset>
      </SidebarProvider>
    </div>
  )
}
