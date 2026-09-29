"use client"

import { useState } from "react"
import { ChevronRight, File } from "lucide-react"
import { relativeUpdatedAt } from "../lib/last-edited"

/** Rows shown before the expander foot reveals the rest. */
const INITIAL_NOTES = 6

/**
 * Serializable sibling fields: page objects carry functions and must not
 * cross the server/client boundary. `updatedAt` is the sibling's
 * frontmatter stamp normalized server-side to an ISO string (Date values
 * become ISO; missing or non-string values stay absent), so only strings
 * cross; the client formats the relative label and omits the meta when the
 * stamp is missing or invalid.
 */
export interface SiblingNote {
  title: string
  url: string
  updatedAt?: string
}

/**
 * Sibling-note section shared by every article viewport (design screen
 * pWNyV): "Other notes in {parent}" plus a muted count pill, one plain
 * row per sibling note, and a "Show all N notes" foot when more than six
 * siblings exist. Only the expander needs client state (mirroring the
 * sidebar tree more-row); rows are plain anchors so Back moves through
 * real history. Returns null when the note has no parent or no siblings.
 */
export default function OtherNotes({
  parentTitle,
  siblings,
}: {
  parentTitle: string | undefined
  siblings: SiblingNote[]
}) {
  const [expanded, setExpanded] = useState(false)

  if (!parentTitle || siblings.length === 0) return null

  const visible = expanded ? siblings : siblings.slice(0, INITIAL_NOTES)
  const hiddenCount = siblings.length - visible.length

  return (
    <section
      aria-label={`Other notes in ${parentTitle}`}
      className="reader-group reader-other-notes mt-10 border-t border-border pt-5"
    >
      <div className="flex items-center gap-2 p-3">
        <span className="text-13 font-semibold">{`Other notes in ${parentTitle}`}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {siblings.length}
        </span>
      </div>
      <ul className="reader-group-list m-0 mt-3 grid max-w-full min-w-0 list-none gap-2 p-0">
        {visible.map((sibling) => {
          // Relative meta renders client-side from the serializable stamp
          // (design a4MmZf: 11px muted under the 13px label); a missing or
          // invalid stamp yields no meta span instead of a guessed date.
          const relative = relativeUpdatedAt(sibling.updatedAt ?? undefined)

          return (
            <li key={sibling.url} className="max-w-full min-w-0">
              <a
                href={sibling.url}
                className="flex max-w-full min-h-9 min-w-0 items-center gap-2 border-b-0 px-3 py-1 text-13 leading-snug wrap-break-word text-muted-foreground no-underline hover:text-foreground hover:underline hover:decoration-ring hover:underline-offset-3 max-md:min-h-11 dark:hover:decoration-chart-3"
              >
                <File aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-13">{sibling.title}</span>
                  {relative !== null ? (
                    <time
                      dateTime={relative.isoDatetime}
                      className="truncate text-2xs text-muted-foreground"
                    >
                      {relative.label}
                    </time>
                  ) : null}
                </span>
              </a>
            </li>
          )
        })}
      </ul>
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-1 p-3 text-left text-13 font-semibold"
        >
          {`Show all ${siblings.length} notes`}
          <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
        </button>
      ) : null}
    </section>
  )
}
