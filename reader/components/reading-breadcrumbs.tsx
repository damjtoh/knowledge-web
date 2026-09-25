"use client"

import { usePathname } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import Breadcrumbs from "./breadcrumbs"
import { humanizeSegment, type Crumb, type NavigationNode } from "../lib/navigation"

function normalizePathname(value: string | null): string {
  if (!value || value === "/") return "/"

  return value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value
}

function slugsFromPathname(pathname: string): string[] {
  const clean = normalizePathname(pathname)

  if (clean === "/") return []

  return clean
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg)
      } catch {
        return seg
      }
    })
}

/**
 * Route-derived crumbs from the published tree.
 *
 * Walks the same published roots the sidebar renders, so authored and
 * virtual folders keep their tree titles. Routes outside visible
 * navigation fall back to humanized slugs here; the component enhances
 * the current title from the page's own document title when one exists.
 * No new content source: roots come from staged allowlisted content and
 * the enhancement reads only the current page's rendered title.
 */
export function resolveReadingBreadcrumbs(roots: NavigationNode[], pathname: string): Crumb[] {
  const slugs = slugsFromPathname(pathname)

  if (slugs.length === 0) return [{ title: "Home", url: "/", isCurrent: true }]

  const nodes = new Map<string, NavigationNode>()

  const walk = (node: NavigationNode): void => {
    nodes.set(node.slugs.join("/"), node)

    for (const child of node.children) walk(child)
  }

  for (const root of roots) walk(root)

  const crumbs: Crumb[] = [{ title: "Home", url: "/", isCurrent: false }]

  slugs.forEach((_, i) => {
    const prefix = slugs.slice(0, i + 1)
    const key = prefix.join("/")
    const isCurrent = i === slugs.length - 1
    const node = nodes.get(key)

    if (node) {
      if (isCurrent) crumbs.push({ title: node.title, isCurrent })
      else crumbs.push({ title: node.title, url: node.url, isCurrent: false })

      return
    }

    const title = humanizeSegment(prefix[prefix.length - 1])
    crumbs.push(isCurrent ? { title, isCurrent } : { title, isCurrent: false })
  })

  return crumbs
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

    const nodes = new Map<string, NavigationNode>()

    const walk = (node: NavigationNode): void => {
      nodes.set(node.slugs.join("/"), node)

      for (const child of node.children) walk(child)
    }

    for (const root of roots) walk(root)

    if (nodes.has(slugs.join("/"))) return

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
