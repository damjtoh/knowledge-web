/**
 * Declarations for the generic static search module (`search.mjs`).
 *
 * The implementation stays dependency-light plain JavaScript so the
 * build script can load it under plain Node; these types keep the
 * Next.js typecheck and editors honest about the small interface the
 * Search dialog will consume.
 */

import type MiniSearch from "minisearch"

export interface StructuredSegment {
  content: string
  heading?: string
}

export interface StructuredHeading {
  id: string
  content: string
}

export interface StructuredPageData {
  contents: StructuredSegment[]
  headings: StructuredHeading[]
}

/** One extracted staged page: display title, route, structured text. */
export interface SearchPageInput {
  title: string
  url: string
  structuredData: StructuredPageData
}

/** One ranked hit: page title, location, contextual excerpt. */
export interface SearchHit {
  title: string
  url: string
  excerpt: string
}

/** JSON value owned by the serialized MiniSearch payload. */
export type SearchIndexJson =
  string | number | boolean | null | SearchIndexJson[] | { [key: string]: SearchIndexJson }

/** Serializable index data as produced by `buildSearchIndex`. */
export type SearchIndexData = Record<string, SearchIndexJson>

/** Opaque reconstructed index; pass it back to `searchNotes`. */
export type SearchIndex = MiniSearch

export function buildSearchIndex(pages: SearchPageInput[]): SearchIndexData
export function loadSearchIndex(data: string | SearchIndexData): SearchIndex
export function searchNotes(index: SearchIndex, query: string, limit?: number): SearchHit[]
