import { ChevronRight, File, Folder } from "lucide-react"
import { source } from "../lib/source"
import { buildReaderNavigation, type NavigationNode } from "../lib/navigation"
import { getSiteMetadata } from "../lib/site"
import LastEdited from "../components/last-edited"
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card"

/** Staged root fields owned by the MDX pipeline. */
interface RootPageFields {
  synthetic?: unknown
  body?: React.ComponentType
  title?: string
  updated_at?: string | Date | null
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
      {/* Phone-only body crumb from design screen I1z3qM. It renders in
          both branches so the authored and fallback homes share one phone
          body; md:hidden keeps every desktop viewport pixel-identical. */}
      <span className="mb-1 block text-xs text-muted-foreground md:hidden">Home</span>
      {AuthoredBody ? (
        <>
          <AuthoredBody />
          <LastEdited data={rootFields} />
        </>
      ) : (
        <>
          <h1>{site.title}</h1>
          <p className="max-md:text-sm max-md:text-muted-foreground">
            Browse the published sections.
          </p>
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
                  {/* Desktop card structure is unchanged. The phone row is a
                      separate span set (no unlayered CSS targets it, so the
                      hidden/max-md toggle and every inner utility applies):
                      36px muted icon box, stacked title plus count-only meta,
                      and a trailing chevron. Card padding and row layout switch
                      to the design row below 768px only. */}
                  <Card className="reader-home-card max-md:flex-row max-md:items-center max-md:gap-3 max-md:p-3">
                    <CardHeader className="reader-home-card-header max-md:hidden">
                      <span className="reader-home-card-row">
                        <Icon aria-hidden="true" />
                        <CardTitle className="reader-home-card-title">{root.title}</CardTitle>
                      </span>
                      <CardDescription className="reader-home-card-meta">
                        {count ? `${kind} · ${count}` : kind}
                      </CardDescription>
                    </CardHeader>
                    <span className="hidden min-w-0 flex-1 items-center gap-3 max-md:flex">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon aria-hidden="true" className="size-4" />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <CardTitle className="truncate text-sm font-semibold">
                          {root.title}
                        </CardTitle>
                        <CardDescription className="truncate text-xs text-muted-foreground">
                          {count ?? kind}
                        </CardDescription>
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    </span>
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
