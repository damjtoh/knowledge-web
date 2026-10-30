"use client"

import { useState } from "react"
import { File, Folder } from "lucide-react"
import type { FolderRow } from "../lib/browse-rows"
import { Input } from "./ui/input"

/** Direct notes beyond which the Filter notes input appears. */
const FILTER_THRESHOLD = 12

function RowMeta({ row }: { row: FolderRow }) {
  if (row.isFolder) {
    const count = row.childCount ?? 0

    return (
      <span className="shrink-0 text-xs text-muted-foreground">
        {count === 1 ? "1 item" : `${count} items`}
      </span>
    )
  }

  if (row.isoDatetime === undefined || row.dateLabel === undefined) return null

  return (
    <time dateTime={row.isoDatetime} className="shrink-0 text-xs text-muted-foreground">
      {row.dateLabel}
    </time>
  )
}

function RowList({ rows }: { rows: FolderRow[] }) {
  return (
    <ul className="reader-group-list m-0 mt-3 grid max-w-full min-w-0 list-none gap-2 p-0">
      {rows.map((row) => {
        const Icon = row.isFolder ? Folder : File

        return (
          <li key={row.url} className="max-w-full min-w-0">
            <a
              href={row.url}
              className="group flex max-w-full min-h-11 min-w-0 items-center gap-3 border-b border-border px-1 py-3 leading-snug text-foreground no-underline"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              {/* Phone stacks the meta under the title; desktop right-aligns it. */}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-baseline md:justify-between md:gap-4">
                <span className="min-w-0 wrap-break-word group-hover:underline group-hover:decoration-ring group-hover:underline-offset-3 dark:group-hover:decoration-chart-3">
                  {row.title}
                </span>
                <RowMeta row={row} />
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

function FolderGroup({ title, rows }: { title: string; rows: FolderRow[] }) {
  return (
    <section aria-label={title} className="reader-group mt-10 border-t border-border pt-5">
      <h2 className="text-xl font-semibold wrap-break-word max-md:text-base">{title}</h2>
      <RowList rows={rows} />
    </section>
  )
}

function NoteGroup({ rows }: { rows: FolderRow[] }) {
  const [query, setQuery] = useState("")
  const title = `Notes (${rows.length})`
  const needle = query.trim().toLocaleLowerCase()
  const filterable = rows.length > FILTER_THRESHOLD

  const visible =
    filterable && needle !== ""
      ? rows.filter((row) => row.title.toLocaleLowerCase().includes(needle))
      : rows

  return (
    <section aria-label={title} className="reader-group mt-10 border-t border-border pt-5">
      <h2 className="text-xl font-semibold wrap-break-word max-md:text-base">{title}</h2>
      {filterable ? (
        <div className="mt-3">
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter notes"
            aria-label="Filter notes"
            autoComplete="off"
          />
        </div>
      ) : null}
      {visible.length > 0 ? <RowList rows={visible} /> : null}
      <div role="status" className="text-sm text-muted-foreground">
        {visible.length === 0 ? (
          <p className="mt-3">{`No notes match “${query.trim()}”.`}</p>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Folder page listing: child folders first, then direct notes, each in
 * navigation order. The full list renders on the server; only the Filter
 * notes input (shown above 12 notes) narrows rows by title on the client, so
 * without JavaScript every row stays visible. Group headings carry a count
 * so they never repeat the page title. Only serializable rows cross the
 * server/client boundary.
 */
export default function FolderListing({
  folders,
  notes,
}: {
  folders: FolderRow[]
  notes: FolderRow[]
}) {
  return (
    <>
      {folders.length > 0 ? (
        <FolderGroup title={`Folders (${folders.length})`} rows={folders} />
      ) : null}
      {notes.length > 0 ? <NoteGroup rows={notes} /> : null}
    </>
  )
}
