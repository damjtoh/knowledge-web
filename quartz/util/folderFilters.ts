import type { QuartzPluginData } from "../plugins/vfile"

export type FolderEntry = {
  slug: string
  title: string
  tags: string[]
  date?: string | Date | null
  description?: string
}

function normalize(str: string): string {
  return str.trim().toLowerCase()
}

/**
 * Returns true if the entry matches the query.
 * Query matches when title (case-insensitive substring) or any tag
 * (case-insensitive substring) contains the query.
 * Empty query matches all.
 */
export function matchesQuery(entry: FolderEntry, query: string): boolean {
  const q = normalize(query)
  if (q.length === 0) return true
  const title = (entry.title ?? "").toLowerCase()
  if (title.includes(q)) return true
  for (const tag of entry.tags ?? []) {
    if (tag.toLowerCase().includes(q)) return true
  }
  return false
}

/**
 * Returns true if entry contains all selectedTags (AND).
 * Tag comparison is exact (case-sensitive) to match stored tag values.
 * Empty selectedTags matches all.
 */
export function matchesTags(entry: FolderEntry, selectedTags: string[]): boolean {
  if (selectedTags.length === 0) return true
  const set = new Set(entry.tags ?? [])
  for (const t of selectedTags) {
    if (!set.has(t)) return false
  }
  return true
}

/**
 * Filter entries by query (title/tag substring) and selected tags (AND).
 * Pure, does not mutate input.
 */
export function filterEntries(
  entries: FolderEntry[],
  query: string,
  selectedTags: string[],
): FolderEntry[] {
  return entries.filter((e) => matchesQuery(e, query) && matchesTags(e, selectedTags))
}

function getTime(entry: FolderEntry): number | null {
  const d = entry.date
  if (!d) return null
  if (d instanceof Date) {
    const t = d.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof d === "string") {
    const t = Date.parse(d as string)
    return Number.isNaN(t) ? null : t
  }
  return null
}

function compareAlpha(a: FolderEntry, b: FolderEntry): number {
  const at = (a.title ?? "").toLowerCase()
  const bt = (b.title ?? "").toLowerCase()
  const c = at.localeCompare(bt)
  if (c !== 0) return c
  // tie-breaker for deterministic order
  return (a.slug ?? "").localeCompare(b.slug ?? "")
}

/**
 * Sort entries.
 * - "alpha": A–Z by title (case-insensitive), tie-breaker slug.
 * - "date": newest-first by date descending; entries with dates first,
 *   then fallback to alpha. Null/invalid dates treated as missing.
 * Pure, returns new array.
 */
export function sortEntries(entries: FolderEntry[], mode: "alpha" | "date"): FolderEntry[] {
  const copy = [...entries]
  if (mode === "alpha") {
    copy.sort(compareAlpha)
    return copy
  }
  // date mode
  copy.sort((a, b) => {
    const at = getTime(a)
    const bt = getTime(b)
    if (at !== null && bt !== null) {
      if (bt !== at) return bt - at
      return compareAlpha(a, b)
    }
    if (at !== null && bt === null) return -1
    if (at === null && bt !== null) return 1
    return compareAlpha(a, b)
  })
  return copy
}

/**
 * Build FolderEntry from QuartzPluginData (frontmatter-derived only).
 * Public-safe: uses only slug, frontmatter.title/tags, description, dates.
 */
export function toFolderEntry(data: QuartzPluginData): FolderEntry {
  const slug = (data.slug ?? "") as string
  const fm = (data.frontmatter ?? {}) as Record<string, unknown>
  const title = (fm.title as string) ?? ""
  const tags = Array.isArray(fm.tags)
    ? (fm.tags as string[]).filter((t) => typeof t === "string")
    : []
  // description fallback chain: data.description -> fm.description -> fm.socialDescription -> ""
  const rawDesc =
    (data as unknown as { description?: unknown }).description ??
    (fm.description as string | undefined) ??
    (fm.socialDescription as string | undefined) ??
    ""
  const description = typeof rawDesc === "string" ? rawDesc : ""
  // date: try getDate helper if available, else null
  let date: string | null = null
  try {
    // dynamic import would be async; use inline logic mimicking getDate
    const defaultDateType = (data as unknown as { defaultDateType?: string }).defaultDateType
    const dates = (data as unknown as { dates?: Record<string, unknown> }).dates
    if (defaultDateType && dates) {
      const d = dates[defaultDateType] as unknown
      if (d instanceof Date) date = d.toISOString()
      else if (typeof d === "string") {
        const parsed = new Date(d as string)
        if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString()
      }
    }
  } catch {
    date = null
  }
  return { slug, title, tags, date, description }
}

/**
 * Returns true if pathname belongs to a tag page (under /tags/).
 * Used to gate folder-filter UI so it does not inject on tag listings
 * that share the same .page-listing markup.
 */
export function isTagPagePath(pathname: string): boolean {
  // Segment-aware check: matches "tags" as an exact path segment
  return pathname.split("/").includes("tags")
}

/**
 * Distinct tags from entries, sorted alphabetically for stable UI.
 */
export function getDistinctTagsFromEntries(entries: FolderEntry[]): string[] {
  const set = new Set<string>()
  for (const e of entries) {
    for (const t of e.tags ?? []) {
      if (typeof t === "string" && t.length > 0) set.add(t)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}
