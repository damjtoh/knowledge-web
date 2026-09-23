# Full-text search and tree navigation for the reader

Status: ready-for-agent

## Problem Statement

Readers can browse published roots and folder pages, but the sidebar does not
expose the existing nested navigation tree. Finding a note takes several page
visits, and there is no full-text search or quick keyboard route to a known
note. The same problem appears on phones, where Browse currently provides
limited section links rather than the complete hierarchy.

## Solution

Give every Web Projection a browsable folder-and-note tree and a full-text
Search dialog. Show the tree in the persistent desktop sidebar and behind
Browse on phones. Put a visible Search control in the desktop sidebar and the
phone header; also open Search with Command+K or Control+K. Search titles,
headings, and readable note text from all Allowlisted Markdown pages, including
pages omitted from visible navigation. Show ranked results with a title,
location, and short contextual excerpt. The Web Projection remains a generic,
read-only static export generated entirely from staged content.

## User Stories

1. As a reader, I want to see published folders and notes in the sidebar, so that I can understand the shape of the Knowledge Base.
2. As a reader, I want to open a folder branch without leaving my page, so that I can inspect its children.
3. As a reader, I want to visit a folder's own page, so that I can read its authored introduction or virtual folder listing.
4. As a reader, I want separate controls for visiting a folder and expanding it, so that neither action surprises me.
5. As a reader, I want several branches open together, so that I can compare nearby sections.
6. As a reader, I want the current page's ancestors open when I arrive, so that I can locate the page in the tree.
7. As a reader, I want a branch I deliberately closed to stay closed on the current page, so that automatic expansion does not fight my choice.
8. As a reader, I want open branches to survive page visits and browser Back during my session, so that I do not repeatedly reopen them.
9. As a reader, I want the current page and its section indicated clearly, so that I know where I am.
10. As a reader, I want the published root order and child order preserved, so that the tree matches the Publication Manifest and folder pages.
11. As a reader, I want deep folders and long titles to remain readable, so that a large Knowledge Base is usable.
12. As a phone reader, I want the note to remain primary until I open Browse, so that the tree does not crowd the screen.
13. As a phone reader, I want the same tree in Browse as on desktop, so that I can reach any visible branch.
14. As a phone reader, I want Browse to close when I select a page, so that I can start reading immediately.
15. As a reader, I want a visible Search control, so that I can discover search without knowing a shortcut.
16. As a keyboard reader, I want Command+K or Control+K to open Search, so that I can find a note quickly.
17. As a reader, I want one Search dialog on desktop and phone, so that the interaction is predictable.
18. As a reader, I want title, heading, and body matches, so that I can find a note even when I do not know its title.
19. As a reader, I want title matches ranked above weaker body matches, so that likely results appear first.
20. As a reader, I want partial words and small spelling mistakes to work, so that exact wording is unnecessary.
21. As a reader, I want each result to show its title, location, and a short excerpt, so that I can choose the right page.
22. As a reader, I want a clear no-results state, so that I know when a query did not match.
23. As a keyboard reader, I want to type, move through results, open a result, and close Search without a pointer, so that the entire search journey works by keyboard.
24. As a reader, I want Search to return focus to where I opened it when I close it, so that I do not lose my place.
25. As a reader, I want published pages hidden from sidebar navigation to remain searchable, so that navigation presentation does not silently remove knowledge from Search.
26. As a reader, I want fenced code blocks and frontmatter values excluded from readable-text matches, so that results reflect note content rather than syntax or metadata.
27. As a reader, I want Search and tree links to open normal published URLs, so that bookmarks, refresh, and browser Back work.
28. As a Knowledge Base owner, I want unselected content and assets absent from Search and the tree, so that the Publication Manifest Allowlist remains authoritative.
29. As a Knowledge Base owner, I want the same features for any Publication Manifest, so that no Knowledge Base needs custom search or navigation code.
30. As a Knowledge Web Publisher maintainer, I want the search index produced at build time from staged content, so that the Web Projection needs no application server or content API.
31. As a Knowledge Web Publisher maintainer, I want the search library to own indexing and query behavior, so that the Publisher does not grow a custom search engine.

## Implementation Decisions

- Reuse the existing generic navigation tree, its published roots, authored and
  virtual folder routes, and its stable ordering. Render its nested nodes in
  the desktop sidebar and the phone Browse panel. Do not derive a second tree
  from the Knowledge Base or frontmatter relationships.
- Keep a folder's link distinct from its disclosure control. Leaf notes are
  links. Multiple branches may remain expanded. Initialize the current page's
  ancestor branches as expanded; keep user-controlled expansion during the
  browser session and respect a deliberate close until navigation changes.
  Navigation and browser Back continue to use normal URLs and history.
- Keep the phone Browse panel closed while reading. Opening it shows the same
  navigable tree and the current page's branch; selecting a page closes it.
  Trial this layout at phone widths before considering a different phone view.
- Use one Search dialog across desktop and phone. A visible control opens it;
  Command+K and Control+K open or focus it. Provide accessible dialog, input,
  result selection, loading, empty, and no-results states. Escape closes it
  and focus returns to the control that had focus before it opened. Results
  link to normal static page routes.
- Build the search index only from the staged headless Markdown source. Index
  published authored pages regardless of whether a Publication Manifest
  `navigation` list exposes them as tree roots. Index titles, headings, and
  readable body text; exclude frontmatter-only metadata, fenced code, and
  binary assets. Keep snippets tied to the matching text where supported.
- Try the installed Fumadocs Core static-search path first: generate its index
  at build time and search locally in the browser. Verify title ranking,
  partial-word matches, modest typo tolerance, excerpts, and static-export
  compatibility against the installed version. Use MiniSearch only if the
  Fumadocs path cannot satisfy those agreed behaviors without disproportionate
  custom logic. Do not add a runtime search service or write a custom engine.
- Use official shadcn registry/CLI components for Dialog and Collapsible,
  integrated with the existing reader styling and controls. Use the registry
  rather than hand-writing shadcn component source. Do not adopt an unrelated
  documentation theme or replace the existing reader shell.
- Keep the reader generic and static: staging is the only content input;
  generated site metadata controls published navigation roots; the Publication
  Manifest Allowlist controls what can enter the page model, search index, and
  final image. Do not change canonical Knowledge Base notes for these features.

## Testing Decisions

- Use the confirmed highest seam: stage a neutral synthetic Knowledge Base,
  build the production static Web Projection, serve the exported files, and
  exercise tree browsing and Search in a browser. Assert what readers can see
  and open, not React state, CSS classes, library internals, or search-index
  serialization format.
- Extend the existing reader desktop and phone browser journeys. Check folder
  link versus disclosure, multiple expanded branches, current-page ancestors,
  deliberate close, navigation and browser Back, and Browse closing after a
  page selection. Use representative desktop and phone widths.
- In the same exported browser journey, check visible Search and keyboard
  shortcut, title and body matches, partial word and small typo, title ranking,
  contextual result, no-results feedback, keyboard selection, Escape and
  focus return, and navigation to a direct static route.
- Extend the existing static-export safety check with a known unselected
  sentinel and a published page omitted from navigation: the sentinel must
  never appear in search output or the exported index, while the published
  hidden-navigation page must remain searchable. Verify code and frontmatter
  examples do not become readable-text matches.
- Preserve the staging and reader contract tests as prior art for Allowlist
  safety, canonical URLs, and static runtime output. Run the relevant reader
  test suite and contract checks after implementation, plus manual desktop
  and phone inspection for tree density and Search usability.
- A good test fails when a reader cannot find or browse published content, a
  static URL breaks, or content escapes the Allowlist. It does not fail just
  because the search or dialog library changes internally.

## Out of Scope

- Editing, drag-and-drop reordering, Notion-style page creation, and changes
  to the canonical Knowledge Base.
- Search filters or query operators such as `title:` and `folder:`; remote or
  server-backed search; search over assets, code blocks, or frontmatter values.
- A new metadata navigation taxonomy, per-Knowledge-Base special cases,
  offline/PWA behavior, and deployment changes.
- A separate search-results page, recent searches, and personalization.

## Further Notes

- ADR-0002 already assigns full-text search to the static reader. ADR-0003
  defines generic navigation roots and makes `navigation` presentation-only;
  it does not narrow the Allowlist or the set of published pages searchable by
  readers.
- The current headless content source already provides structured document
  text for search. The installed search package exposes a static index export
  and browser client. Confirm actual output and query behavior in the
  synthetic Web Projection rather than assuming current online documentation
  exactly matches the pinned package.
- The phone tree is an intentional first trial. Reader observation can guide
  later adjustments without changing the publication or search contracts.
- Recommended issue order is 01, 02, 03, then 04 once. Issues 01 and 02 are
  independent, but running them in parallel doubles full reader builds and
  risks merge drift; serial work reuses one build per issue.
