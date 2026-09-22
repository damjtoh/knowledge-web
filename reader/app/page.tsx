import { source } from "../lib/source"
import { getAreaEntries } from "../lib/navigation"
import { getSiteIdentity } from "../lib/site"

/**
 * Shared home: exactly the five selected Shared areas.
 *
 * Labels and routes come from staged area pages; the authored area index
 * supplies the introduction on each area page. Unselected staged trees
 * (for example `mica`) and known sentinels never appear here.
 */
export default async function HomePage() {
  const identity = getSiteIdentity()
  const areas = getAreaEntries((slugs) => source.getPage(slugs) as never)
  return (
    <article className="reader-article reader-home-article">
      <h1>{identity.title}</h1>
      <p>Browse the published household areas.</p>
      <ul className="reader-area-list">
        {areas.map((area) => (
          <li key={area.url}>
            <a href={area.url}>{area.title}</a>
          </li>
        ))}
      </ul>
    </article>
  )
}
