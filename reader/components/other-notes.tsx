"use client"

import { useState } from "react"
import { ChevronRight, File } from "lucide-react"

/** Rows shown before the expander foot reveals the rest. */
const INITIAL_NOTES = 6

/** Serializable sibling fields: page objects carry functions and must not cross the server/client boundary. */
export interface SiblingNote {
  title: string
  url: string
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
      className="reader-group reader-other-notes"
    >
      <div className="flex items-center gap-2 p-3">
        <span className="text-13 font-semibold">{`Other notes in ${parentTitle}`}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {siblings.length}
        </span>
      </div>
      <ul className="reader-group-list">
        {visible.map((sibling) => (
          <li key={sibling.url}>
            <a href={sibling.url}>
              <File aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{sibling.title}</span>
            </a>
          </li>
        ))}
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
