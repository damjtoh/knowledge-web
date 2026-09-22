/**
 * Display title supplied by the maintained MDX pipeline (explicit
 * frontmatter title, else first-H1 auto-title), with a route fallback for
 * pages where the pipeline supplies no title. Authored title priority rules
 * and alias mapping stay item 02 work; this helper only reads what the
 * pipeline already derived.
 */
export function docTitle(data: unknown, slug: string[]): string {
  const title =
    typeof data === "object" && data !== null ? (data as { title?: unknown }).title : undefined
  if (typeof title === "string" && title.trim() !== "") return title.trim()
  return slug.join("/")
}
