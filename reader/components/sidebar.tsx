"use client"

import { usePathname } from "next/navigation"
import type { AreaEntry } from "../lib/navigation"

function normalize(path: string): string {
  if (!path || path === "/") return "/"
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path
}

/**
 * Persistent Shared area navigation. Labels and routes come from staged
 * content (server); the active area and current page come from the URL
 * through normal browser history. No custom history stack is used.
 */
export default function Sidebar({ areas }: { areas: AreaEntry[] }) {
  const pathname = normalize(usePathname() ?? "/")
  return (
    <nav aria-label="Shared areas" className="reader-sidebar-nav">
      <ul>
        {areas.map((area) => {
          const url = normalize(area.url)
          const isExact = pathname === url
          const isActive =
            isExact || (url !== "/" && (pathname === url || pathname.startsWith(`${url}/`)))
          return (
            <li key={url}>
              <a
                href={area.url}
                aria-current={isExact ? "page" : isActive ? "true" : undefined}
                data-active={isActive ? "true" : undefined}
                className={isActive ? "is-active" : undefined}
              >
                {area.title}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
