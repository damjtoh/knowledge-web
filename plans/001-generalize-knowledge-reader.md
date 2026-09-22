# Plan 001: Generalize the reader for every Knowledge Base

> **Executor instructions**: Follow this plan step by step. Run every
> verification command before moving on. If a STOP condition occurs, report it
> and do not improvise. When done, update this plan's row in `plans/README.md`,
> unless a reviewer told you that they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 02c3aab..HEAD -- scripts/stage-content.mjs docs reader tests package.json README.md .gitignore`
> Compare any changed in-scope file with the excerpts below. Stop on a semantic
> mismatch.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt, migration, tests, docs
- **Planned at**: commit `02c3aab`, 2026-09-22

## Why this matters

The Knowledge Web Publisher must turn any Publication Manifest and its
allowlisted Markdown into a Web Projection. The new reader instead contains
Shared-specific production rules: five fixed area slugs, a special Travel
hierarchy, Shared-prefixed environment variables, and tests tied to Terradets.
It cannot provide correct home and folder navigation for `damian-vault` or
`mica-vault`, especially where a selected directory has no `index.md`.

Move projection choices into the Publication Manifest and put navigation
derivation behind one generic module. The Publisher must then build the same
static reader for Shared, Damian, Mica, and future Knowledge Bases without a
vault name, route, title, or subject in production code.

## Decided behavior

These decisions are part of the plan. Do not reopen them during execution.

1. The Allowlist remains the publication authority. Navigation never exposes
   unselected content.
2. Add an optional ordered `navigation` list to the Publication Manifest. Each
   entry names an allowlisted Markdown file or an allowlisted directory with at
   least one Markdown file.
3. When `navigation` is absent, derive roots from `select` in manifest order.
   Keep Markdown files and directories containing Markdown; ignore selections
   with no Markdown pages.
4. `navigation` controls presentation only. It cannot broaden `select`.
5. Staging emits resolved navigation roots in generated public-safe metadata.
   The reader must not read the original Knowledge Base or Manifest.
6. A selected directory does not need an authored `index.md`. Emit a virtual
   static folder page for every staged folder containing Markdown.
7. An authored `index.md` owns its folder route and introduction. A virtual
   page supplies a humanized title and child navigation.
8. Root order follows generated metadata. Child nodes sort by authored title,
   then stable route.
9. Every folder page uses the same generic direct-note and child-folder groups.
   Travel receives no special case.
10. Non-Markdown files remain excluded from page discovery. Binary attachment
    delivery is outside this plan.
11. Existing manifests stay valid through default derivation. Vault owners add
    `navigation` only when `select` and visible navigation differ.
12. Use `READER_CONTENT_DIR` and `READER_SITE_METADATA_FILE`. Test harnesses may
    use `KNOWLEDGE_BASE_ROOT`; reader production code may not.

## Current state

### Domain and architecture

- `docs/vocabulary.md:12-16` defines Knowledge Base, Web Projection,
  Publication Manifest, and Allowlist. Use these terms exactly.
- `docs/adr-0001-knowledge-web-publisher.md:43-50` makes the Allowlist the
  publication authority.
- `docs/adr-0002-quartz-replacement-reader.md:36-45` requires isolated staging
  and generated metadata outside the staged tree.
- `docs/manifest.md:31-48` promises byte-preserved selected Markdown and a
  deterministic generated identity file.
- The reader stays a static export with no database, runtime Git, writable
  content, content API, or application server.

### Hardcoded behavior

`reader/lib/navigation.ts:21-45` fixes visible roots in source:

```ts
export const SHARED_AREA_SLUGS: string[][] = [
  ["travel"],
  ["finance"],
  ["pets"],
  ["life-planning"],
  ["inbox"],
]
```

`reader/lib/navigation.ts:52-79` implements Travel-only groups.
`reader/app/[...slug]/page.tsx:86-101` and
`reader/components/reader-chrome.tsx:79-107` repeat Travel rules.
`reader/app/page.tsx:5-25` ignores staged root content and replaces it with a
Shared-specific home.

### Existing generic seams

- `reader/lib/source.ts` exposes staged Markdown through headless Fumadocs.
- `reader/lib/wiki-aliases.ts` derives stable routes and authored titles.
- `reader/lib/site.ts` is the generated-metadata seam.
- `reader/lib/navigation.ts:getBreadcrumbs` and `getChildPages` contain useful
  generic behavior but are mixed with projection rules.
- `scripts/stage-content.mjs` validates `select`, stages atomically, generates a
  root landing page, and emits `site-identity.json`.

### Real manifest shapes

Do not copy private content into this repository. These structural facts are
enough:

- Shared selects directories plus `inbox.md`; `dining` is selected but was
  hidden by source code.
- Damian selects `workout`, `notes`, `personal`, `work`, and `health`.
  `notes` and `work` have no `index.md`.
- Mica selects `work`, `workout`, and `attachments/aventra-intercompany`.
  `work` has no `index.md`; the attachment root is primarily assets.

These shapes prove that `select` and navigation can differ and that virtual
folder routes are required.

### Naming and test runner

- `reader/source.config.ts` reads `SHARED_CONTENT_DIR` and exports `shared`.
- `reader/lib/site.ts` reads `SHARED_IDENTITY_FILE`.
- `reader/package.json` names the package `shared-reader`.
- Five `tests/shared-reader-*.test.mjs` files assume Shared and Travel.
- Their comments use `node --test`. Node 22.16 cannot load their imported
  `.ts` modules that way. Use the root `npm test -- ...` (`tsx`) runner.

## Target module design

Create one deep navigation module at `reader/lib/navigation.ts`. Callers learn
one interface and no discovery rules:

```ts
export interface NavigationNode {
  slugs: string[]
  url: string
  title: string
  page?: PageLike
  children: NavigationNode[]
}

export interface ReaderNavigation {
  roots: NavigationNode[]
  find(slugs: string[]): NavigationNode | undefined
  breadcrumbs(slugs: string[]): Crumb[]
}

export function buildReaderNavigation(
  pages: PageLike[],
  navigationRoots: PublishedRoot[],
): ReaderNavigation
```

Internal types may vary, but preserve the depth:

- Layout, pages, Sidebar, and ReaderChrome consume this tree.
- Callers do not inspect subject slugs, discover folders, or sort pages.
- Tests exercise root order, virtual folders, authored indexes, groups, active
  roots, and breadcrumbs through this interface.
- Do not add a normalized page-model framework or Markdown parser.

## Generated metadata contract

Keep the default file path `site-identity.json` for compatibility, but rename
the TypeScript concept from `SiteIdentity` to `SiteMetadata`. Extend the stable
JSON shape:

```json
{
  "title": "Example Garden",
  "canonicalHostname": "garden.example.com",
  "navigation": [
    { "path": "projects", "kind": "directory" },
    { "path": "about.md", "kind": "markdown" }
  ]
}
```

Rules:

- Preserve this key order and manifest navigation order.
- Normalize paths with the same safety rules as `select`.
- Reject duplicate normalized navigation paths.
- Reject entries not covered by `select`.
- Reject an explicitly named non-Markdown file.
- Reject a directory with no staged Markdown descendants.
- Default derivation filters non-Markdown-only selections.
- Emit relative public paths only; never emit a Knowledge Base root, absolute
  path, manifest path, or unselected path.

## Commands

Run from the repository root unless noted.

| Purpose        | Command                                                                                                                                                                        | Expected result                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Install root   | `npm ci`                                                                                                                                                                       | exit 0                         |
| Install reader | `cd reader && npm ci`                                                                                                                                                          | exit 0                         |
| Check          | `npm run check`                                                                                                                                                                | TypeScript and Prettier exit 0 |
| Focused        | `npm test -- tests/stage-content.test.mjs tests/knowledge-reader-contract.test.mjs tests/navigation.test.mjs tests/wiki-aliases.test.mjs`                                      | all pass, no skips             |
| Browser        | `npm test -- tests/knowledge-reader-static.test.mjs tests/knowledge-reader-journey-browser.test.mjs tests/knowledge-reader-phone-browser.test.mjs`                             | synthetic cases pass           |
| Real vault     | `KNOWLEDGE_BASE_ROOT=<vault> npm test -- tests/knowledge-reader-static.test.mjs tests/knowledge-reader-journey-browser.test.mjs tests/knowledge-reader-phone-browser.test.mjs` | real and synthetic cases pass  |

Generated `content/`, `site-identity.json`, `reader/.source/`, `reader/.next/`,
and `reader/out/` stay ignored and clean up after tests.

## Suggested executor toolkit

- Use `codebase-design` to keep discovery, ordering, grouping, and breadcrumbs
  behind the navigation module's interface.
- Use `better-layout` for generic Browse groups. Keep plain CSS and current
  responsive behavior.
- Query current Next.js and Fumadocs docs through Context7 if static parameters
  or source interfaces need confirmation.

## Scope

### In scope

- `scripts/stage-content.mjs`
- `docs/manifest.md`
- `docs/adr-0003-generic-knowledge-reader.md` (new)
- `docs/adoption.md`, `README.md`, `.gitignore`, `package.json`
- `reader/README.md`, `reader/package.json`, `reader/package-lock.json`
- `reader/source.config.ts`
- `reader/lib/source.ts`, `site.ts`, `navigation.ts`
- `reader/lib/wiki-aliases.ts` only if virtual-folder aliases require it
- `reader/app/layout.tsx`, `page.tsx`, `[...slug]/page.tsx`, `globals.css`
- `reader/components/sidebar.tsx`, `reader-chrome.tsx`
- `tests/stage-content.test.mjs`, `tests/wiki-aliases.test.mjs`
- Rename all `tests/shared-reader-*.test.mjs` files to equivalent
  `tests/knowledge-reader-*.test.mjs` names
- `tests/navigation.test.mjs` (new)
- A helper under `tests/helpers/` only if it removes duplicated build/server
  setup from at least two retained suites
- Remove tracked generated `site-identity.json` while keeping it ignored

### Out of scope

- Editing Shared, Damian, or Mica repositories. Document their recommended
  manifest changes; commit them separately in those repositories.
- Binary attachment serving.
- Search, PWA, offline use, editing, authentication, APIs, or databases.
- pnpm migration.
- Deployment or consumer Dockerfile migration.
- Quartz removal or behavior changes.
- Rewriting historical `.scratch/shared-reader-vertical-slice/` records.
- A plugin system, theme system, or normalized page-model framework.

## Git workflow

- Branch: `advisor/001-generalize-knowledge-reader`
- Use Conventional Commits, one per verified step where practical.
- Example: `feat(reader): derive navigation from publication metadata`.
- Do not amend the Shared vertical-slice commits.
- Do not push or open a pull request unless requested.

## Steps

### Step 1: Record the generic reader decision

Add `docs/adr-0003-generic-knowledge-reader.md`. Record optional manifest
navigation, default derivation, generated metadata, virtual folders, authored
index precedence, static constraints, and deferred binary assets. Explain that
Shared tests were tracer-bullet evidence, not production rules.

Update `docs/manifest.md` with full field validation and generated JSON. Never
describe navigation as another publication authority.

**Verify**: `npm run check` -> exit 0.

### Step 2: Emit validated navigation metadata

In `scripts/stage-content.mjs`:

1. Parse optional `navigation` after validating `select`.
2. Confirm every entry is covered by an allowlisted file or directory.
3. Classify entries as `directory` or `markdown`.
4. If absent, derive from `select` and filter entries with no Markdown page.
5. Validate against the temporary staged tree before the atomic swap.
6. Emit ordered `navigation` in `site-identity.json`.
7. Preserve byte-copying, synthetic root behavior, aggregation, and safety.

Add stage tests for explicit order, default derivation, ignored asset-only
selections, outside-Allowlist failure, duplicates, unsafe paths, nonexistent
entries, non-Markdown explicit entries, deterministic keys, and relative paths.

**Verify**: `npm test -- tests/stage-content.test.mjs` -> all pass, no skips.

### Step 3: Build generic navigation test-first

Create `tests/navigation.test.mjs` first. Use `npm test --`, not plain Node.
Replace Shared logic in `reader/lib/navigation.ts` with
`buildReaderNavigation` and private helpers. Cover:

- manifest root order;
- authored titles for files and directory indexes;
- humanized virtual-folder titles;
- every folder with Markdown descendants;
- flat directories with many notes;
- nested folders with and without indexes;
- a file route and same-route folder merged into one node;
- direct notes and child-folder groups;
- stable sort independent of filesystem order;
- active-root lookup and breadcrumbs;
- exclusion outside configured roots and non-Markdown files;
- deterministic output.

Delete `SHARED_AREA_SLUGS` and `getTravelGroups`. If virtual folders need
wikilink aliases, extend the existing adapter while keeping syntax in
`@flowershow/remark-wiki-link`. Duplicate aliases still fail with all source
candidates.

**Verify**:
`npm test -- tests/navigation.test.mjs tests/wiki-aliases.test.mjs` -> all pass.

### Step 4: Move every caller to the generic tree

Rename inputs and concepts:

- `SHARED_CONTENT_DIR` -> `READER_CONTENT_DIR`
- `SHARED_IDENTITY_FILE` -> `READER_SITE_METADATA_FILE`
- `SiteIdentity` -> `SiteMetadata`
- collection `shared` -> `content`
- package `shared-reader` -> `knowledge-reader`

Then:

- `layout.tsx` builds one navigation tree from pages and metadata roots.
- `page.tsx` renders authored root introduction when present. For a synthetic
  root, avoid duplicating its generated list. Always render ordered roots.
- `[...slug]/page.tsx` resolves authored pages or virtual folders, includes
  virtual slugs in static parameters, and renders generic groups.
- `ReaderChrome` shows generic groups for the active root on phone.
- `Sidebar` uses a generic accessible name such as `Published sections`.
- Rename `.reader-nav-travel`; preserve desktop, phone, focus, touch, wrapping,
  and overflow behavior.

**Verify**:

```bash
npm run check
grep -RniE 'SHARED_|SHARED_AREA_SLUGS|getTravelGroups|TravelGroupList|reader-nav-travel|Terradets' reader
```

Expected: check exits 0; grep returns no matches.

### Step 5: Replace projection-specific tests

Rename the reader tests listed in Scope and use `npm test --` in comments and
documentation. Create one neutral synthetic fixture containing:

- authored root;
- explicit navigation whose order differs from `select`;
- directories with and without indexes;
- a flat large directory and nested virtual folder;
- a standalone selected Markdown file and asset-only selection;
- resolved and unresolved wikilinks, aliases, and fragments;
- table, task list, external link/image, inline/fenced code, long title, and
  wide content.

Derive expected routes from fixture metadata. Retain page-set equality, output
safety, direct refresh, history, desktop/mobile navigation, 360/414/desktop
viewports, focus, landmarks, 44 px targets, wrapping, overflow, static-runtime
inspection, and Quartz rollback checks.

The contract test allows only `READER_CONTENT_DIR` and
`READER_SITE_METADATA_FILE` in reader production source.

**Verify**:

```bash
npm test -- \
  tests/knowledge-reader-contract.test.mjs \
  tests/navigation.test.mjs \
  tests/wiki-aliases.test.mjs \
  tests/knowledge-reader-static.test.mjs \
  tests/knowledge-reader-journey-browser.test.mjs \
  tests/knowledge-reader-phone-browser.test.mjs
```

Expected: all synthetic tests pass without a private checkout.

### Step 6: Run one generic real-vault matrix

Use optional harness variable `KNOWLEDGE_BASE_ROOT`. The harness may read the
Manifest to invoke staging and derive counts; the reader receives only staged
content and generated metadata.

```bash
for vault in \
  /Users/damiancrespi/Sites/travel \
  /Users/damiancrespi/Sites/damian-vault \
  /Users/damiancrespi/Sites/mica-vault
do
  KNOWLEDGE_BASE_ROOT="$vault" npm test -- \
    tests/knowledge-reader-static.test.mjs \
    tests/knowledge-reader-journey-browser.test.mjs \
    tests/knowledge-reader-phone-browser.test.mjs || exit 1
done
```

Generic assertions must stage only the Allowlist, build every staged Markdown
page, emit virtual routes, honor metadata order, derive a journey from the
tree, verify generated canonical metadata, and scan for private paths. Do not
commit private text or routes. Synthetic tests own syntax features absent from
a real corpus.

**Verify**: all three iterations exit 0; generated artifacts remain ignored.

### Step 7: Update names, commands, and guidance

Update reader/root READMEs and adoption docs:

- Use “Knowledge reader,” not “Shared reader.”
- Explain optional navigation, defaults, and virtual folders.
- Use neutral variables and `npm test --`/`tsx`, never incompatible plain Node.
- Separate static reader build instructions from Quartz rollback.
- State that binary attachment delivery remains deferred.
- Show non-private navigation examples for each manifest shape.

Add `test:reader` and `test:reader:browser` root scripts using
`tsx --test --test-concurrency=1`. Keep npm. Rename the `.gitignore` comment.
Remove tracked `site-identity.json`; it is generated and already ignored.

**Verify**:

```bash
npm run check
npm run test:reader
git ls-files --error-unmatch site-identity.json
```

Expected: first two exit 0; final command exits nonzero.

### Step 8: Run final boundary checks

```bash
npm run check
npm test -- tests/stage-content.test.mjs tests/knowledge-reader-contract.test.mjs tests/navigation.test.mjs tests/wiki-aliases.test.mjs
npm run test:reader
git diff --name-only 02c3aab..HEAD -- quartz plugins quartz.config.yaml quartz.lock.json nginx.conf
git grep -nE 'SHARED_|SHARED_AREA_SLUGS|getTravelGroups|TravelGroupList|reader-nav-travel' -- reader tests README.md docs ':!docs/wikilink-spike.md' ':!.scratch/**'
git status --porcelain=v1 -uall
```

Expected: tests pass; Quartz diff and forbidden grep print nothing; status has
only intended paths and no generated output.

## Test plan

- `tests/stage-content.test.mjs`: navigation validation, derivation, metadata,
  and security failures.
- `tests/navigation.test.mjs`: tree, virtual routes, order, groups, lookup, and
  breadcrumbs through the module interface.
- `tests/wiki-aliases.test.mjs`: page aliases and any required folder aliases.
- Generic contract/static/desktop/phone suites: staged-only inputs, complete
  export, output safety, history, responsive access, and static runtime.
- Run the same entry points against Shared, Damian, and Mica without committed
  knowledge of their content.
- Preserve the temporary staging, nginx-style server, serial browser build,
  and `assertAbsentEverywhere` patterns in current reader tests.

## Done criteria

- [ ] Production reader source contains no vault- or subject-specific rule.
- [ ] Optional ordered `navigation` cannot broaden `select`.
- [ ] Existing manifests derive safe defaults.
- [ ] Generated metadata has deterministic relative navigation roots.
- [ ] Markdown folders without `index.md` have static virtual routes.
- [ ] Authored indexes take precedence.
- [ ] Desktop and phone consume one generic tree.
- [ ] Test commands work on Node 22 through `tsx`.
- [ ] Synthetic tests pass without private repositories.
- [ ] Shared, Damian, and Mica real-vault matrices pass locally.
- [ ] Non-Markdown files do not become pages.
- [ ] Output contains no Knowledge Base absolute path or unselected sentinel.
- [ ] Quartz rollback files are unchanged.
- [ ] Generated metadata and build outputs remain untracked.
- [ ] `npm run check` exits 0.
- [ ] No files outside Scope are modified.
- [ ] `plans/README.md` marks this plan DONE after independent review.

## STOP conditions

Stop and report if:

- In-scope code drifted semantically after `02c3aab`.
- Virtual folders require a runtime server, client content fetch, or tracked
  generated private source.
- Reader production code would need the original Manifest or Knowledge Base.
- A navigation rule could expose content outside `select`.
- A real vault has invalid Markdown or duplicate aliases. Report all
  source-relative candidates; do not add an exception or repair canonical
  content in the Publisher.
- Any vault-specific route, title, or exception appears necessary.
- Binary delivery becomes required; split it into a follow-up.
- A verification fails twice after one bounded correction.
- Quartz behavior or consumer Dockerfiles must change.

## Downstream manifest adoption

Actual manifest edits occur in each Knowledge Base after this plan lands:

- Shared should explicitly list its intended visible subset and order.
- Damian likely lists `workout`, `notes`, `personal`, `work`, `health`.
- Mica likely lists `work`, `workout`, omitting its asset pack from navigation
  while retaining it in `select` if publication is still required.

Each Knowledge Base must pin the accepted Publisher commit and run its build.
Do not bundle downstream manifest commits into the Publisher change.

## Maintenance notes

- Search and PWA work must consume the same staged pages and navigation tree.
- Future binary assets must derive from staging and keep discovery Markdown-only.
- Review default derivation and virtual-route collisions carefully.
- Keep `select` and `navigation` conceptually separate: publication authority
  versus presentation subset/order.
- Historical Shared tracer-bullet specifications may retain Shared terminology;
  production source and current generic documentation may not.
