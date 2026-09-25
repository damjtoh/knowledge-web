import { source } from "../lib/source"
import { buildReaderNavigation } from "../lib/navigation"
import { getSiteMetadata } from "../lib/site"

/**
 * Generic home: ordered published roots from generated metadata.
 *
 * When the staged tree carries an authored root introduction, render it
 * verbatim. A synthetic generated landing body is suppressed so its list is
 * not duplicated. The ordered root list always renders from the navigation
 * tree.
 */
export default async function HomePage() {
  const site = getSiteMetadata()

  const pages = source.getPages().map((page) => ({
    slugs: page.slugs,
    url: page.url,
    data: page.data,
    path: page.path,
  }))

  const navigation = buildReaderNavigation(pages, site.navigation)
  const rootPage = source.getPage([])

  const isSynthetic =
    rootPage !== undefined &&
    typeof rootPage.data === "object" &&
    rootPage.data !== null &&
    (rootPage.data as unknown as { synthetic?: unknown }).synthetic === true

  const AuthoredBody =
    rootPage && !isSynthetic
      ? (rootPage.data as unknown as { body?: React.ComponentType }).body
      : undefined

  return (
    <article className="reader-article reader-home-article">
      {AuthoredBody ? (
        <AuthoredBody />
      ) : (
        <>
          <h1>{site.title}</h1>
          <p>Browse the published sections.</p>
        </>
      )}
      <ul className="reader-area-list">
        {navigation.roots.map((root) => (
          <li key={root.url}>
            <a href={root.url}>{root.title}</a>
          </li>
        ))}
      </ul>
    </article>
  )
}
