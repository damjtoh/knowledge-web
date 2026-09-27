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
 * Custom styling lives on the wrapping element so registry components keep
 * their contracts; inner elements are reached by descendant selectors.
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <div className="reader-breadcrumbs">
      <Breadcrumb aria-label="Breadcrumb">
        <BreadcrumbList>
          {items.map((item, i) => {
            const isLast = i === items.length - 1

            return (
              <Fragment key={`${item.title}-${i}`}>
                <BreadcrumbItem>
                  {item.url && !item.isCurrent ? (
                    <BreadcrumbLink href={item.url} className="text-13 font-semibold">
                      {item.title}
                    </BreadcrumbLink>
                  ) : item.isCurrent ? (
                    <BreadcrumbPage className="text-13 font-semibold">{item.title}</BreadcrumbPage>
                  ) : (
                    <span className="text-13 font-semibold">{item.title}</span>
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
 * The `reader-note-crumbs` hook (not utilities alone) dodges the
 * unlayered `.reader-article p/a` rules: those rules beat layered
 * utilities for margin and link color, so the hook genuinely needs its
 * unlayered margin/color overrides in globals.css. No display rule lives
 * there — `md:hidden` in the markup owns visibility, since an unlayered
 * display declaration would beat that layered utility.
 */
export function NoteCrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <p className="reader-note-crumbs md:hidden">
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
