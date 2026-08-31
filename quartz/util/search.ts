export interface ParsedQuery {
  tags: string[]
  query: string
}

/**
 * Parse a search input into tag filters and free-text query.
 * Supports `tag:foo` prefix (case-insensitive) and legacy `#foo`.
 * Multiple `tag:` prefixes combine with AND. Tag comparison is case-insensitive
 * downstream, so tags are returned as provided (trimmed) but filtering lowercases.
 * Public-safe: operates only on the input string.
 */
export function parseSearchQuery(input: string): ParsedQuery {
  const raw = input.trim()
  if (raw.length === 0) return { tags: [], query: "" }
  const tokens = raw.split(/\s+/).filter(Boolean)
  const tags: string[] = []
  const queryParts: string[] = []
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower.startsWith("tag:") && token.length > 4) {
      const tag = token.slice(4).trim()
      if (tag.length > 0) tags.push(tag)
    } else if (token.startsWith("#") && token.length > 1) {
      const tag = token.slice(1).trim()
      if (tag.length > 0) tags.push(tag)
    } else if (token === "#" || lower === "tag:") {
      // bare prefix, ignore
    } else {
      queryParts.push(token)
    }
  }
  return { tags, query: queryParts.join(" ").trim() }
}

/**
 * Returns true if itemTags satisfy all requiredTags (AND).
 * Comparison is case-insensitive.
 */
export function matchesTags(itemTags: string[] = [], requiredTags: string[] = []): boolean {
  if (requiredTags.length === 0) return true
  const lowerSet = new Set(itemTags.map((t) => t.toLowerCase()))
  return requiredTags.every((req) => lowerSet.has(req.toLowerCase()))
}

/**
 * Filter items by required tags (AND, case-insensitive).
 * Pure, does not mutate input.
 */
export function filterByTags<T extends { tags: string[] }>(
  items: T[],
  requiredTags: string[],
): T[] {
  if (requiredTags.length === 0) return [...items]
  return items.filter((item) => matchesTags(item.tags ?? [], requiredTags))
}

/**
 * Derive folder path from a slug.
 * For "notes/project-alpha" -> "notes"
 * For "a/b/c/d" -> "a/b/c"
 * For "index" or "notes" (top-level) -> ""
 * For "notes/index" -> "notes"
 */
export function getFolderPath(slug: string): string {
  if (!slug) return ""
  const clean = slug.replace(/^\/+|\/+$/g, "")
  if (!clean) return ""
  const parts = clean.split("/").filter(Boolean)
  if (parts.length <= 1) return ""
  return parts.slice(0, -1).join("/")
}

/**
 * Display string for folder context. Empty folder returns "" (caller may hide).
 */
export function getFolderDisplay(slug: string): string {
  return getFolderPath(slug)
}

/**
 * Returns true if any tag contains query substring case-insensitive.
 */
export function matchesTagSubstring(itemTags: string[] = [], query: string): boolean {
  if (!query) return false
  const q = query.toLowerCase()
  return itemTags.some((tag) => tag.toLowerCase().includes(q))
}

/**
 * Rank items so title matches appear above content-only matches.
 * Stable: preserves original order within each group.
 * Query match is case-insensitive substring on title.
 */
export function rankByTitleBoost<T extends { title: string }>(items: T[], query: string): T[] {
  if (!query) return [...items]
  const q = query.toLowerCase()
  const withTitle: T[] = []
  const without: T[] = []
  for (const item of items) {
    const title = (item.title ?? "").toLowerCase()
    if (title.includes(q)) withTitle.push(item)
    else without.push(item)
  }
  return [...withTitle, ...without]
}
