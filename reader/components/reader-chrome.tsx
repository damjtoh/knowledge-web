"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import AppearanceControl, { AppearanceProvider } from "./appearance-control"
import OfflineSave, { OfflineCue, OfflineProvider } from "./offline-save"
import { ProjectionSwitcher } from "./projection-switcher"
import SearchDialog, { SEARCH_INPUT_ID } from "./search-dialog"
import ReaderTree from "./sidebar"
import { AppSidebar } from "./app-sidebar"
import ReadingBreadcrumbs from "./reading-breadcrumbs"
import { Separator } from "./ui/separator"
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetTitle } from "./ui/sheet"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar"
import type { NavigationNode } from "../lib/navigation"
import type { ProjectionDestination } from "../lib/site"

function normalize(path: string | null): string {
  if (!path || path === "/") return "/"

  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

/**
 * Reader shell adapted from registry sidebar-11.
 *
 * The desktop sidebar is the registry Sidebar (offcanvas, fully hidden,
 * no icon rail) with a SidebarHeader (projection switcher, Home,
 * Search), SidebarContent (published tree), and SidebarFooter
 * (appearance plus offline status/actions). The reading inset holds a
 * header with the registry SidebarTrigger, Separator, Breadcrumb route
 * trail, a compact phone-only offline cue, and Search/Browse actions,
 * plus the reading column. There is no page footer: the old footer
 * offline control moved into the sidebar and drawer footers. Block
 * sample data is not used: shell structure only.
 *
 * Phone navigation is the registry Sheet drawer (side left, full
 * viewport, safe-area aware) with the same published tree: a fixed header
 * with a visible Close, Home and Search actions, a scrollable tree
 * middle, and a registry SheetFooter with appearance plus detailed
 * offline actions that stays reachable while the tree scrolls. The Sheet
 * primitive owns focus containment, Escape dismissal, and background
 * scroll lock; dismissing returns focus to the Browse toggle. One
 * OfflineProvider at the shell root shares a single mounted offline
 * state between the desktop footer, the drawer footer, and the closed-
 * phone header cue; the cue is display-only and never starts a save.
 * Choosing appearance or opening the drawer never starts a save.
 * Plain anchors navigate, so selecting a page closes the drawer through
 * the route change without adding drawer state to URL history. There is
 * one Search dialog: all trigger controls and Command+K/Control+K share
 * its open state, and closing it returns focus to the control that had
 * focus before it opened.
 */
export default function ReaderChrome({
  title,
  destinations,
  roots,
  children,
}: {
  title: string
  destinations: ProjectionDestination[]
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
  // close the phone drawer whenever the route changes.
  useEffect(() => {
    setBrowseOpen(false)
  }, [pathname])

  const handleBrowseOpenChange = useCallback((open: boolean) => {
    setBrowseOpen(open)

    if (!open) {
      toggleRef.current?.focus()
    }
  }, [])

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
      <AppearanceProvider>
        <OfflineProvider>
          <SidebarProvider>
            <AppSidebar
              title={title}
              destinations={destinations}
              roots={roots}
              onSearch={openSearch}
            />
            <SidebarInset>
              <header className="reader-header">
                <div className="reader-header-trail">
                  <SidebarTrigger className="-ml-1 max-md:hidden" />
                  <Separator orientation="vertical" className="mr-2 hidden md:block" />
                  <ReadingBreadcrumbs roots={roots} siteTitle={title} />
                </div>
                <div className="reader-header-actions">
                  <OfflineCue />
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
                <div className="reader-main">{children}</div>
              </div>
              <Sheet open={browseOpen} onOpenChange={handleBrowseOpenChange}>
                <SheetContent
                  id="reader-browse-panel"
                  side="left"
                  showCloseButton={false}
                  keepMounted
                  className="reader-phone-drawer"
                >
                  <div className="reader-phone-drawer-header">
                    <SheetTitle>Browse</SheetTitle>
                    <SheetClose className="reader-drawer-close">Close</SheetClose>
                  </div>
                  <div className="reader-phone-drawer-switcher">
                    <ProjectionSwitcher current={title} destinations={destinations} />
                  </div>
                  <div className="reader-phone-drawer-actions">
                    <a className="reader-drawer-home" href="/">
                      Home
                    </a>
                    <button
                      type="button"
                      className="reader-search-trigger"
                      onClick={(event) => openSearch(event.currentTarget)}
                    >
                      Search
                    </button>
                  </div>
                  <div className="reader-phone-drawer-tree">
                    <ReaderTree roots={roots} />
                  </div>
                  <SheetFooter className="reader-phone-drawer-footer">
                    <AppearanceControl />
                    <OfflineSave />
                  </SheetFooter>
                </SheetContent>
              </Sheet>
              <SearchDialog open={searchOpen} onOpenChange={handleSearchOpenChange} />
            </SidebarInset>
          </SidebarProvider>
        </OfflineProvider>
      </AppearanceProvider>
    </div>
  )
}
