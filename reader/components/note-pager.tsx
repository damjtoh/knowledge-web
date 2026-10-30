import type { AdjacentNotes } from "../lib/adjacent-notes"

const linkClass =
  "flex min-h-11 min-w-0 flex-col justify-center gap-0.5 rounded-md border border-border px-3 py-2 no-underline hover:border-ring dark:hover:border-chart-3"

/**
 * Previous and next sibling notes at the end of a note: two columns from
 * md, stacked on phones. A missing side leaves its column empty so Next
 * stays on the right. Plain anchors under 44px-or-taller touch targets.
 * Returns null when the note has no neighbours.
 */
export default function NotePager({ previous, next }: AdjacentNotes) {
  if (!previous && !next) return null

  return (
    <nav aria-label="Previous and next notes" className="mt-10 grid gap-3 md:grid-cols-2">
      {previous ? (
        <a href={previous.url} rel="prev" className={`${linkClass} md:col-start-1`}>
          <span className="text-xs text-muted-foreground">Previous</span>
          <span className="text-13 font-semibold wrap-break-word text-foreground">
            {previous.title}
          </span>
        </a>
      ) : null}
      {next ? (
        <a href={next.url} rel="next" className={`${linkClass} md:col-start-2 md:text-right`}>
          <span className="text-xs text-muted-foreground">Next</span>
          <span className="text-13 font-semibold wrap-break-word text-foreground">
            {next.title}
          </span>
        </a>
      ) : null}
    </nav>
  )
}
