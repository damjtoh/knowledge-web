import { Fragment } from "react"
import type { Crumb } from "../lib/navigation"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb"

/**
 * Route-derived trail rendered with registry Breadcrumb components.
 *
 * Parents are plain anchors, so browser Back moves through real history
 * without redirects or a custom stack. The current page uses BreadcrumbPage
 * with aria-current="page"; intermediates without a route render as plain
 * text. Long titles and deep paths wrap inside the reading header without
 * horizontal overflow; all links stay keyboard reachable with visible focus.
 *
 * Utilities own the trail visuals (wrapper containment, List reset plus
 * containment, Item containment, Link/Page wrapping with 44px touch
 * floors and token colors); the registry primitives own landmarks and
 * aria. Hooks stay as non-visual DOM/test selectors with no scoped CSS.
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <div className="reader-breadcrumbs mb-0 max-w-full min-w-0 flex-1">
      <Breadcrumb aria-label="Breadcrumb" className="max-w-full min-w-0">
        <BreadcrumbList className="m-0 max-w-full min-w-0 list-none p-0">
          {items.map((item, i) => {
            const isLast = i === items.length - 1

            return (
              <Fragment key={`${item.title}-${i}`}>
                <BreadcrumbItem className="max-w-full min-w-0">
                  {item.url && !item.isCurrent ? (
                    <BreadcrumbLink
                      href={item.url}
                      className="inline-flex max-w-full min-w-0 min-h-11 items-center text-13 font-semibold wrap-break-word text-muted-foreground no-underline hover:text-foreground hover:underline hover:decoration-ring hover:underline-offset-3 dark:hover:decoration-chart-3"
                    >
                      {item.title}
                    </BreadcrumbLink>
                  ) : item.isCurrent ? (
                    <BreadcrumbPage className="max-w-full min-w-0 text-13 font-semibold wrap-break-word">
                      {item.title}
                    </BreadcrumbPage>
                  ) : (
                    <span className="max-w-full min-w-0 text-13 font-semibold wrap-break-word">
                      {item.title}
                    </span>
                  )}
                </BreadcrumbItem>
                {!isLast ? <BreadcrumbSeparator /> : null}
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}

/**
 * Phone-only body crumb trail for note pages (design screen pWNyV):
 * 12px muted slash-separated crumbs above the body. A plain paragraph,
 * not a second Breadcrumb landmark, so the header keeps the single
 * `Breadcrumb` landmark the static checks assert; md:hidden keeps every
 * desktop viewport pixel-identical.
 *
 * Server-rendered with zero client JS: crumbs arrive as props from the
 * shared trail derivation (`ReaderNavigation.breadcrumbs`, the server
 * flavor of the `crumbsFromRoots` core in lib/navigation).
 *
 * The `reader-note-crumbs` hook owns the 12px muted read in globals.css
 * because those anchors carry no utilities of their own. The trail sits
 * outside the inner `typeset` scope, so Typeset never styles it. No display
 * rule lives there — `md:hidden` in the markup owns visibility, since an
 * unlayered display declaration would beat that layered utility.
 */
export function NoteCrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <p className="reader-note-crumbs max-w-full min-w-0 pb-1 md:hidden">
      {crumbs.map((crumb, index) => (
        <Fragment key={`${crumb.title}-${index}`}>
          {index > 0 ? <span aria-hidden="true"> / </span> : null}
          {crumb.url && !crumb.isCurrent ? (
            <a href={crumb.url}>{crumb.title}</a>
          ) : (
            <span>{crumb.title}</span>
          )}
        </Fragment>
      ))}
    </p>
  )
}
