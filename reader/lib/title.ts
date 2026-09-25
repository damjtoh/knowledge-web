/**
 * Display title supplied by the maintained MDX pipeline (explicit
 * non-empty frontmatter title, else first-H1 auto-title), with a filename
 * fallback for pages where the pipeline supplies no title.
 */

/** Frontmatter-derived title source owned by the MDX pipeline. */
export interface TitleSource {
  title?: string
  body?: React.ComponentType
  synthetic?: boolean
  /** Valid timezone-aware `updated_at` when the staged note supplies one. */
  updated_at?: string | Date | null
}

export function docTitle(data: TitleSource | undefined, slug: string[]): string {
  const title = data?.title

  if (title !== undefined && title.trim() !== "") return title.trim()

  if (slug.length === 0) return "index"

  return slug[slug.length - 1]
}
