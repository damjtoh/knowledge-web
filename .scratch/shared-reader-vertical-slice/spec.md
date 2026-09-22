# Shared reader vertical slice

Status: ready-for-agent

## Problem Statement

The current Shared Web Projection uses Quartz presentation patterns that feel
like documentation rather than a human knowledge reader. Broad collections
and folder listings do not provide a clear phone-first path through household
knowledge. The replacement work has proved safe allowlisted staging and
body-wikilink syntax, but it has not yet proved that real staged Markdown can
power a useful custom reader without recreating a Markdown platform.

The next release slice must prove one complete reading journey with real
Shared content. It must preserve the Publication Manifest as the publication
authority and avoid another large custom compiler.

## Solution

Build one static Shared reader journey:

```text
Shared home -> Travel -> nested page list -> note
```

Use a Next.js App Router static export with Fumadocs MDX/Core as a headless
content source. Use a custom reader interface rather than Fumadocs UI. Keep
`@flowershow/remark-wiki-link` responsible for body-wikilink syntax and add
only a small repository adapter for title and route aliases.

The home page presents the five selected Shared areas. Desktop uses a clear
area sidebar. Mobile uses a compact Browse surface without a permanent
sidebar. Real notes render with comfortable reading typography and safe
overflow behavior. Search, offline use, and the Damian projection remain later
work.

## User Stories

1. As a household reader, I want a clear Shared home page, so that I can choose an area without understanding repository structure.
2. As a household reader, I want to see Travel, Shared Finance, Pets, Life Planning, and Household Inbox, so that the home page matches the selected Shared projection.
3. As a household reader, I want unpublished repository areas to stay absent, so that the reader does not imply that private content is available.
4. As a household reader, I want the Travel card to open the authored Travel area, so that the area introduction remains useful.
5. As a household reader, I want nested Travel pages grouped by folder, so that upcoming trips, past trips, and preferences remain understandable.
6. As a household reader, I want page titles derived from authored titles rather than filenames, so that navigation uses human language.
7. As a household reader, I want an authored frontmatter title to take priority, so that an explicit title remains authoritative.
8. As a household reader, I want the first H1 used when no frontmatter title exists, so that Tolaria notes keep their expected display names.
9. As a household reader, I want a filename fallback when a note has no title, so that every staged page remains reachable.
10. As a household reader, I want `index.md` pages to represent their containing area or folder, so that URLs do not expose implementation filenames.
11. As a household reader, I want ordinary notes to keep stable path-based routes, so that links remain predictable across builds.
12. As a household reader, I want title-based wikilinks such as `[[Life Planning]]` to reach the correct page, so that authored knowledge links work on the web.
13. As a household reader, I want filename and path wikilinks to keep working, so that existing Markdown does not require reorganization.
14. As a household reader, I want wikilink aliases and heading fragments to work, so that authored labels and section links retain their meaning.
15. As a publisher maintainer, I want duplicate aliases to fail with candidate details, so that routing never selects an arbitrary page.
16. As a household reader, I want genuinely missing wikilinks to remain visible as unresolved, so that incomplete knowledge does not break the site.
17. As a publisher maintainer, I want wikilink syntax handled by a maintained package, so that the Publisher does not own a custom parser.
18. As a publisher maintainer, I want the reader to consume only staged content, so that no renderer can bypass the Allowlist.
19. As a publisher maintainer, I want all selected Shared Markdown to build, so that the vertical slice tests the real corpus rather than synthetic examples only.
20. As a publisher maintainer, I want staged non-Markdown files excluded from page discovery, so that attachments are not treated as notes.
21. As a household reader, I want tables and task lists to render correctly, so that planning notes retain their structure.
22. As a household reader, I want external links and images to remain usable, so that reference-rich notes keep their supporting material.
23. As a household reader, I want code spans and code blocks to remain literal, so that wikilink-like examples are not converted accidentally.
24. As a household reader, I want a persistent area sidebar on desktop, so that I can move between major Shared areas quickly.
25. As a household reader, I want the current area and page to be visually clear, so that I always know my location.
26. As a household reader, I want breadcrumbs on nested pages, so that I can return to Travel or its parent folder.
27. As a phone user, I want content to be primary, so that navigation controls do not crowd the viewport.
28. As a phone user, I want Browse to open a compact area and folder surface, so that a permanent sidebar does not reduce reading space.
29. As a phone user, I want large touch targets, so that navigation is reliable with one hand.
30. As a phone user, I want predictable browser Back behavior, so that I can return through the journey without unexpected redirects.
31. As a reader, I want a comfortable line length and heading hierarchy, so that long notes remain readable.
32. As a reader, I want wide tables, code, and images contained without page-level horizontal scrolling, so that one wide element does not break the layout.
33. As a keyboard user, I want visible focus and semantic landmarks, so that the reader remains navigable without a pointer.
34. As a reader, I want direct page URLs to load correctly in the static export, so that bookmarks and refreshed pages work.
35. As a publisher maintainer, I want the static export to require no application server, so that nginx remains the runtime.
36. As a publisher maintainer, I want the Shared identity generated by staging to appear in page metadata, so that the projection does not use generic placeholders.
37. As a publisher maintainer, I want no private source paths or unstaged content in output, so that the public Publisher boundary stays safe.
38. As a publisher maintainer, I want Quartz retained during this slice, so that the existing Web Projections remain available for rollback.
39. As a product owner, I want this slice to stop after one complete reading journey, so that search and offline work are based on a proven reader.
40. As a future implementer, I want the content integration seam documented, so that later search and PWA work reuse the same staged source rather than adding another compiler.

## Implementation Decisions

- Use Next.js App Router with static export. The emitted reader must run as
  static files without a Node.js production server.
- Use Fumadocs MDX/Core only as a headless content source. Do not use its
  documentation UI or navigation theme.
- Configure the content source to read the isolated staged content tree. It
  must not accept or discover the original Knowledge Base root.
- Continue using `@flowershow/remark-wiki-link` for body-wikilink syntax. The
  working dependency line remains locked until its broken major-version
  package is republished correctly.
- Build a small alias adapter around staged page metadata. It supplies
  title, filename, path, and nested-index aliases plus stable permalinks to the
  wikilink plugin.
- Keep the alias adapter below approximately 150 lines of project-owned code.
  Do not add a general Markdown compiler, renderer, sanitizer, or normalized
  page-model framework.
- Apply title priority in this order: explicit non-empty frontmatter title,
  first H1, then filename without the Markdown extension.
- Collapse root `index.md` to `/` and nested `index.md` to its containing
  directory route. Strip `.md` from other page routes.
- Treat duplicate normalized aliases as build failures. Include every
  candidate source-relative path in the failure.
- Allow unresolved wikilinks to build. Render them with a visible unresolved
  state supplied by the plugin.
- Do not resolve wikilinks stored only in frontmatter during this slice.
  Preserve frontmatter as content metadata for later features.
- Derive the Shared home from staged top-level selections and authored area
  indexes. The visible labels are Travel, Shared Finance, Pets, Life Planning,
  and Household Inbox.
- Use authored area `index.md` content as the area introduction. Do not infer
  or display unselected Knowledge Base areas.
- Use folders as the reader's browsing structure. Keep `type`, `status`, tags,
  and relationships as metadata rather than primary navigation.
- Implement a custom shell with a desktop area sidebar, breadcrumbs, centered
  reading column, and a mobile Browse surface.
- Keep navigation state in URLs and normal browser history. Do not create a
  parallel client-side back stack.
- Use the site identity generated during staging for the document title and
  canonical hostname metadata.
- Keep the final reader build disposable and read-only. It has no database,
  writable content storage, runtime Git access, authentication code, or API.
- Retain Quartz and its existing build assets during this slice for rollback.
  Do not remove or migrate consumer Dockerfiles yet.
- Do not commit staged Shared content, generated source modules containing
  private content, or static build output.

## Testing Decisions

- Use one primary seam: build the production static reader from a real staged
  Shared projection, serve the output, and exercise the full
  Home-to-Travel-to-note journey in a browser.
- Test user-visible behavior rather than React component internals or
  Fumadocs implementation details.
- Preserve the existing staging contract suite as the security boundary. The
  browser suite starts only after staging succeeds.
- Add focused pure tests only for the small alias adapter. Cover title
  priority, index route collapse, title and path aliases, deterministic output,
  duplicate ambiguity, and unresolved targets.
- Reuse the existing production-browser test style used for responsive Quartz
  regression coverage. Replace Quartz-specific assertions only when the new
  route is under test; do not remove rollback coverage yet.
- Exercise at least a narrow phone viewport, a larger phone viewport, and a
  desktop viewport.
- Verify the Shared home exposes exactly the five selected areas and does not
  expose a known unselected sentinel.
- Verify Travel opens its authored area page, nested navigation reaches a real
  note, breadcrumbs return to the correct parents, and browser Back returns
  predictably.
- Verify one real table, task list, external link, external image, code sample,
  resolved wikilink, and unresolved wikilink.
- Verify long titles, breadcrumbs, tables, code, and images do not cause
  page-level horizontal overflow.
- Verify semantic main/navigation landmarks, one primary page heading, visible
  keyboard focus, and usable touch-target sizes.
- Verify direct navigation and refresh for nested static routes through the
  nginx-style fallback contract.
- Inspect the static output for known unselected sentinel content, absolute
  private source paths, and generated files that contain content outside the
  staged tree.
- A good acceptance test fails because the reader journey is broken, content
  escaped the Allowlist, or rendered output is unusable. It must not fail
  because an internal component or framework API changed without changing
  behavior.

## Out of Scope

- Full-text search and search-result ranking.
- Long-list pagination, virtualization, and metadata filters beyond the
  Travel nested view needed for this journey.
- Recent-page history and device-local favorites.
- PWA manifests, installation, service workers, offline reading, offline
  search, and cache updates.
- The Damian Web Projection and its flat Library corpus.
- Frontmatter relationship resolution.
- Obsidian embeds, callouts, math, and other syntax absent from the selected
  Shared corpus.
- Editing, capture, browser uploads, runtime Git synchronization, ISR, APIs,
  databases, and durable user state.
- Domain App behavior such as workout tracking, finance operations, or travel
  planning workflows.
- Deployment migration, consumer Dockerfile changes, production-origin
  rollout, and rollback execution.
- Removing Quartz, its plugins, tests, lock artifacts, or build scripts.
- Reorganizing canonical Knowledge Base files to satisfy the reader.
- A generic plugin system, generic theme system, or reusable design system.

## Further Notes

- The current Shared Publication Manifest selects 53 Markdown files. Staging
  adds one synthetic landing page, so the real reader input contains 54 pages.
- The wikilink spike found 42 body-text wikilinks: one resolved by filename
  alone and 41 were marked unresolved. Many valid links use first-H1 titles,
  which is why this slice needs the bounded alias adapter.
- The spike also found 195 wikilinks in frontmatter and 29 occurrences in code.
  Frontmatter links remain deferred; code occurrences must stay literal.
- The selected Shared corpus currently has no staged attachments. Attachment
  caching and media policy remain later PWA work.
- The Publisher branch retains Quartz for rollback. Consumer Knowledge Bases
  still pin the prior Publisher revision until a later deployment migration.
