import type { Crumb } from "../lib/navigation"

/**
 * Folder ancestry with plain links. Uses normal anchors only, so browser
 * Back moves through real history without redirects or a custom stack.
 */
export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="reader-breadcrumbs">
      <ol>
        {items.map((item, i) => (
          <li key={`${item.title}-${i}`}>
            {item.url && !item.isCurrent ? (
              <a href={item.url}>{item.title}</a>
            ) : (
              <span aria-current={item.isCurrent ? "page" : undefined}>{item.title}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
