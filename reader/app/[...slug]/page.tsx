import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { source } from "../../lib/source"
import { getSiteIdentity, canonicalUrl } from "../../lib/site"
import { docTitle } from "../../lib/title"

export const dynamicParams = false

interface NoteParams {
  slug: string[]
}

/**
 * One static page per staged Markdown file. Page discovery comes only from
 * the headless staged-Markdown source, so non-Markdown staged files never
 * become routes. Wikilink resolution beyond literal rendering stays later
 * work (item 02): unknown `[[target]]` syntax renders as authored text.
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
  return (
    <article className="reader-article">
      <Body />
    </article>
  )
}
