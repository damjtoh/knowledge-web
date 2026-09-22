import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { source } from "../../lib/source"
import { getSiteIdentity, canonicalUrl } from "../../lib/site"
import { docTitle } from "../../lib/title"
import {
  SHARED_AREA_SLUGS,
  getBreadcrumbs,
  getChildPages,
  getTravelGroups,
  type PageRef,
} from "../../lib/navigation"
import Breadcrumbs from "../../components/breadcrumbs"

export const dynamicParams = false

interface NoteParams {
  slug: string[]
}

function isArea(slugs: string[]): boolean {
  return SHARED_AREA_SLUGS.some(
    (area) => area.length === slugs.length && area.every((seg, i) => seg === slugs[i]),
  )
}

function GroupSection({ title, pages }: { title: string; pages: PageRef[] }) {
  if (pages.length === 0) return null
  return (
    <section aria-label={title} className="reader-group">
      <h2>{title}</h2>
      <ul className="reader-group-list">
        {pages.map((p) => (
          <li key={p.url}>
            <a href={p.url}>{p.title}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * One static page per staged Markdown file. Area indexes render their
 * authored introduction plus folder-grouped children; hubs render their
 * introduction plus direct children; leaves render the note. Navigation
 * uses plain anchors only, so browser Back moves through real history.
 */
export async function generateStaticParams(): Promise<NoteParams[]> {
  return source
    .generateParams()
    .filter((params) => Array.isArray(params.slug) && params.slug.length > 0)
    .map((params) => ({ slug: params.slug as string[] }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<NoteParams>
}): Promise<Metadata> {
  const { slug } = await params
  const page = source.getPage(slug)
  if (!page) notFound()
  const identity = getSiteIdentity()
  return {
    title: docTitle(page.data, slug),
    metadataBase: new URL(`https://${identity.canonicalHostname}`),
    alternates: {
      canonical: canonicalUrl(identity.canonicalHostname, page.url),
    },
  }
}

export default async function NotePage({ params }: { params: Promise<NoteParams> }) {
  const { slug } = await params
  const page = source.getPage(slug)
  if (!page) notFound()
  const Body = page.data.body
  const crumbs = getBreadcrumbs(slug, (s) => source.getPage(s) as never)
  const allPages = source.getPages().map((p) => ({
    slugs: p.slugs,
    url: p.url,
    data: p.data,
  }))

  const isTravelArea = slug.length === 1 && slug[0] === "travel"
  const children = getChildPages(allPages, slug)
  const showChildren = !isTravelArea && children.length > 0
  const travelGroups = isTravelArea ? getTravelGroups(allPages) : null

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <article className="reader-article">
        <Body />
        {isArea(slug) && travelGroups ? (
          <>
            <GroupSection title="Upcoming trips" pages={travelGroups.upcoming} />
            <GroupSection title="Past trips" pages={travelGroups.past} />
            <GroupSection title="Preferences" pages={travelGroups.preferences} />
            <GroupSection title="More in Travel" pages={travelGroups.more} />
          </>
        ) : isArea(slug) && children.length > 0 ? (
          <section aria-label="In this area" className="reader-group">
            <h2>In this area</h2>
            <ul className="reader-group-list">
              {children.map((c) => (
                <li key={c.url}>
                  <a href={c.url}>{c.title}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : showChildren ? (
          <section aria-label="In this section" className="reader-group">
            <h2>In this section</h2>
            <ul className="reader-group-list">
              {children.map((c) => (
                <li key={c.url}>
                  <a href={c.url}>{c.title}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </article>
    </>
  )
}
