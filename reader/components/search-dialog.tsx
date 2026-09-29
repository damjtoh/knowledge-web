"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
import { Kbd } from "./ui/kbd"
// Runtime comes from the explicit module file (the static-export bundle
// resolves it directly); types come from the sibling declarations, which
// keep the typecheck honest about the small dialog interface.
import { loadSearchIndex, searchNotes } from "../lib/search.mjs"
import type { SearchHit, SearchIndex } from "../lib/search"

export const SEARCH_INPUT_ID = "reader-search-input"

const SEARCH_INDEX_URL = "/search-index.json"

const RESULT_LIMIT = 20

let cachedIndex: SearchIndex | null = null

let cachedFetch: Promise<SearchIndex | null> | null = null

function fetchSearchIndex(): Promise<SearchIndex | null> {
  if (cachedIndex) return Promise.resolve(cachedIndex)

  if (!cachedFetch) {
    cachedFetch = fetch(SEARCH_INDEX_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`search index ${res.status}`)

        return res.json()
      })
      .then((data) => {
        cachedIndex = loadSearchIndex(data)

        return cachedIndex
      })
      .catch(() => null)
  }

  return cachedFetch
}

/**
 * One Search dialog for desktop and phone. The static index loads lazily
 * on first open from its static URL; a failed fetch shows
 * no-results-style feedback instead of a crash. Results are plain anchors to normal
 * static routes, so opening one is real browser navigation. The input
 * keeps focus while Arrow keys move an aria-activedescendant highlight
 * and Enter follows the highlighted static URL.
 *
 * Chrome follows design screen MnMak through registry className
 * composition plus scale utilities on the hooked elements: max-w-lg for
 * the 512px desktop width (the registry keeps the full-width-minus-margins
 * phone fallback), p-4 with gap-3 on card fill, a 14px bordered input
 * with a leading icon, a 13px muted count line over results, the existing
 * empty/loading/no-results states restyled as a padded 13px strip, 14/12/13
 * title/url/excerpt rows with the muted active wash, and a 12px hint row
 * with 11px kbd chips. Utilities own every trigger/dialog/list/row visual
 * (44px touch floors via min-h-11/min-w-11, grid gaps, muted washes, token
 * type sizes); hook classes stay as non-visual test/state selectors. The
 * only scoped CSS is the list height cap (viewport-relative min() the
 * banned arbitrary values cannot express) and the excerpt <mark> wash
 * for generated index HTML.
 * Behavior, copy (plus the design's count line), and focus flow are
 * unchanged. The dialog sits outside .reader-article, so the unlayered
 * article-link rule never competes with row utilities.
 */
export default function SearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState<SearchIndex | null>(cachedIndex)
  const [indexFailed, setIndexFailed] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const statusId = useId()

  useEffect(() => {
    if (!open) return
    setActive(0)

    if (cachedIndex) {
      setIndex(cachedIndex)

      return
    }

    let cancelled = false
    fetchSearchIndex().then((loaded) => {
      if (cancelled) return

      if (loaded) setIndex(loaded)
      else setIndexFailed(true)
    })

    return () => {
      cancelled = true
    }
  }, [open])

  const trimmed = query.trim()
  const loading = open && trimmed !== "" && !index && !indexFailed

  const results: SearchHit[] = useMemo(() => {
    if (!index || trimmed === "") return []

    return searchNotes(index, trimmed, RESULT_LIMIT)
  }, [index, trimmed])

  useEffect(() => {
    setActive(0)
  }, [trimmed])

  const clamped = results.length === 0 ? 0 : Math.min(active, results.length - 1)
  const activeId = results.length === 0 ? undefined : `${listId}-option-${clamped}`

  const statusText = !open
    ? ""
    : loading
      ? "Searching…"
      : indexFailed && trimmed !== ""
        ? "Search is unavailable right now. Try again later."
        : trimmed !== "" && results.length === 0 && index
          ? `No results for “${trimmed}”.`
          : ""

  const countText =
    results.length === 0 ? "" : results.length === 1 ? "1 result" : `${results.length} results`

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()

      if (results.length > 0) setActive((i) => (i + 1) % results.length)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()

      if (results.length > 0) setActive((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === "Home") {
      event.preventDefault()
      setActive(0)
    } else if (event.key === "End") {
      event.preventDefault()

      if (results.length > 0) setActive(results.length - 1)
    } else if (event.key === "Enter") {
      const hit = results[clamped]

      if (trimmed !== "" && hit) {
        event.preventDefault()
        window.location.assign(hit.url)
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg gap-3 bg-card p-4">
        <DialogHeader className="flex-row items-center gap-2">
          <DialogTitle>Search</DialogTitle>
        </DialogHeader>
        <div className="reader-search-body grid gap-3">
          <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
            Search notes
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id={SEARCH_INPUT_ID}
              type="text"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-autocomplete="list"
              aria-controls={listId}
              aria-activedescendant={activeId}
              aria-describedby={statusId}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Search notes…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              className="reader-search-input min-h-11 w-full rounded-md border border-border bg-card py-2.5 pr-3 pl-9 text-sm text-primary placeholder:text-muted-foreground"
            />
          </div>
          {results.length > 0 ? (
            <div
              id={statusId}
              role="status"
              aria-live="polite"
              className="reader-search-status min-h-5 text-13 text-muted-foreground"
            >
              <span>{countText}</span>
            </div>
          ) : (
            <div
              id={statusId}
              role="status"
              aria-live="polite"
              className="reader-search-status min-h-5 rounded-md p-3 text-13 text-primary"
            >
              {statusText !== "" ? <span>{statusText}</span> : null}
              {open && trimmed === "" ? <span>Type to find a note.</span> : null}
            </div>
          )}
          {results.length > 0 ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Search results"
              className="reader-search-list m-0 grid list-none gap-1 overflow-y-auto p-0"
            >
              {results.map((hit, i) => (
                <li
                  key={`${hit.url}-${i}`}
                  id={`${listId}-option-${i}`}
                  role="option"
                  aria-selected={i === clamped}
                  data-active={i === clamped ? "true" : undefined}
                  className="reader-search-option rounded-md hover:bg-muted aria-selected:bg-muted aria-selected:outline-2 aria-selected:-outline-offset-2 aria-selected:outline-primary"
                  onMouseMove={() => setActive(i)}
                >
                  <a
                    href={hit.url}
                    tabIndex={-1}
                    className="reader-search-result grid min-h-11 min-w-0 gap-0.5 rounded-md px-3 py-2.5 text-inherit no-underline"
                  >
                    <span className="reader-search-result-title min-w-0 wrap-break-word text-sm font-bold text-primary">
                      {hit.title}
                    </span>
                    <span className="reader-search-result-url min-w-0 wrap-break-word text-xs text-muted-foreground">
                      {hit.url}
                    </span>
                    <span
                      className="reader-search-result-excerpt min-w-0 wrap-break-word text-13 text-muted-foreground"
                      dangerouslySetInnerHTML={{ __html: hit.excerpt }}
                    />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="reader-search-hints flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Kbd className="border border-border bg-card text-2xs">↑↓</Kbd>
              <span>navigate</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd className="border border-border bg-card text-2xs">↵</Kbd>
              <span>open</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd className="border border-border bg-card text-2xs">esc</Kbd>
              <span>close</span>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
