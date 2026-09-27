import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { source } from "../../lib/source"
import { getSiteMetadata, canonicalUrl } from "../../lib/site"
import { docTitle } from "../../lib/title"
import MetaLine, { type MetaLineData } from "../../components/last-edited"
import { NoteCrumbs } from "../../components/breadcrumbs"
import OtherNotes, { type SiblingNote } from "../../components/other-notes"
import { readMinutesFromData } from "../../lib/reading-time"
import {
  buildReaderNavigation,
  getDirectNotes,
  getChildFolders,
  type NavigationNode,
} from "../../lib/navigation"

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
 * Nearest folder owning a node, found by walking the published roots (the
 * tree carries no parent pointer). Root notes have no parent.
 */
function findParentNode(
  roots: NavigationNode[],
  target: NavigationNode,
): NavigationNode | undefined {
  for (const root of roots) {
    if (root.children.includes(target)) return root
    const found = findParentNode(root.children, target)

    if (found) return found
  }

  return undefined
}

/** Sibling leaf notes under the same parent, excluding the current page. */
interface SiblingNotes {
  parent: NavigationNode | undefined
  siblings: SiblingNote[]
}

/**
 * Serializable sibling stamp: the child's frontmatter `updated_at`
 * normalized to an ISO string (Date values become ISO). Missing,
 * non-string, and invalid stamps stay absent here; the client omits the
 * meta span for those rows instead of guessing a date. Only strings cross
 * the server/client boundary, never page objects or functions.
 */
function siblingUpdatedAt(
  data: { updated_at?: string | Date | null } | undefined,
): string | undefined {
  const raw = data?.updated_at

  if (raw instanceof Date) return raw.toISOString()

  if (raw === null || raw === undefined) return undefined

  // String(x) is identical to x only for string primitives, so this
  // narrows to string without a runtime typeof check (same idiom as
  // parseUpdatedAt in lib/last-edited.ts).
  const text = String(raw)

  // SAFETY: the String-identity check above established raw is a string primitive.
  if ((text as unknown) !== raw) return undefined

  return text
}

/** Sibling row for a tree child: title, route, and optional edit stamp. */
function siblingNoteFor(child: NavigationNode): SiblingNote {
  const note: SiblingNote = { title: child.title, url: child.url }
  const updatedAt = siblingUpdatedAt(child.page?.data)

  if (updatedAt !== undefined) note.updatedAt = updatedAt

  return note
}

function siblingNotes(roots: NavigationNode[], node: NavigationNode): SiblingNotes {
  const parent = findParentNode(roots, node)
  const siblings: SiblingNote[] = []

  if (parent) {
    for (const child of getDirectNotes(parent)) {
      if (child.url !== node.url) siblings.push(siblingNoteFor(child))
    }
  }

  return { parent, siblings }
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
    .flatMap((params) =>
      Array.isArray(params.slug) && params.slug.length > 0 ? [{ slug: params.slug }] : [],
    )

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

  if (node?.page) {
    // SAFETY: authored index pages own a compiled body component; node.page exists only for authored routes.
    const Body = node.page.data.body as React.ComponentType
    const directNotes = getDirectNotes(node)
    const childFolders = getChildFolders(node)

    // Leaf notes carry the phone note treatment (design screen pWNyV):
    // a phone-only slash trail, one shared meta line above the title on
    // every viewport (design component HMIv8; the title lives inside the
    // MDX body h1, so above the title means before Body), and the shared
    // Other notes sibling section on every viewport. Folder pages keep
    // their generic Notes/Folders groups with no meta line (design has no
    // folder screen).
    if (!node.isFolder) {
      const crumbs = navigation.breadcrumbs(slug)
      const { parent, siblings } = siblingNotes(navigation.roots, node)
      // SAFETY: loader page data carries frontmatter fields; MetaLine reads only the named updated_at/read_minutes fields.
      const metaSource = node.page.data as MetaLineData

      return (
        <article className="reader-article">
          <NoteCrumbs crumbs={crumbs} />
          <MetaLine
            parentTitle={parent?.title}
            readMinutes={readMinutesFromData(metaSource)}
            data={metaSource}
          />
          <Body />
          <OtherNotes parentTitle={parent?.title} siblings={siblings} />
        </article>
      )
    }

    return (
      <article className="reader-article">
        <Body />
        <GroupSection title="Notes" nodes={directNotes} />
        <GroupSection title="Folders" nodes={childFolders} />
      </article>
    )
  }

  if (node && node.isFolder) {
    const directNotes = getDirectNotes(node)
    const childFolders = getChildFolders(node)

    return (
      <article className="reader-article">
        <h1>{node.title}</h1>
        <GroupSection title="Notes" nodes={directNotes} />
        <GroupSection title="Folders" nodes={childFolders} />
      </article>
    )
  }

  const page = source.getPage(slug)

  if (!page) notFound()
  // SAFETY: staged Markdown pages own a compiled body component; getPage returned a page for an existing slug.
  const Body = (page.data as { body: React.ComponentType }).body
  // SAFETY: loader page data carries frontmatter fields; MetaLine reads only the named updated_at/read_minutes fields.
  const metaSource = page.data as MetaLineData
  // Routes outside visible navigation still get the phone note treatment;
  // the ancestor lookup simply finds no published parent, so the sibling
  // section stays hidden while the trail and meta line still render.
  const crumbs = navigation.breadcrumbs(slug)
  const ancestor = slug.length > 1 ? navigation.find(slug.slice(0, -1)) : undefined
  const siblings: SiblingNote[] = []

  if (ancestor) {
    for (const child of getDirectNotes(ancestor)) {
      if (child.url !== page.url) siblings.push(siblingNoteFor(child))
    }
  }

  return (
    <article className="reader-article">
      <NoteCrumbs crumbs={crumbs} />
      <MetaLine
        parentTitle={ancestor?.title}
        readMinutes={readMinutesFromData(metaSource)}
        data={metaSource}
      />
      <Body />
      <OtherNotes parentTitle={ancestor?.title} siblings={siblings} />
    </article>
  )
}
