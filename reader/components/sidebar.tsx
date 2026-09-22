"use client"

import { usePathname } from "next/navigation"
import type { NavigationNode } from "../lib/navigation"

function normalize(path: string): string {
  if (!path || path === "/") return "/"
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

/**
 * Persistent published-section navigation. Labels and routes come from
 * staged content through the generic navigation tree (server); the active
 * section and current page come from the URL through normal browser
 * history. No custom history stack is used.
 */
export default function Sidebar({ roots }: { roots: NavigationNode[] }) {
  const pathname = normalize(usePathname() ?? "/")
  return (
    <nav aria-label="Published sections" className="reader-sidebar-nav">
      <ul>
        {roots.map((root) => {
          const url = normalize(root.url)
          const isExact = pathname === url
          const isActive =
            isExact || (url !== "/" && (pathname === url || pathname.startsWith(`${url}/`)))
          return (
            <li key={url}>
              <a
                href={root.url}
                aria-current={isExact ? "page" : isActive ? "true" : undefined}
                data-active={isActive ? "true" : undefined}
                className={isActive ? "is-active" : undefined}
              >
                {root.title}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
