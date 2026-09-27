"use client"

import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import Breadcrumbs from "./breadcrumbs"
import {
  crumbsFromRoots,
  hasRouteInRoots,
  slugsFromPathname,
  type Crumb,
  type NavigationNode,
} from "../lib/navigation"

/**
 * Route-derived crumbs from the published tree.
 *
 * Thin client wrapper over the shared `crumbsFromRoots` core in
 * lib/navigation (single derivation for the breadcrumb family): the
 * pathname supplies the slugs, the published roots supply the tree
 * titles, and routes outside visible navigation fall back to humanized
 * slugs here. Kept exported so existing importers keep working.
 */
export function resolveReadingBreadcrumbs(roots: NavigationNode[], pathname: string): Crumb[] {
  return crumbsFromRoots(roots, slugsFromPathname(pathname))
}

function normalizePathname(value: string | null): string {
  if (!value || value === "/") return "/"

  return value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value
}

function pageTitleFromDocument(siteTitle: string): string | null {
  try {
    const raw = document.title.trim()

    if (raw === "") return null
    const suffix = `| ${siteTitle.trim()}`

    if (raw.endsWith(suffix)) {
      const head = raw.slice(0, -suffix.length).trim()

      return head !== "" ? head : null
    }

    if (raw !== siteTitle.trim()) return raw

    return null
  } catch {
    return null
  }
}

/**
 * Reading-header trail beside the sidebar trigger.
 *
 * Client pathname keeps Back and direct URLs predictable; parents are
 * ordinary anchors. For published routes outside visible navigation the
 * current title enhances from the page's own document title (actual
 * staged title wins over the humanized slug) after hydration, without
 * embedding every staged title into every page. The static prerender
 * and first paint use the tree/humanized fallback so they agree.
 */
export default function ReadingBreadcrumbs({
  roots,
  siteTitle,
}: {
  roots: NavigationNode[]
  siteTitle: string
}) {
  const raw = usePathname()
  const pathname = normalizePathname(raw ?? "/")

  const base = useMemo(() => resolveReadingBreadcrumbs(roots, pathname), [roots, pathname])
  const [enhanced, setEnhanced] = useState<string | null>(null)

  useEffect(() => {
    setEnhanced(null)

    const slugs = slugsFromPathname(pathname)

    if (slugs.length === 0) return

    if (hasRouteInRoots(roots, slugs)) return

    const actual = pageTitleFromDocument(siteTitle)

    if (actual) setEnhanced(actual)
  }, [roots, pathname, siteTitle])

  const items = useMemo(() => {
    if (!enhanced || base.length === 0) return base

    const last = base[base.length - 1]

    if (!last.isCurrent || last.title === enhanced) return base

    return [...base.slice(0, -1), { title: enhanced, isCurrent: true }]
  }, [base, enhanced])

  return <Breadcrumbs items={items} />
}
