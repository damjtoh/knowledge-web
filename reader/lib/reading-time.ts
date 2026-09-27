/**
 * Build-time read-time heuristic (design parity item 1, decision 2).
 *
 * Quality is explicitly not a concern: words count whitespace-separated
 * tokens over rendered text nodes, minutes = max(1, round(words / 200)).
 * The transformer writes `read_minutes` onto `file.data.frontmatter` (the
 * parsed frontmatter the MDX loader already split from the body, so no
 * YAML node exists in the tree) where it flows to `page.data` like
 * `updated_at`. Overwriting keeps rebuilds idempotent: the count never
 * sees its own output, so input caching cannot double-inject.
 */

/** Words read per minute for the heuristic. */
export const WORDS_PER_MINUTE = 200

/** Staged frontmatter field carrying the computed minutes. */
export interface ReadMinutesSource {
  read_minutes?: string | number | null
}

/** Minimal mdast shape for the word walk. */
interface ReadingTextNode {
  type: string
  value?: string
  children?: ReadingTextNode[]
}

/**
 * Minimal remark file shape.
 *
 * VFile satisfies the path member at registration (the same precedent as
 * the relative-links plugin, whose `{ path: string }` file keeps the
 * Pluggable assignment valid); the data member types the frontmatter
 * write, reached through `in` narrowing without typeof or assertions.
 */
type ReadingTimeFile = { path?: string } | { data?: { frontmatter?: ReadMinutesSource } }

function wordsInText(value: string | undefined): number {
  if (value === undefined) return 0
  const trimmed = value.trim()

  if (trimmed === "") return 0

  return trimmed.split(/\s+/).length
}

/** Heuristic minutes for a word count, minimum one. */
export function estimateReadMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE))
}

/**
 * Read `read_minutes` from loader page data.
 *
 * Accepts numeric or numeric-string frontmatter; clamps to minimum one so
 * a zero or negative value never renders "0 min read". Returns undefined
 * for missing or non-numeric values so callers omit the segment.
 */
export function readMinutesFromData(
  data: ReadMinutesSource | null | undefined,
): number | undefined {
  if (data === null || data === undefined) return undefined
  const raw: string | number | null | undefined = data.read_minutes ?? undefined

  if (raw === null || raw === undefined) return undefined
  const text = String(raw).trim()

  if (text === "") return undefined
  const numeric = Number(text)

  if (!Number.isFinite(numeric)) return undefined

  return Math.max(1, Math.round(numeric))
}

/** Remark plugin writing `read_minutes` into parsed frontmatter. */
export default function remarkReadingTime(): (
  tree: ReadingTextNode,
  file: ReadingTimeFile,
) => void {
  return (tree: ReadingTextNode, file: ReadingTimeFile): void => {
    let words = 0

    function visit(node: ReadingTextNode): void {
      if (node.type === "text") words += wordsInText(node.value)

      for (const child of node.children ?? []) visit(child)
    }

    visit(tree)

    // VFile always carries a data object, so the data member holds at
    // registration-narrowed shapes; foreign file shapes without data skip
    // the write instead of inventing a container.
    if ("data" in file) {
      if (file.data === undefined) file.data = {}

      if (file.data.frontmatter === undefined) file.data.frontmatter = {}
      file.data.frontmatter.read_minutes = estimateReadMinutes(words)
    }
  }
}
