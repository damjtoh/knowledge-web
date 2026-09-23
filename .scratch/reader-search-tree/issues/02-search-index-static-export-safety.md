# 02 — Search index and static export safety

**What to build:** A build-time full-text search index over staged, Allowlisted
Markdown, searchable locally in the browser with no server. Try the installed
Fumadocs Core static-search path first; fall back to MiniSearch only if the
agreed behaviors cannot be met without disproportionate custom logic.

**Blocked by:** none.

**Status:** ready-for-agent

- [x] The static export contains a search index built from staged content only.
- [x] Index covers titles, headings, and readable body text of all published pages, including pages omitted from `navigation`.
- [x] Fenced code blocks and frontmatter-only metadata do not become readable-text matches; assets stay out.
- [x] Title matches rank above weaker body matches; partial words match; one small typo matches.
- [x] Results supply title, location, and a short contextual excerpt.
- [x] A known unselected sentinel never appears in the exported index or search output; a published page hidden from navigation remains searchable.
- [x] The exported Web Projection remains fully static with no API route or runtime service.
- [x] Engine choice is recorded with evidence from the synthetic export before the dialog work starts.

## Comments

- 2026-09-23: Implemented in `8c349e0`. Engine evidence (measured against installed packages via probe exports): Fumadocs FlexSearch static client does substring partial matching but has no typo support and exposes no knobs; Fumadocs default ZBSearch supports `tolerance` but its own types state prefix matching is ignored when tolerance is set, so partial-word and typo matching cannot coexist in one query. Per the spec's fallback rule, MiniSearch is used (`reader/lib/search.mjs` integration glue; `minisearch` direct dep). Query options: `prefix: true`, `fuzzy: 0.34` (Levenshtein 2 edits at length 6, needed for the `sunlti` transposition), `boost: { title: 2 }`, `combineWith: "AND"`.
