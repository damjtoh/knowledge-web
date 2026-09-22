# 02 — Resolve authored titles and wikilinks

**What to build:** Make the static reader use human-authored titles and follow
the existing body wikilinks in Shared knowledge. Keep wikilink syntax in the
maintained plugin and add only the small repository-specific alias mapping
needed to connect titles and stable routes.

**Blocked by:** 01 — Render staged Shared Markdown as a static reader.

**Status:** ready-for-agent

- [ ] Display titles use explicit non-empty frontmatter title, then first H1, then filename fallback.
- [ ] Root and nested index pages use their containing route; other page routes remove the Markdown extension.
- [ ] Title, filename, path, and nested-index aliases map deterministically to stable reader routes.
- [ ] The repository-specific alias adapter remains below approximately 150 lines and does not parse wikilink syntax.
- [ ] `@flowershow/remark-wiki-link` remains responsible for target, alias, and heading-fragment syntax.
- [ ] A real title-based Shared wikilink resolves to the intended reader page.
- [ ] Filename and path wikilinks continue to resolve.
- [ ] Aliased labels and heading fragments preserve their authored behavior.
- [ ] Duplicate normalized aliases fail the build and report every candidate source-relative path.
- [ ] Missing targets do not fail the build and render with a clear unresolved state.
- [ ] Wikilink-like text inside inline code and code blocks remains literal.
- [ ] Frontmatter relationships remain preserved metadata and are not resolved in this slice.
- [ ] Focused tests cover title priority, route derivation, alias resolution, ambiguity, unresolved links, and deterministic results.
- [ ] A real Shared production build completes without a custom compiler, renderer, sanitizer, or compatibility-report framework.
