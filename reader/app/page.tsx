import { File, Folder } from "lucide-react"
import { source } from "../lib/source"
import { buildReaderNavigation, type NavigationNode } from "../lib/navigation"
import { getSiteMetadata } from "../lib/site"
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card"

/** Staged root fields owned by the MDX pipeline. */
interface RootPageFields {
  synthetic?: unknown
  body?: React.ComponentType
}

function isRootFields(value: unknown): value is RootPageFields {
  return value !== null && Object(value) === value && !(value instanceof Function)
}

/** A published root pointing at Home never becomes a self-link card. */
function isHomeRoot(node: NavigationNode): boolean {
  if (node.slugs.length === 0) return true

  return node.url === "/"
}

/**
 * Accurate immediate-child count for a folder card, shown only when
 * meaningful: folders with at least one direct child. Notes never carry
 * a count and no description is invented.
 */
function childCountText(node: NavigationNode): string | null {
  if (!node.isFolder) return null

  if (node.children.length === 0) return null

  return node.children.length === 1 ? "1 item" : `${node.children.length} items`
}

function kindText(node: NavigationNode): string {
  return node.isFolder ? "Folder" : "Note"
}

/**
 * Generic home: ordered published root cards from generated metadata.
 *
 * When the staged tree carries an authored root introduction, render it
 * verbatim above the cards. A synthetic generated landing body is
 * suppressed so its list is not duplicated. Cards always render from the
 * navigation tree in manifest order, one per published root, with a
 * normal static link and a distinct folder/note cue. A Home root is
 * omitted, never a self-link.
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

  const cards = navigation.roots.filter((root) => !isHomeRoot(root))

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
      {cards.length > 0 ? (
        <ul className="reader-area-list reader-home-cards">
          {cards.map((root) => {
            const Icon = root.isFolder ? Folder : File
            const count = childCountText(root)
            const kind = kindText(root)

            return (
              <li key={root.url} className="reader-home-card-item">
                <a
                  href={root.url}
                  className="reader-home-card-link"
                  data-kind={root.isFolder ? "folder" : "note"}
                >
                  <Card className="reader-home-card">
                    <CardHeader className="reader-home-card-header">
                      <span className="reader-home-card-row">
                        <Icon aria-hidden="true" />
                        <CardTitle className="reader-home-card-title">{root.title}</CardTitle>
                      </span>
                      <CardDescription className="reader-home-card-meta">
                        {count ? `${kind} · ${count}` : kind}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </a>
              </li>
            )
          })}
        </ul>
      ) : null}
    </article>
  )
}
