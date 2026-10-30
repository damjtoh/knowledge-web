import { isValidElement, type ReactNode } from "react"

/** Fewest in-page headings that earn a table of contents. */
export const MIN_TOC_ITEMS = 3

/** Heading shown in the table of contents: plain text plus its anchor id. */
export interface TocItem {
  id: string
  title: string
  /** 2 for `##`, 3 for `###`. */
  depth: 2 | 3
}

/** Page data carrying the Fumadocs MDX `toc` export. */
export interface TocSource {
  toc?: ReadonlyArray<{ title: ReactNode; url: string; depth: number }> | null
}

/** Plain text of a heading title; links and emphasis inside headings flatten. */
function textOf(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(textOf).join("")

  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)

  if (node === null || node === undefined || node === true || node === false) return ""

  return String(node)
}

/**
 * Table-of-contents items for a note, built at build time from the
 * `toc` Fumadocs MDX exports (heading ids come from the same pass, so the
 * anchors always exist). Only h2/h3 count; the h1 is the page title.
 * Notes with fewer than MIN_TOC_ITEMS such headings get no table.
 */
export function tocItemsFromData(data: TocSource | null | undefined): TocItem[] {
  const items: TocItem[] = []

  for (const entry of data?.toc ?? []) {
    const { depth, url } = entry

    if ((depth !== 2 && depth !== 3) || !url.startsWith("#")) continue
    const title = textOf(entry.title).trim()

    if (title === "") continue
    items.push({ id: url.slice(1), title, depth })
  }

  return items.length >= MIN_TOC_ITEMS ? items : []
}
