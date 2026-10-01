import { ChevronRight, File, Folder } from "lucide-react"
import { source } from "../lib/source"
import { buildReaderNavigation, type NavigationNode } from "../lib/navigation"
import { getSiteMetadata } from "../lib/site"
import { mdxComponents, type MdxBody } from "../components/mdx-components"
import { Card, CardDescription, CardHeader, CardTitle } from "../components/ui/card"

/** Staged root fields owned by the MDX pipeline. */
interface RootPageFields {
  synthetic?: unknown
  body?: MdxBody
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
 * Accurate immediate-child count for a folder card, shown as the only
 * desktop meta (design D3O3k6 carries no kind prefix and no description
 * data exists): folders with at least one direct child. Notes never carry
 * a count and no description is invented.
 */
function childCountText(node: NavigationNode): string | null {
  if (!node.isFolder) return null

  if (node.children.length === 0) return null

  return node.children.length === 1 ? "1 item" : `${node.children.length} items`
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
        /* Authored home introduction owns the Typeset scope; the synthetic
           fallback below and the root cards stay outside as React content. */
        <div className="typeset">
          <AuthoredBody components={mdxComponents} />
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-bold wrap-break-word max-md:text-2xl">{site.title}</h1>
          <p className="max-md:text-sm max-md:text-muted-foreground">
            Browse the published sections.
          </p>
        </>
      )}
      {cards.length > 0 ? (
        <ul className="reader-area-list reader-home-cards m-0 mt-6 grid max-w-full min-w-0 list-none gap-3 p-0 max-md:mt-4">
          {cards.map((root) => {
            const Icon = root.isFolder ? Folder : File
            const count = childCountText(root)

            return (
              <li key={root.url} className="reader-home-card-item max-w-full min-w-0">
                <a
                  href={root.url}
                  className="reader-home-card-link group block h-full max-w-full min-h-11 min-w-0 text-inherit no-underline"
                  data-kind={root.isFolder ? "folder" : "note"}
                >
                  {/* Desktop card follows design D3O3k6 "Vault Area Row /
                      Desktop": a row of 40px muted icon box, stacked title
                      plus count-only meta, and a trailing Open plus chevron.
                      Padding 16 comes from the registry Card/CardHeader
                      tokens (no p-4: it would double the header inset); the
                      title stays 16px via the CardTitle default (no 15px
                      scale token exists). Utilities own list, link, row,
                      title, and meta visuals; scoped CSS keeps only the
                      responsive column track (bracket values are banned)
                      and the plain-card override against the unlayered
                      article-link rule. The phone row below is unchanged
                      (36px box, 14px title, count-only 12px meta, chevron).
                      Note roots carry no count, so the desktop meta omits
                      itself there instead of guessing. */}
                  <Card className="reader-home-card h-full max-w-full min-w-0 max-md:flex-row max-md:items-center max-md:gap-3 max-md:p-3">
                    <CardHeader className="reader-home-card-header max-w-full min-w-0 max-md:hidden">
                      <span className="reader-home-card-row flex max-w-full min-w-0 items-center gap-3">
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon aria-hidden="true" className="size-4.5" />
                        </span>
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <CardTitle className="reader-home-card-title max-w-full min-w-0 wrap-break-word group-hover:underline group-hover:decoration-ring group-hover:underline-offset-3 dark:group-hover:decoration-chart-3">
                            {root.title}
                          </CardTitle>
                          {count ? (
                            <CardDescription className="reader-home-card-meta text-2xs text-muted-foreground max-w-full min-w-0 wrap-break-word">
                              {count}
                            </CardDescription>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="text-xs text-muted-foreground">Open</span>
                          <ChevronRight
                            aria-hidden="true"
                            className="size-3.5 shrink-0 text-muted-foreground"
                          />
                        </span>
                      </span>
                    </CardHeader>
                    <span className="hidden max-w-full min-w-0 flex-1 items-center gap-3 max-md:flex">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon aria-hidden="true" className="size-4" />
                      </span>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <CardTitle className="truncate text-sm font-semibold">
                          {root.title}
                        </CardTitle>
                        <CardDescription className="truncate text-xs text-muted-foreground">
                          {count ?? (root.isFolder ? "Folder" : "Note")}
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
