import { source } from "../lib/source"
import { buildReaderNavigation } from "../lib/navigation"
import { getSiteMetadata } from "../lib/site"

/** Staged root fields owned by the MDX pipeline. */
interface RootPageFields {
  synthetic?: unknown
  body?: React.ComponentType
}

function isRootFields(value: unknown): value is RootPageFields {
  return value !== null && Object(value) === value && !(value instanceof Function)
}

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
  const rootData: unknown = rootPage?.data

  const rootFields = rootData !== undefined && isRootFields(rootData) ? rootData : undefined

  const isSynthetic = rootFields?.synthetic === true

  const AuthoredBody = rootPage && !isSynthetic ? rootFields?.body : undefined

  return (
    <article className="reader-article">
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
