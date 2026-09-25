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
                    <BreadcrumbLink href={item.url}>{item.title}</BreadcrumbLink>
                  ) : item.isCurrent ? (
                    <BreadcrumbPage>{item.title}</BreadcrumbPage>
                  ) : (
                    <span>{item.title}</span>
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
