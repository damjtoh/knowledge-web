"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { ChevronsUpDown, Search } from "lucide-react"
import { AppearanceProvider } from "./appearance-control"
import { OfflineCue, OfflineProvider } from "./offline-save"
import SearchDialog, { SEARCH_INPUT_ID } from "./search-dialog"
import { AppSidebar } from "./app-sidebar"
import { VaultSheet } from "./vault-sheet"
import ReadingBreadcrumbs from "./reading-breadcrumbs"
import { Separator } from "./ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "./ui/sidebar"
import type { NavigationNode } from "../lib/navigation"
import type { ProjectionDestination } from "../lib/site"

function normalize(path: string | null): string {
  if (!path || path === "/") return "/"

  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

/**
 * Closes the registry mobile sidebar sheet whenever the route changes.
 *
 * Plain anchors navigate, so leaving the drawer is normal page history.
 * This must live inside SidebarProvider to read the registry sidebar
 * state; it renders no DOM.
 */
function CloseMobileSidebarOnNavigate() {
  const pathname = normalize(usePathname())
  const { setOpenMobile } = useSidebar()

  useEffect(() => {
    setOpenMobile(false)
  }, [pathname, setOpenMobile])

  return null
}

/**
 * Reading-inset header.
 *
 * Lives inside SidebarProvider to read the desktop sidebar state. The
 * header Search icon is the only search entry on phones and when the
 * desktop sidebar is collapsed; with the sidebar open, the sidebar
 * Search row owns desktop search, so the icon hides from md up. The
 * phone brand row is a button only when destinations exist; otherwise it
 * is a plain title.
 */
function ReaderHeader({
  title,
  roots,
  hasDestinations,
  vaultOpen,
  onVaultOpen,
  onSearch,
}: {
  title: string
  roots: NavigationNode[]
  hasDestinations: boolean
  vaultOpen: boolean
  onVaultOpen: () => void
  onSearch: (origin: HTMLElement | null) => void
}) {
  const { state } = useSidebar()

  return (
    <header className="reader-header flex h-11 max-md:h-16 min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-4">
      <div className="reader-header-trail flex min-w-0 max-w-full flex-1 items-center gap-2">
        <SidebarTrigger className="-ml-1 size-7 rounded-md border border-border bg-card" />
        <div className="max-md:hidden md:contents">
          <Separator orientation="vertical" className="mr-2 hidden h-4 w-px md:block" />
          <ReadingBreadcrumbs roots={roots} siteTitle={title} />
        </div>
        {hasDestinations ? (
          <button
            type="button"
            className="flex h-8 min-w-0 flex-1 items-center gap-2 md:hidden"
            aria-haspopup="dialog"
            aria-expanded={vaultOpen}
            onClick={onVaultOpen}
          >
            <span className="truncate text-sm font-bold text-primary">{title}</span>
            <ChevronsUpDown
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          </button>
        ) : (
          <span className="flex h-8 min-w-0 flex-1 items-center md:hidden">
            <span className="truncate text-sm font-bold text-primary">{title}</span>
          </span>
        )}
      </div>
      <div className="reader-header-actions ml-auto flex min-w-0 flex-wrap items-center gap-2 max-md:gap-1.5">
        <OfflineCue />
        <button
          type="button"
          className={
            state === "collapsed"
              ? "reader-search-trigger reader-search-header inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-0 hover:bg-muted"
              : "reader-search-trigger reader-search-header inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-0 hover:bg-muted md:hidden"
          }
          aria-label="Search"
          onClick={(event) => onSearch(event.currentTarget)}
        >
          <Search aria-hidden="true" className="size-4 text-muted-foreground" />
        </button>
      </div>
    </header>
  )
}

/**
 * Reader shell adapted from registry sidebar-11.
 *
 * The desktop sidebar is the registry Sidebar (offcanvas, fully hidden,
 * no icon rail) with a SidebarHeader (projection switcher, Home,
 * Search), SidebarContent (published tree), and SidebarFooter
 * (appearance plus offline status/actions). The reading inset holds a
 * header with the registry SidebarTrigger, Separator, Breadcrumb route
 * trail, a compact phone-only offline cue (only for meaningful states),
 * and a Search icon (phone, or desktop with the sidebar collapsed), plus
 * the reading column. There is no page footer: the old footer offline control moved
 * into the sidebar footer. Block sample data is not used: shell
 * structure only.
 *
 * Phone navigation is the registry mobile sidebar Sheet: the same real
 * AppSidebar slides in from the left over a dimmed overlay. The registry
 * Sheet primitive owns focus containment, Escape and overlay dismissal,
 * and background scroll lock; dismissing returns focus to the trigger.
 * With owner-declared destinations the phone header brand row is a
 * button opening its own VaultSheet bottom sheet, so vaults switch
 * without opening the drawer; with none it is a plain title and no sheet
 * mounts.
 * The registry SidebarTrigger is visible at every width and routes to
 * the mobile sheet below 768px. One OfflineProvider at the shell root
 * shares a single mounted offline state between the sidebar footer and
 * the closed-phone header cue; the cue is display-only and never starts
 * a save. Choosing appearance or opening the drawer never starts a
 * save. Plain anchors navigate, so selecting a page closes the drawer
 * through the route change without adding drawer state to URL history.
 * There is one Search dialog: all trigger controls and Command+K/
 * Control+K share its open state, and closing it returns focus to the
 * control that had focus before it opened.
 */
export default function ReaderShell({
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
  const [searchOpen, setSearchOpen] = useState(false)
  // Phone vault sheet state: the header brand button opens its own
  // VaultSheet instance. The brand button is only reachable when the
  // drawer is closed (and the drawer switcher only inside it), so the
  // two instances never stack and share no state.
  const [vaultOpen, setVaultOpen] = useState(false)
  // The control focused before Search opened; focus returns there on close.
  const searchOpenerRef = useRef<HTMLElement | null>(null)
  const searchOpenRef = useRef(false)
  searchOpenRef.current = searchOpen

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
    <div className="min-h-screen min-w-0 antialiased">
      <AppearanceProvider>
        <OfflineProvider>
          <SidebarProvider>
            <CloseMobileSidebarOnNavigate />
            <AppSidebar
              title={title}
              destinations={destinations}
              roots={roots}
              onSearch={openSearch}
            />
            <SidebarInset>
              <ReaderHeader
                title={title}
                roots={roots}
                hasDestinations={destinations.length > 0}
                vaultOpen={vaultOpen}
                onVaultOpen={() => setVaultOpen(true)}
                onSearch={openSearch}
              />
              <div className="reader-shell mx-auto flex w-full min-w-0 max-w-275 gap-8 px-4 pt-6 pb-12 max-md:flex-col max-md:gap-4 max-md:pt-5 max-md:pb-8">
                <div className="reader-main max-w-full min-w-0 flex-1 overflow-x-clip p-0">
                  {children}
                </div>
              </div>
              <SearchDialog open={searchOpen} onOpenChange={handleSearchOpenChange} />
              {destinations.length > 0 ? (
                <VaultSheet
                  current={title}
                  destinations={destinations}
                  open={vaultOpen}
                  onOpenChange={setVaultOpen}
                />
              ) : null}
            </SidebarInset>
          </SidebarProvider>
        </OfflineProvider>
      </AppearanceProvider>
    </div>
  )
}
