import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { source } from "../../lib/source"
import { getSiteMetadata, canonicalUrl } from "../../lib/site"
import { docTitle } from "../../lib/title"
import {
  buildReaderNavigation,
  getDirectNotes,
  getChildFolders,
  type NavigationNode,
} from "../../lib/navigation"
import Breadcrumbs from "../../components/breadcrumbs"

export const dynamicParams = false

interface NoteParams {
  slug: string[]
}

function pageLikes() {
  return source.getPages().map((page) => ({
    slugs: page.slugs,
    url: page.url,
    data: page.data,
    path: page.path,
  }))
}

function readerNavigation() {
  const site = getSiteMetadata()

  return buildReaderNavigation(pageLikes(), site.navigation)
}

function GroupSection({ title, nodes }: { title: string; nodes: NavigationNode[] }) {
  if (nodes.length === 0) return null

  return (
    <section aria-label={title} className="reader-group">
      <h2>{title}</h2>
      <ul className="reader-group-list">
        {nodes.map((node) => (
          <li key={node.url}>
            <a href={node.url}>{node.title}</a>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * One static page per staged Markdown file plus one virtual folder page per
 * staged folder containing Markdown. Authored indexes own their folder
 * route and introduction; virtual folders supply a humanized title and
 * child navigation. Every folder page uses the same generic direct-note
 * and child-folder groups. Navigation uses plain anchors only, so browser
 * Back moves through real history.
 */
export async function generateStaticParams(): Promise<NoteParams[]> {
  const authored = source
    .generateParams()
    .filter((params) => Array.isArray(params.slug) && params.slug.length > 0)
    .map((params) => ({ slug: params.slug as string[] }))

  const seen = new Set(authored.map((entry) => entry.slug.join("/")))
  const navigation = readerNavigation()
  const virtual: NoteParams[] = []

  const collect = (node: NavigationNode): void => {
    if (node.slugs.length > 0) {
      const key = node.slugs.join("/")

      if (!seen.has(key)) {
        seen.add(key)
        virtual.push({ slug: [...node.slugs] })
      }
    }

    for (const child of node.children) collect(child)
  }

  for (const root of navigation.roots) collect(root)

  return [...authored, ...virtual]
}

export async function generateMetadata({
  params,
}: {
  params: Promise<NoteParams>
}): Promise<Metadata> {
  const { slug } = await params
  const navigation = readerNavigation()
  const node = navigation.find(slug)
  const site = getSiteMetadata()

  if (node) {
    return {
      title: node.title,
      metadataBase: new URL(`https://${site.canonicalHostname}`),
      alternates: {
        canonical: canonicalUrl(site.canonicalHostname, node.url),
      },
    }
  }

  const page = source.getPage(slug)

  if (!page) notFound()

  return {
    title: docTitle(page.data, slug),
    metadataBase: new URL(`https://${site.canonicalHostname}`),
    alternates: {
      canonical: canonicalUrl(site.canonicalHostname, page.url),
    },
  }
}

export default async function FolderOrNotePage({ params }: { params: Promise<NoteParams> }) {
  const { slug } = await params
  const navigation = readerNavigation()
  const node = navigation.find(slug)
  const crumbs = navigation.breadcrumbs(slug)

  if (node?.page) {
    const Body = (node.page.data as unknown as { body: React.ComponentType }).body
    const directNotes = getDirectNotes(node)
    const childFolders = getChildFolders(node)

    return (
      <>
        <Breadcrumbs items={crumbs} />
        <article className="reader-article">
          <Body />
          <GroupSection title="Notes" nodes={directNotes} />
          <GroupSection title="Folders" nodes={childFolders} />
        </article>
      </>
    )
  }

  if (node && node.isFolder) {
    const directNotes = getDirectNotes(node)
    const childFolders = getChildFolders(node)

    return (
      <>
        <Breadcrumbs items={crumbs} />
        <article className="reader-article">
          <h1>{node.title}</h1>
          <GroupSection title="Notes" nodes={directNotes} />
          <GroupSection title="Folders" nodes={childFolders} />
        </article>
      </>
    )
  }

  const page = source.getPage(slug)

  if (!page) notFound()
  const Body = (page.data as unknown as { body: React.ComponentType }).body

  return (
    <>
      <Breadcrumbs items={crumbs} />
      <article className="reader-article">
        <Body />
      </article>
    </>
  )
}
