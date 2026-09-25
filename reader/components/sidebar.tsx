"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import type { NavigationNode } from "../lib/navigation"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"

const STORAGE_KEY = "knowledge-reader-tree"

function normalize(path: string | null): string {
  if (!path || path === "/") return "/"

  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

/**
 * Folder branches open for a pathname: every folder whose route is the
 * page itself or an ancestor of it. Derived from the generic navigation
 * tree and the URL only, so the static prerender and the first client
 * paint agree.
 */
function ancestorBranches(roots: NavigationNode[], pathname: string): string[] {
  const open: string[] = []

  const walk = (node: NavigationNode): void => {
    if (node.isFolder) {
      const url = normalize(node.url)

      if (url !== "/" && (pathname === url || pathname.startsWith(`${url}/`))) {
        open.push(node.url)
      }
    }

    for (const child of node.children) walk(child)
  }

  for (const root of roots) walk(root)

  return open
}

/** Every folder route in the tree, used to drop stale session entries. */
function folderUrls(roots: NavigationNode[]): Set<string> {
  const urls = new Set<string>()

  const walk = (node: NavigationNode): void => {
    if (node.isFolder) urls.add(node.url)

    for (const child of node.children) walk(child)
  }

  for (const root of roots) walk(root)

  return urls
}

function readStored(): string[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)

    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)

    if (!Array.isArray(parsed)) return []

    return parsed.filter((entry): entry is string => typeof entry === "string")
  } catch {
    return []
  }
}

function ChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

interface TreeState {
  pathname: string
  isOpen: (url: string) => boolean
  setOpen: (url: string, open: boolean) => void
}

function TreeNode({ node, state }: { node: NavigationNode; state: TreeState }) {
  const url = normalize(node.url)
  const isExact = state.pathname === url
  const isAncestor = url !== "/" && !isExact && state.pathname.startsWith(`${url}/`)
  const isActive = isExact || isAncestor

  const link = (
    <a
      href={node.url}
      data-tree-link
      aria-current={isExact ? "page" : isAncestor ? "true" : undefined}
      data-active={isActive ? "true" : undefined}
      className={isActive ? "is-active" : undefined}
    >
      {node.title}
    </a>
  )

  if (!node.isFolder || node.children.length === 0) {
    return (
      <li data-tree-url={node.url}>
        <div className="reader-tree-row">{link}</div>
      </li>
    )
  }

  const open = state.isOpen(node.url)

  return (
    <li data-tree-url={node.url}>
      <Collapsible
        className="reader-tree-collapsible"
        open={open}
        onOpenChange={(next) => state.setOpen(node.url, next)}
      >
        <div className="reader-tree-row">
          {link}
          <CollapsibleTrigger
            className="reader-tree-toggle"
            aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`}
          >
            <ChevronIcon />
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent keepMounted className="reader-tree-panel">
          <ul className="reader-tree-children">
            {node.children.map((child) => (
              <TreeNode key={child.url} node={child} state={state} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

/**
 * Folder-and-note tree for the published roots. Root order follows
 * generated metadata and child order follows the navigation tree; this
 * component renders that order without rebuilding it.
 *
 * A folder keeps two separate controls: its name links to its own page
 * (authored or virtual) and a disclosure button opens its children
 * without navigating. Several branches stay expanded together. The
 * current page's ancestor branches open on arrival because visibility is
 * derived from the URL during render. A branch the reader deliberately
 * closes stays closed only while the pathname is unchanged: the close is
 * scoped to its page and any navigation (link or Back) releases it in
 * the same commit as the route change. Hand-opened branches persist in
 * session storage, so they survive page visits and browser Back within
 * the session. Links stay plain anchors, so all movement uses normal
 * static URLs and browser history.
 */
export default function Sidebar({ roots }: { roots: NavigationNode[] }) {
  const pathname = normalize(usePathname() ?? "/")
  // Branches the reader opened by hand. Merged with session storage
  // after first paint and written back on change.
  const [userOpened, setUserOpened] = useState<string[]>([])

  // Deliberate closes, scoped to the page where they happened.
  const [closed, setClosed] = useState<{ page: string; urls: string[] }>({
    page: pathname,
    urls: [],
  })

  const [hydrated, setHydrated] = useState(false)

  // Any navigation releases deliberate closes: the close belonged to
  // the previous page, and the new page arrives with its ancestors
  // expanded. A render-phase update applies the release in the same
  // commit as the route change, so Back and link navigations reopen
  // current-page ancestors without waiting for an effect.
  if (closed.page !== pathname) {
    setClosed({ page: pathname, urls: [] })
  }

  // Merge session-kept branches after first paint so the static
  // prerender and the first client paint render the same tree.
  useEffect(() => {
    const known = folderUrls(roots)
    setUserOpened((prev) =>
      Array.from(new Set([...prev, ...readStored().filter((url) => known.has(url))])),
    )
    setHydrated(true)
  }, [roots])

  useEffect(() => {
    if (!hydrated) return

    try {
      const known = folderUrls(roots)
      window.sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(userOpened.filter((url) => known.has(url))),
      )
    } catch {
      // Session persistence is a convenience; the tree works without it.
    }
  }, [roots, userOpened, hydrated])

  // A back/forward-cache restore reuses this document with its snapshot
  // state and fires no router navigation, so the render-phase reset
  // above cannot see it. Releasing deliberate closes on pageshow keeps a
  // restored page consistent with a fresh arrival: ancestors expand.
  // On a normal load the listener attaches after pageshow already fired
  // and the state just initialized, so the reset only ever acts on a
  // genuine restore.
  useEffect(() => {
    const onPageShow = () => setClosed({ page: pathname, urls: [] })
    window.addEventListener("pageshow", onPageShow)

    return () => window.removeEventListener("pageshow", onPageShow)
  }, [pathname])

  const ancestors = ancestorBranches(roots, pathname)
  const suppressed = closed.page === pathname ? closed.urls : []

  const state: TreeState = {
    pathname,
    isOpen: (url) =>
      userOpened.includes(url) || (ancestors.includes(url) && !suppressed.includes(url)),
    setOpen: (url, open) => {
      if (open) {
        setUserOpened((prev) => (prev.includes(url) ? prev : [...prev, url]))
        setClosed((prev) =>
          prev.page === pathname && prev.urls.includes(url)
            ? { page: prev.page, urls: prev.urls.filter((entry) => entry !== url) }
            : prev,
        )
      } else {
        setUserOpened((prev) => prev.filter((entry) => entry !== url))
        setClosed((prev) =>
          prev.page === pathname
            ? {
                page: prev.page,
                urls: prev.urls.includes(url) ? prev.urls : [...prev.urls, url],
              }
            : { page: pathname, urls: [url] },
        )
      }
    },
  }

  return (
    <nav aria-label="Published sections" className="reader-sidebar-nav">
      <ul className="reader-tree">
        {roots.map((root) => (
          <TreeNode key={root.url} node={root} state={state} />
        ))}
      </ul>
    </nav>
  )
}
