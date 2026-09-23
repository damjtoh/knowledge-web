/**
 * Generic static search for the reader (MiniSearch integration glue).
 *
 * MiniSearch owns indexing and query behavior; this module only maps the
 * staged page extraction (title, url, headings, body segments) onto
 * MiniSearch documents, and shapes hits for readers. No per-Knowledge-Base
 * content lives here.
 *
 * MiniSearch is the spec-sanctioned fallback: the bundled engines could
 * not combine partial-word and typo-tolerant matching in one query
 * without custom search logic.
 *
 * Hit shape for consumers (including the later Search dialog):
 * `{ title, url, excerpt }`.
 */

import MiniSearch from "minisearch"

const EXCERPT_RADIUS = 60
const EXCERPT_FALLBACK_LENGTH = 140
const DEFAULT_LIMIT = 50

function miniOptions() {
  return {
    fields: ["title", "content"],
    storeFields: ["pageTitle", "url", "content"],
    searchOptions: {
      boost: { title: 2 },
      prefix: true,
      fuzzy: 0.34,
      combineWith: "AND",
    },
  }
}

/**
 * Query options shared by every search: title boost, prefix matching,
 * typo tolerance, all-terms matching.
 *
 * Fractional fuzzy rounds `term.length * value` to the nearest integer,
 * so 0.2 allows only 1 edit in a 6-letter term — too strict for a
 * transposition (Levenshtein distance 2). 0.34 allows 2 edits in terms
 * of length 5 and above while keeping 1 edit for shorter terms.
 */
function queryOptions() {
  return {
    boost: { title: 2 },
    prefix: true,
    fuzzy: 0.34,
    combineWith: "AND",
  }
}

/**
 * One MiniSearch document per page plus one per heading/body segment, so
 * every hit carries an excerpt tied to its own matching text. The page
 * title is indexed (boosted) only on the page document; segment
 * documents keep the page title as a stored field so the short,
 * exact title match ranks above longer body matches.
 */
function pageDocuments(page) {
  const docs = [
    {
      id: `page:${page.url}`,
      title: page.title,
      content: page.title,
      pageTitle: page.title,
      url: page.url,
    },
  ]
  let n = 0
  for (const heading of page.structuredData.headings ?? []) {
    if (!heading.content) continue
    n += 1
    docs.push({
      id: `${page.url}#h${n}`,
      title: "",
      content: heading.content,
      pageTitle: page.title,
      url: `${page.url}#${heading.id}`,
    })
  }
  for (const segment of page.structuredData.contents ?? []) {
    if (!segment.content) continue
    n += 1
    docs.push({
      id: `${page.url}#t${n}`,
      title: "",
      content: segment.content,
      pageTitle: page.title,
      url: segment.heading ? `${page.url}#${segment.heading}` : page.url,
    })
  }
  return docs
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Short window around the first matched term; leading text on fallback. */
function excerptFor(content, query) {
  const text = String(content ?? "")
  const terms = String(query ?? "")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
  let first = -1
  let firstLength = 0
  for (const term of terms) {
    const at = text.toLowerCase().indexOf(term.toLowerCase())
    if (at !== -1 && (first === -1 || at < first)) {
      first = at
      firstLength = term.length
    }
  }
  if (first === -1) {
    const head = text.slice(0, EXCERPT_FALLBACK_LENGTH)
    return text.length > EXCERPT_FALLBACK_LENGTH ? `${head}…` : head
  }
  const start = Math.max(0, first - EXCERPT_RADIUS)
  const end = Math.min(text.length, first + firstLength + EXCERPT_RADIUS)
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi")
  let snippet = text.slice(start, end).replace(pattern, "<mark>$1</mark>")
  if (start > 0) snippet = `…${snippet}`
  if (end < text.length) snippet = `${snippet}…`
  return snippet
}

/**
 * Build a serializable search index from extracted staged pages
 * (`{ title, url, structuredData }` each). Returns the MiniSearch JSON
 * object, ready for `JSON.stringify` into the static export.
 */
export function buildSearchIndex(pages) {
  const mini = new MiniSearch(miniOptions())
  for (const page of pages) mini.addAll(pageDocuments(page))
  return mini.toJSON()
}

/**
 * Reconstruct a search index previously built with `buildSearchIndex`.
 *
 * Accepts the raw JSON string or an already-parsed object (the shape a
 * `fetch` + `res.json()` consumer holds). MiniSearch deserializes from
 * a string only, so objects round-trip through `JSON.stringify` first.
 */
export function loadSearchIndex(data) {
  const json = typeof data === "string" ? data : JSON.stringify(data)
  return MiniSearch.loadJSON(json, miniOptions())
}

/** Ranked `{ title, url, excerpt }` hits for a query; `[]` when blank. */
export function searchNotes(index, query, limit = DEFAULT_LIMIT) {
  const q = String(query ?? "").trim()
  if (q === "") return []
  return index
    .search(q, queryOptions())
    .slice(0, limit)
    .map((hit) => ({
      title: hit.pageTitle,
      url: hit.url,
      excerpt: excerptFor(hit.content, q),
    }))
}
