/**
 * Serializable rows for the browse surfaces: the home "Recently updated"
 * list and the folder page listings.
 *
 * Page objects carry functions and must not cross the server/client
 * boundary, so every row holds only strings and numbers. Dates come from
 * the staged `updated_at` stamp alone and reuse the strict validation in
 * `last-edited.ts`: missing, date-only, naive, and invalid stamps yield no
 * date instead of a guessed one. The visible label is a deterministic short
 * date taken from the stamp's own wall date (no build or viewer timezone, no
 * client clock), so static HTML and hydration always agree.
 */

import {
  parseUpdatedAt,
  updatedAtFromData,
  updatedAtMillis,
  type UpdatedAtInput,
} from "./last-edited"
import type { NavigationNode } from "./navigation"

/** Notes shown by the home "Recently updated" section. */
export const RECENT_NOTE_LIMIT = 8

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Machine time plus a short visible date such as `Sep 20, 2026`. */
export interface ShortUpdatedAt {
  isoDatetime: string
  label: string
}

/** Short date for a frontmatter `updated_at` value; null when not worth rendering. */
export function shortUpdatedAt(value: UpdatedAtInput): ShortUpdatedAt | null {
  const parsed = parseUpdatedAt(value)

  if (parsed === null) return null
  // `display` is `YYYY-MM-DD HH:MM ZONE`; the date part is the source wall date.
  const [year, month, day] = parsed.display.slice(0, 10).split("-")

  return {
    isoDatetime: parsed.isoDatetime,
    label: `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`,
  }
}

/** One note in the home "Recently updated" list. */
export interface RecentNote {
  title: string
  url: string
  /** Owning folder title; absent for notes published directly as roots. */
  parentTitle?: string
  isoDatetime: string
  label: string
}

/**
 * Newest notes by valid `updated_at` across the published navigation tree.
 *
 * Only leaf notes reachable from the navigation roots count; folders and
 * pages outside the roots never appear. Ties break by title, then route,
 * so the list is stable. Returns an empty list when no note has a valid
 * stamp, and callers omit the section.
 */
export function recentNotes(roots: NavigationNode[], limit = RECENT_NOTE_LIMIT): RecentNote[] {
  const stamped: Array<{ millis: number; note: RecentNote }> = []
  const seen = new Set<string>()

  const walk = (node: NavigationNode, parent: NavigationNode | undefined): void => {
    if (node.isFolder) {
      for (const child of node.children) walk(child, node)

      return
    }

    if (seen.has(node.url)) return
    seen.add(node.url)
    const value = updatedAtFromData(node.page?.data)
    const millis = updatedAtMillis(value)
    const short = shortUpdatedAt(value)

    if (millis === null || short === null) return
    const note: RecentNote = { title: node.title, url: node.url, ...short }

    if (parent) note.parentTitle = parent.title
    stamped.push({ millis, note })
  }

  for (const root of roots) walk(root, undefined)

  return stamped
    .sort(
      (a, b) =>
        b.millis - a.millis ||
        a.note.title.localeCompare(b.note.title) ||
        (a.note.url < b.note.url ? -1 : a.note.url > b.note.url ? 1 : 0),
    )
    .slice(0, limit)
    .map((entry) => entry.note)
}

/** One row of a folder page listing. */
export interface FolderRow {
  title: string
  url: string
  isFolder: boolean
  /** Direct child count for folder rows. */
  childCount?: number
  /** Short date for note rows with a valid stamp. */
  isoDatetime?: string
  dateLabel?: string
}

/** Rows for folder page nodes, keeping the navigation order. */
export function folderRows(nodes: NavigationNode[]): FolderRow[] {
  return nodes.map((node) => {
    const row: FolderRow = { title: node.title, url: node.url, isFolder: node.isFolder }

    if (node.isFolder) {
      row.childCount = node.children.length

      return row
    }

    const short = shortUpdatedAt(updatedAtFromData(node.page?.data))

    if (short !== null) {
      row.isoDatetime = short.isoDatetime
      row.dateLabel = short.label
    }

    return row
  })
}
