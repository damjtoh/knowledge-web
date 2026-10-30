import type { TocItem } from "../lib/toc"
import TocLinks from "./toc-links"

/**
 * Below xl: collapsed-by-default "On this page" block between the meta
 * line and the body. Native details/summary keeps it server-rendered with
 * no client state; rows are plain anchors with 44px touch floors.
 */
export function NoteTocDetails({ items }: { items: TocItem[] }) {
  if (items.length === 0) return null

  return (
    <details className="my-3 border-y border-border xl:hidden">
      <summary className="flex min-h-11 cursor-pointer items-center text-13 font-semibold">
        On this page
      </summary>
      <ul className="m-0 mb-2 list-none p-0">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`flex min-h-11 items-center text-13 leading-snug wrap-break-word text-muted-foreground no-underline hover:text-foreground hover:underline hover:decoration-ring hover:underline-offset-3 dark:hover:decoration-chart-3 ${
                item.depth === 3 ? "pl-4" : ""
              }`}
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * From xl: sticky "On this page" aside right of the article inside the
 * reading area. Hidden below xl, where the details block takes over.
 */
export function NoteTocAside({ items }: { items: TocItem[] }) {
  if (items.length === 0) return null

  return (
    <aside
      aria-label="On this page"
      className="sticky top-6 hidden max-h-svh w-56 shrink-0 self-start overflow-y-auto xl:block"
    >
      <p className="m-0 text-xs font-semibold text-foreground">On this page</p>
      <TocLinks items={items} />
    </aside>
  )
}
