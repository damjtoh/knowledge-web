import { docTitle } from "./title"

export interface AreaEntry {
  slugs: string[]
  url: string
  title: string
}

export interface PageRef {
  slugs: string[]
  url: string
  title: string
}

type PageLike = {
  slugs: string[]
  url: string
  data: unknown
}

/**
 * The five Shared areas of the vertical slice. Slugs are the staged
 * routes; labels and urls always come from staged pages via getAreaEntries.
 * `mica` and any other staged tree stays out of the reader journey.
 */
export const SHARED_AREA_SLUGS: string[][] = [
  ["travel"],
  ["finance"],
  ["pets"],
  ["life-planning"],
  ["inbox"],
]

export function toPageRef(page: PageLike): PageRef {
  return { slugs: page.slugs, url: page.url, title: docTitle(page.data, page.slugs) }
}

export function getAreaEntries(getPage: (slugs: string[]) => PageLike | undefined): AreaEntry[] {
  const out: AreaEntry[] = []
  for (const slugs of SHARED_AREA_SLUGS) {
    const page = getPage(slugs)
    if (!page) continue
    out.push({ slugs, url: page.url, title: docTitle(page.data, slugs) })
  }
  return out
}

function sortRefs(refs: PageRef[]): PageRef[] {
  return refs.sort((a, b) => a.title.localeCompare(b.title))
}

/**
 * Travel-only folder groups for the area page. Lists stay bounded to the
 * Travel journey: trip-level pages under upcoming/past, all preference
 * notes, and direct Travel notes (wishlist, visited). No type collections.
 */
export function getTravelGroups(pages: PageLike[]): {
  upcoming: PageRef[]
  past: PageRef[]
  preferences: PageRef[]
  more: PageRef[]
} {
  const refs = pages.map(toPageRef)
  const upcoming = refs.filter(
    (p) => p.slugs[0] === "travel" && p.slugs[1] === "upcoming" && p.slugs.length === 3,
  )
  const past = refs.filter(
    (p) => p.slugs[0] === "travel" && p.slugs[1] === "past" && p.slugs.length === 3,
  )
  const preferences = refs.filter((p) => p.slugs[0] === "travel" && p.slugs[1] === "preferences")
  const more = refs.filter(
    (p) => p.slugs[0] === "travel" && p.slugs.length === 2 && p.slugs[1] !== "travel",
  )
  return {
    upcoming: sortRefs(upcoming),
    past: sortRefs(past),
    preferences: sortRefs(preferences),
    more: sortRefs(more),
  }
}

export function getChildPages(pages: PageLike[], parentSlugs: string[]): PageRef[] {
  const out = pages
    .map(toPageRef)
    .filter(
      (p) =>
        p.slugs.length === parentSlugs.length + 1 &&
        parentSlugs.every((seg, i) => p.slugs[i] === seg),
    )
  return sortRefs(out)
}

export function humanizeSegment(seg: string): string {
  const spaced = seg.replace(/[-_]+/g, " ").trim()
  if (spaced === "") return seg
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface Crumb {
  title: string
  url?: string
  isCurrent: boolean
}

/**
 * Folder ancestry for breadcrumbs. Every prefix with a staged page links
 * to that page; intermediate folders without an index render as plain text.
 */
export function getBreadcrumbs(
  slugs: string[],
  getPage: (slugs: string[]) => PageLike | undefined,
): Crumb[] {
  const crumbs: Crumb[] = [{ title: "Home", url: "/", isCurrent: slugs.length === 0 }]
  slugs.forEach((_, i) => {
    const prefix = slugs.slice(0, i + 1)
    const isCurrent = i === slugs.length - 1
    const page = getPage(prefix)
    if (page) {
      const title = docTitle(page.data, prefix)
      crumbs.push(isCurrent ? { title, isCurrent } : { title, url: page.url, isCurrent })
    } else {
      const title = humanizeSegment(prefix[prefix.length - 1])
      crumbs.push(isCurrent ? { title, isCurrent } : { title, isCurrent: false })
    }
  })
  return crumbs
}
