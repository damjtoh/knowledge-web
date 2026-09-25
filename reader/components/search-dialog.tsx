"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog"
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
      <DialogContent className="reader-search-dialog sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Search</DialogTitle>
        </DialogHeader>
        <div className="reader-search-body">
          <label htmlFor={SEARCH_INPUT_ID} className="sr-only">
            Search notes
          </label>
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
            className="reader-search-input"
          />
          <div id={statusId} role="status" aria-live="polite" className="reader-search-status">
            {statusText !== "" ? <span>{statusText}</span> : null}
            {open && trimmed === "" ? <span>Type to find a note.</span> : null}
          </div>
          {results.length > 0 ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Search results"
              className="reader-search-list"
            >
              {results.map((hit, i) => (
                <li
                  key={`${hit.url}-${i}`}
                  id={`${listId}-option-${i}`}
                  role="option"
                  aria-selected={i === clamped}
                  data-active={i === clamped ? "true" : undefined}
                  className="reader-search-option"
                  onMouseMove={() => setActive(i)}
                >
                  <a href={hit.url} tabIndex={-1} className="reader-search-result">
                    <span className="reader-search-result-title">{hit.title}</span>
                    <span className="reader-search-result-url">{hit.url}</span>
                    <span
                      className="reader-search-result-excerpt"
                      dangerouslySetInnerHTML={{ __html: hit.excerpt }}
                    />
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
