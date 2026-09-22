import { source } from "../lib/source"

/**
 * Staged root index as the reader home.
 *
 * Staging generates a synthetic landing page only when the allowlisted
 * content has no root `index.md`; otherwise the authored root index is used
 * verbatim. Either way the home renders staged content, not a placeholder.
 */
export default async function HomePage() {
  const page = source.getPage([])
  if (!page) {
    return (
      <article className="reader-article">
        <h1>Shared reader</h1>
        <p>Staged content is unavailable.</p>
      </article>
    )
  }
  const Body = page.data.body
  return (
    <article className="reader-article">
      <Body />
    </article>
  )
}
