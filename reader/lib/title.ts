/**
 * Display title supplied by the maintained MDX pipeline (explicit
 * non-empty frontmatter title, else first-H1 auto-title), with a filename
 * fallback for pages where the pipeline supplies no title.
 */
export function docTitle(data: unknown, slug: string[]): string {
  const title =
    typeof data === "object" && data !== null ? (data as { title?: unknown }).title : undefined

  if (typeof title === "string" && title.trim() !== "") return title.trim()

  if (slug.length === 0) return "index"

  return slug[slug.length - 1]
}
