# Knowledge reader

Read-only static reader over the isolated staged Knowledge Base tree.
Fumadocs MDX/Core acts only as the headless staged-Markdown content
source; no Fumadocs UI is used. Next.js emits a serverless static
export (`out/`) served behind nginx.

## Boundary

```text
private Knowledge Base
  -> validate publication.manifest.yaml (scripts/stage-content.mjs)
  -> copy only allowlisted content into isolated staging
  -> generate site metadata (site-identity.json, outside the staged tree)
  -> build static reader (reader/) from staged content + metadata only
```

The reader never accepts a Knowledge Base root, manifest path, or vault
location. Its only inputs are `READER_CONTENT_DIR` (default
`../content`, the publisher staging tree) and
`READER_SITE_METADATA_FILE` (default `../site-identity.json`).

## Navigation

- The Publication Manifest may list an optional ordered `navigation`
  subset of the allowlist. It sets the visible reader roots and their
  order. It is presentation metadata only: it cannot broaden `select`,
  publish an unselected path, or admit a non-Markdown page. See
  [the manifest contract](../docs/manifest.md).
- When `navigation` is absent, staging derives roots from `select` in
  manifest order. Derivation keeps Markdown files and directories
  containing at least one Markdown page, and ignores selections with no
  Markdown pages. Existing manifests without `navigation` stay valid,
  and asset-only selections never become navigation roots.
- A selected directory does not need an authored `index.md`. The reader
  serves a virtual static folder page for every staged folder
  containing Markdown pages. An authored `index.md` owns its folder
  route and introduction; a virtual page supplies a humanized title and
  child navigation.
- Root order follows generated metadata. Child nodes sort by authored
  title, then stable route. Every folder page uses the same generic
  direct-note and child-folder groups. No subject receives a special
  case.
- Binary attachment delivery is deferred. Staging copies allowlisted
  non-Markdown files byte-for-byte, but they never become pages,
  navigation nodes, or group entries.

## Manifest shapes

Synthetic examples only. No private content or routes.

Shared-like: directories plus one standalone file, with an explicit
visible order that differs from `select`:

```yaml
title: Example Garden
canonicalHostname: garden.example.com
select:
  - garden
  - orchard
  - cellar
  - inbox.md
navigation:
  - inbox.md
  - garden
  - orchard
```

Damian-like: several directories, some without an authored `index.md`.
The two index-less directories get virtual folder pages:

```yaml
title: Example Plots
canonicalHostname: plots.example.com
select:
  - workout
  - notes
  - personal
  - work
  - health
navigation:
  - workout
  - notes
  - personal
  - work
  - health
```

Mica-like: directories plus an asset-heavy selection. The asset pack
stays staged but has no navigation root because it names no Markdown
page worth browsing:

```yaml
title: Example Studio
canonicalHostname: studio.example.com
select:
  - work
  - workout
  - attachments/handouts
navigation:
  - work
  - workout
```

When `navigation` is omitted, the reader shows the derived roots from
`select` in manifest order, filtered to Markdown-bearing selections.

## Build and preview

### Static Knowledge reader build (current)

```bash
# From the publisher root: stage first (the publication authority)
node scripts/stage-content.mjs --kb-root <knowledge-base-root>

# Then build the static reader (from reader/)
cd reader && npm ci && npm run build

# Preview the export with an nginx-style static server
npx serve out
```

The reader build reads only staged content (`READER_CONTENT_DIR`) plus
generated metadata (`READER_SITE_METADATA_FILE`). `reader/.source/`
(generated content modules), `reader/.next/`, and `reader/out/` are
disposable build artifacts and stay untracked.

### Quartz rollback (separate)

Quartz remains vendored for rollback only. It is not part of the
Knowledge reader build:

```bash
# From the publisher root: Quartz plugin install, stage, and build
npm ci
npm run install-plugins
node scripts/stage-content.mjs --kb-root <knowledge-base-root>
npm run build   # emits the Quartz static site into public/
```

Do not mix the two outputs: the Knowledge reader emits `reader/out/`;
the Quartz rollback emits `public/`.

## Contract tests

All commands run from the publisher root through the `tsx` test runner.
Never use the plain Node runner for these suites: they import TypeScript
reader modules that plain Node cannot load.

```bash
# Fast static boundary (no build, no vault required)
npm test -- tests/knowledge-reader-contract.test.mjs

# Synthetic production build + output inspection (no vault required)
npm test -- tests/knowledge-reader-static.test.mjs

# Synthetic production-build browser journeys (no vault required)
npm test -- tests/knowledge-reader-journey-browser.test.mjs tests/knowledge-reader-phone-browser.test.mjs

# Shortcuts defined in the root package.json
npm run test:reader          # static + journey + phone suites
npm run test:reader:browser  # journey + phone suites only
```

A real corpus uses the same generic entry points with only the test
harness variable:

```bash
KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-static.test.mjs
KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-journey-browser.test.mjs tests/knowledge-reader-phone-browser.test.mjs
```

The reader receives only staged content and generated metadata. No
private text or routes are committed.
