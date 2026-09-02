# Provenance and pinning

This repository owns a pinned copy of the Quartz v5 build machinery. This
document records exactly what was imported, how every local delta is layered,
and how every dependency is pinned, so future maintainers can verify and
reproduce builds. The vendored Quartz source is **not** unmodified; the delta
below is intentional and documented.

## Quartz source

- Upstream: https://github.com/jackyzha0/quartz (v5 line)
- Package version: `5.0.0` (`package.json`)
- Upstream revision: `81db804f54a9a64cdf2cc09e856e562511d143c8`
  (2026-06-09, "fix(themes): callouts and layout issues")
- Import path: the `quartz/` directory was vendored from the Travel Knowledge
  Base's previous implementation, which carried this exact upstream snapshot.
  Initial Publisher commit is `114d2a4` ("feat: add knowledge web publisher").

### Local delta relative to upstream 81db804f

The vendored copy contains a small, intentional delta layered via the publisher
commit chain (`114d2a4` → `a973dcd` → `24831f1` → `ddd47c1` → `1ee305f` → `b4b4845`
→ `188bfc3` → `fd03d47` and this change). Every remaining vendored change is
necessary for generic plugin plumbing or existing Publisher behavior accepted in
issues #2–#5, is minimal, and is covered by focused tests. No Knowledge Vault
presentation-specific component, style, or browser behavior is scattered in
vendored Quartz; that ownership lives in the local plugin (see below).

#### 1. Content scanning — `quartz/util/glob.ts` (1 line)

```diff
--- a/quartz/util/glob.ts
+++ b/quartz/util/glob.ts
-      gitignore: true,
+      gitignore: false,
```

`content` scanning does not apply repository `.gitignore` rules, so staged
content is indexed exactly as allowlisted. Already present in the initial
vendored copy and preserved intentionally.

Covered by: `tests/stage-content.test.mjs` and full-build acceptance (byte
preservation).

#### 2. Tag pages — generic browsing (issue #2)

- `quartz/plugins/pageTypes/tag.ts`, `quartz/components/TagContent.tsx`
- `quartz/util/tags.ts` + `quartz/util/tags.test.ts`
- `quartz/plugins/loader/config-loader.ts` — registers builtin `TagPageType`
  alongside `NotFoundPageType`; `quartz/plugins/emitters/componentResources.ts`
  wiring is unchanged for this feature.

Provides per-tag virtual pages (`tags/<tag>`) and `tags/index` without
promoting a complete tag cloud as primary navigation. Direct tag routes and
tag metadata remain functional.

Covered by: `quartz/util/tags.test.ts`, `tests/knowledge-vault.test.mjs` (tag
routes), `tests/knowledge-vault-collections.test.mjs`, `tests/knowledge-vault-dashboard.test.mjs`.

#### 3. Folder listing — client-side filter, tag facets, sort (issue #3)

- `quartz/components/scripts/folderFilters.inline.ts`,
  `quartz/components/styles/folderFilters.scss`
- `quartz/util/folderFilters.ts` + `quartz/util/folderFilters.test.ts`
- `quartz/plugins/emitters/componentResources.ts` — loads `folderFiltersScript`
  and `folderFiltersStyle` globally (afterDOMLoaded + css).

Progressively enhances static folder listings (`.page-listing .section-ul`) with
title/tag filter, tag-chip facets scoped to the current folder, and
A–Z/newest sort. Not a vault-wide tag cloud; not used on collection or
dashboard pages (those use `.kv-collection` / `.kv-dashboard`).

Covered by: `quartz/util/folderFilters.test.ts`, layout/browser tests for
folder pages.

#### 4. Search enhancements — tag:/#, title boost, folder context, SPA reattachment (issue #4)

- `quartz/components/scripts/searchUpgrades.inline.ts`,
  `quartz/components/styles/searchUpgrades.scss`
- `quartz/util/search.ts` + `quartz/util/search.test.ts`
- `quartz/plugins/emitters/componentResources.ts` — loads `searchUpgradesScript`
  globally.

Makes tags searchable via `tag:foo` and `#foo`, supplements tag-substring
matches, re-ranks title matches above content-only matches, injects folder
context (`.search-folder`), and reattaches after SPA navigation via
`document.addEventListener("nav")` + `window.addCleanup`. Generic publisher
behavior; preserved by issue #6 non-goals.

Covered by: `quartz/util/search.test.ts`,
`quartz/components/scripts/search.test.ts`,
`tests/knowledge-vault-layout.test.mjs` (dashboard search: tag:/#, title boost,
folder, SPA).

#### 5. Content metadata — public search/metadata index (issue #4 follow-up)

- `quartz/plugins/emitters/contentMetadata.ts` +
  `quartz/plugins/emitters/contentMetadata.test.ts`
- `quartz/plugins/emitters/index.ts`, `quartz/plugins/loader/config-loader.ts`
  — adds `ContentMetadata` to builtin emitters.

Emits `static/contentMetadata.json` (slug, title, tags, date, description)
deterministically sorted. Used by full-build acceptance for title/tag
assertions and by search upgrades for folder/ranking.

Covered by: `quartz/plugins/emitters/contentMetadata.test.ts`, full-build
acceptance.

#### 6. Generic plugin plumbing for Knowledge Vault (issues #5–#6) — minimal

- `quartz/plugins/loader/config-loader.ts` — multi-category plugin support:
  correctly categorizes a single package that declares `category:
["transformer","pageType","component"]` via `quartzCategory` static marker
  on the factory, without double-invoking factories. Adds `findFactory`
  export for testing and orders `transformers/filters/emitters/pageTypes`
  separately. No Vault-specific presentation logic remains here; the plugin
  seam now owns presentation.

- `quartz/cli/plugin-git-handlers.js` + `quartz/cli/plugin-git-handlers.test.js`
  — understands `commit: "local"` and relative `source`/`resolved`
  (`./plugins/knowledge-vault`), resolves absolute local paths portably,
  symlinks or copies on install, and keeps `isLocalSymlinkCorrect` portable.
  Required for the Knowledge Vault local plugin.

- `quartz/plugins/pageTypes/dispatcher.ts` — marks generated virtual pages
  with `isVirtualPage`, merges `virtualPages` into `allFiles` for transclusion
  (`htmlAst` population), and ensures `trie` is available to page types that
  need folder hierarchy. Generic page-type dispatcher improvement; no
  collection/dashboard markup here.

Covered by: `quartz/plugins/loader/config-loader.test.ts`,
`quartz/cli/plugin-git-handlers.test.js`, collection/dashboard/home
full-build acceptance (priority, `quartzCategory`, symlink restore,
collision-safe routes).

#### 7. Layout coherence at narrow viewport (issue #6)

- `quartz/styles/variables.scss` — `$mobileGrid.templateColumns` changed from
  `auto` to `minmax(0, 1fr)` so the single-column mobile grid is constrained
  to the viewport width instead of expanding to its widest child's
  max-content. Without this, `#quartz-body` at 360 px expanded to ~493 px
  (child max-content) and caused horizontal overflow on every page type.

This is a minimal, generic grid fix (one token) required for C7 desktop/narrow
coherence; no Vault markup is added to `quartz/`. Vault-specific containment
(`#quartz-body` children `min-width: 0`, dashboard
`grid-template-columns: minmax(0, 1fr)`) is owned by the local plugin via
`CollectionNav`/`Dashboard` `Component.css` (emitted as `component-*.css`).

Covered by: `tests/knowledge-vault-layout.test.mjs` (narrow 360 px and
desktop 1280 px, body `scrollWidth <= clientWidth` across content/collection/
tag/dashboard/home/404, plus section order and focus).

No other vendored Quartz source difference is retained. Presentation-specific
Vault markup, styles, and browser behavior (collection navigation, dashboard
sections, collection pages) are not duplicated in `quartz/`; they are owned by
the local plugin and loaded through documented Quartz v5 seams (see below).

## Knowledge Vault plugin ownership

- Path: `plugins/knowledge-vault/` (publisher-owned, version `0.1.0`)
- Package: `knowledge-vault` — `category: ["transformer","pageType","component"]`,
  `quartzCategory` markers on `KnowledgeVault` (transformer) and
  `Collections`/`Dashboard` (pageType), `CollectionNav` component.
- Responsibilities: first-H1 title adaptation (transformer: `markdownPlugins` +
  `htmlPlugins` without mutating staged Markdown), virtual type-derived
  collections and Vault dashboard (pageType: `generate` + `match` + `body`),
  primary collection navigation and dashboard/collection markup, and all
  Vault-specific styles via `Component.css` strings. The plugin reads only
  selected canonical content; it never writes to the Knowledge Base.
- Extension seams: transformer via `markdownPlugins`/`htmlPlugins`, pageType via
  `generate`/`match`/`layout`/`body`, component via `componentRegistry`
  (`CollectionNav`), style via `Component.css` (emitted as `component-*.css`
  by `ComponentResources`), and no separate hydrated application.
- Tests: pure helpers (`normalizeType`, `slugForType`, `labelForType`,
  `compareByTitleThenSlug`, `isOpenTask`, `isActiveIdea`,
  `parseDashboardDate`, `getRecencyTime`, `compareByRecencyThenTitle`,
  `isPublishableForDashboard`, `getDashboardSlug`, `buildCollectionsFromFiles`)
  plus full-build acceptance that asserts titles, single-H1, fallback, byte
  preservation, wikilinks, collections/routes/counts/ordering, dashboard
  state/recency, collections/tags/search metadata, direct tag routes, both
  home modes, and publication isolation with synthetic fixtures only.

## Dependency pinning

| Layer                                                | Pin mechanism                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| npm dependencies                                     | `package-lock.json`; installs use `npm ci` only                                |
| Community plugins (browse/search/wikilink machinery) | `quartz.lock.json` records the exact resolved repository and commit per plugin |
| Quartz source                                        | vendored snapshot at the upstream revision above plus the delta above          |
| Local Knowledge Vault plugin                         | `quartz.lock.json` `knowledge-vault` entry: `source` and `resolved` are        |
|                                                      | ` "./plugins/knowledge-vault"` with `commit: "local"` (portable relative path) |

Plugin installs run `npm run install-plugins`, which executes
`node scripts/pin-plugins.mjs && node ./quartz/bootstrap-cli.mjs plugin install`
**from the lockfile** (`npx quartz plugin install`), cloning each community
plugin at its recorded commit and symlinking (or copying) the local plugin at
its relative path. Do not switch to `--from-config`, which would install
floating default-branch revisions and break reproducibility. A fresh checkout
with no `.quartz/plugins/` restores the symlink via this command (verified by
`tests/knowledge-vault.test.mjs`).

The 19 pinned plugins (18 community + 1 local). The explorer community plugin
remains installed but is **disabled** in `quartz.config.yaml` (primary
navigation is now the Knowledge Vault collection navigation); `og-image` is
installed but disabled (the vendored `Head.tsx` imports its
`CustomOgImagesEmitterName` export), and `content-index`/`note-properties` are
required at runtime for the local search index and frontmatter parsing:

| Plugin                     | Commit                                     | Role                                                            |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| article-title              | `e608ca815e137e22b598094f735bcd8a481dafaa` | enabled                                                         |
| breadcrumbs                | `cf2e161425165e1ac713f1feb7250b07fe0250ae` | enabled                                                         |
| content-index              | `c3d4f5c85311712c3355cd71da46b28e2d8eba71` | enabled (search index; sitemap/RSS off)                         |
| content-page               | `d22fae357ae74a3e97a2f450862f23f5227842c4` | enabled                                                         |
| crawl-links                | `43edc6d5182e79bf1b63fed7eb3ba0c7624a1526` | enabled                                                         |
| darkmode                   | `c6484f72ebc6ea89339be7cf86ad14b40c47dcc7` | enabled                                                         |
| description                | `56dc546614d905ad07dd0da8dd5820e25e5ea97b` | enabled                                                         |
| explorer                   | `a2dfd1373abe58ace461ebea0b4e94cb287f894e` | installed but disabled (collection nav is primary)              |
| folder-page                | `93304d22e1d7f09f93a33658ec273f7cb8d17793` | enabled                                                         |
| footer                     | `6ed61928d3c0178d7cef972ebcbca6a206a2f065` | enabled                                                         |
| github-flavored-markdown   | `3eabbaa252ce175665ab3f62e1af25948a83e8b6` | enabled                                                         |
| note-properties            | `3cb40141e792a8a9ba9f99553cd436f36411bf8d` | enabled (frontmatter parsing; panel hidden)                     |
| obsidian-flavored-markdown | `07eaca7b31a537c7c4a0fd2848b1f00014c940af` | enabled                                                         |
| og-image                   | `31343c612d02c5fd22ff27a1e6035b2486be75f5` | installed but disabled                                          |
| page-title                 | `a1c1fe0a9c6a5ce1acf6efa01d473a7d9850e2a3` | enabled                                                         |
| search                     | `0f4c1a233cd03a0f562e13636b89b7708f8e2698` | enabled                                                         |
| syntax-highlighting        | `5bfdc2c3f42d3d0326c4e777eb575f3fb68d51fb` | enabled                                                         |
| table-of-contents          | `6984305e5dae0830c025450e160f12610406f7a4` | enabled                                                         |
| knowledge-vault            | `local`                                    | enabled (local ` ./plugins/knowledge-vault`, portable relative) |

## Upgrade implications

- The vendored `quartz/` tree is **not** unmodified; an upgrade to a newer
  upstream Quartz revision requires rebasing the vendored snapshot, re-applying
  the delta above with minimal conflict resolution, and re-running
  `npm ci && npm run install-plugins && npm run check && npm run test:contract && npm run test && npm run test:browser && npm run build`
  against a synthetic fixture. Do not bump `package.json` `5.0.0` or the
  upstream revision comment without also updating this document and the
  `quartz.lock.json` plugin commits.
- The Knowledge Vault plugin is a separate ownership boundary. Its
  presentation behavior is not duplicated in `quartz/`; a Quartz upgrade that
  changes a transformer/pageType/component/style/script seam may require a
  focused update to `plugins/knowledge-vault/dist/` and its `package.json`
  `quartz.quartzVersion` constraint, not a revert to vendored presentation
  internals.
- The local plugin's install stays portable because `quartz.lock.json`
  `knowledge-vault.resolved` is the relative path `./plugins/knowledge-vault`,
  not a machine-specific absolute path or a floating branch/tag. A floating
  dependency or absolute path must not be introduced.

## License

`LICENSE.txt` is the upstream MIT license and copyright notice carried with
the vendored Quartz source. The Publisher's own files (scripts, tests,
documentation, configuration, `plugins/knowledge-vault`) are also MIT-licensed.
