"use client"

import { useEffect, useState } from "react"
import type { TocItem } from "../lib/toc"

/**
 * Desktop table-of-contents links with current-section highlight.
 *
 * Plain anchors keep every link native (hash navigation, Back, no JS
 * scrolling), so no smooth-scroll behavior exists to gate on
 * prefers-reduced-motion. An IntersectionObserver marks the first heading
 * inside the top third of the viewport as current; with no heading in
 * that band the previous mark stays.
 */
export default function TocLinks({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | undefined>(undefined)

  useEffect(() => {
    const headings = items.flatMap((item) => {
      const heading = document.getElementById(item.id)

      return heading ? [heading] : []
    })

    const visible = new Set<string>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id)
          else visible.delete(entry.target.id)
        }

        const first = headings.find((heading) => visible.has(heading.id))

        if (first) setActive(first.id)
      },
      { rootMargin: "0px 0px -66% 0px" },
    )

    for (const heading of headings) observer.observe(heading)

    return () => observer.disconnect()
  }, [items])

  return (
    <ul className="m-0 mt-1 list-none p-0">
      {items.map((item) => {
        const current = item.id === active

        return (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={current ? "location" : undefined}
              className={`block py-1.5 text-13 leading-snug wrap-break-word no-underline hover:text-foreground hover:underline hover:decoration-ring hover:underline-offset-3 dark:hover:decoration-chart-3 ${
                item.depth === 3 ? "pl-3" : ""
              } ${current ? "font-medium text-foreground" : "text-muted-foreground"}`}
            >
              {item.title}
            </a>
          </li>
        )
      })}
    </ul>
  )
}
