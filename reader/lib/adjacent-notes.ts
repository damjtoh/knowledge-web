import { getDirectNotes, type NavigationNode } from "./navigation"

/** Neighbouring notes in tree order; a side is absent at either end. */
export interface AdjacentNotes {
  previous?: { title: string; url: string }
  next?: { title: string; url: string }
}

/**
 * Previous and next sibling notes under the same parent, in the order the
 * sidebar lists them (getDirectNotes). Folders never count. A missing
 * parent or a note outside the parent's direct notes has no neighbours.
 */
export function adjacentNotes(parent: NavigationNode | undefined, url: string): AdjacentNotes {
  if (!parent) return {}
  const notes = getDirectNotes(parent)
  const index = notes.findIndex((note) => note.url === url)

  if (index === -1) return {}
  const result: AdjacentNotes = {}
  const previous = notes[index - 1]
  const next = notes[index + 1]

  if (previous) result.previous = { title: previous.title, url: previous.url }

  if (next) result.next = { title: next.title, url: next.url }

  return result
}
