"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import AppearanceControl from "./appearance-control"
import Sidebar from "./sidebar"
import type { NavigationNode } from "../lib/navigation"
import { findActiveRoot } from "../lib/navigation"

function normalize(path: string | null): string {
  if (!path || path === "/") return "/"
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

function GroupLinks({ heading, nodes }: { heading: string; nodes: NavigationNode[] }) {
  if (nodes.length === 0) return null
  return (
    <section aria-label={heading} className="reader-group reader-nav-group">
      <h2>{heading}</h2>
      <ul className="reader-group-list">
        {nodes.map((node) => (
          <li key={node.url}>
            <a href={node.url}>{node.title}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Reader shell: site header with a phone-only Browse toggle, the published
 * section sidebar (persistent on desktop, collapsible panel on phones), the
 * reading column, and the footer.
 *
 * There is one navigation model: the same generic tree feeds desktop and
 * phone. On phones the Browse panel adds the active root's direct-note and
 * child-folder groups. The toggle keeps no URL or history state, so browser
 * Back always moves through real page history.
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

  const activeRoot = findActiveRoot(roots, pathname)
  const directNotes = activeRoot ? activeRoot.children.filter((child) => !child.isFolder) : []
  const childFolders = activeRoot ? activeRoot.children.filter((child) => child.isFolder) : []

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
          <Sidebar roots={roots} />
          {activeRoot && (directNotes.length > 0 || childFolders.length > 0) ? (
            <nav aria-label={`${activeRoot.title} sections`} className="reader-nav-groups">
              <GroupLinks heading="Notes" nodes={directNotes} />
              <GroupLinks heading="Folders" nodes={childFolders} />
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
