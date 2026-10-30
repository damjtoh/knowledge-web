import type { RecentNote } from "../lib/browse-rows"

/**
 * Home "Recently updated" section: the newest notes by valid frontmatter
 * `updated_at`, one plain anchor row each (title, muted parent folder, short
 * date). Dates are deterministic strings computed on the server, so the
 * section needs no client code. Returns null when no note has a valid stamp.
 */
export default function RecentlyUpdated({ notes }: { notes: RecentNote[] }) {
  if (notes.length === 0) return null

  return (
    <section
      aria-label="Recently updated"
      className="reader-group mt-10 border-t border-border pt-5 max-md:mt-6"
    >
      <h2 className="text-xl font-semibold wrap-break-word max-md:text-base">Recently updated</h2>
      <ul className="reader-group-list m-0 mt-3 grid max-w-full min-w-0 list-none gap-2 p-0">
        {notes.map((note) => (
          <li key={note.url} className="max-w-full min-w-0">
            <a
              href={note.url}
              className="group flex max-w-full min-h-11 min-w-0 items-center gap-3 border-b border-border px-1 py-3 leading-snug text-foreground no-underline"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="wrap-break-word group-hover:underline group-hover:decoration-ring group-hover:underline-offset-3 dark:group-hover:decoration-chart-3">
                  {note.title}
                </span>
                {note.parentTitle !== undefined ? (
                  <span className="truncate text-xs text-muted-foreground">{note.parentTitle}</span>
                ) : null}
              </span>
              <time dateTime={note.isoDatetime} className="shrink-0 text-xs text-muted-foreground">
                {note.label}
              </time>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}
