# Shared reader

Read-only static reader over the isolated staged Shared tree. Fumadocs
MDX/Core acts only as the headless staged-Markdown content source; no
Fumadocs UI is used. Next.js emits a serverless static export (`out/`)
served behind nginx.

## Boundary

```text
private vault
  -> validate publication.manifest.yaml (scripts/stage-content.mjs)
  -> copy only allowlisted content into isolated staging
  -> generate site identity (site-identity.json, outside the staged tree)
  -> build static reader (reader/) from staged content + identity only
```

The reader never accepts a Knowledge Base root, manifest path, or vault
location. Its only inputs are `SHARED_CONTENT_DIR` (default `../content`,
the publisher staging tree) and `SHARED_IDENTITY_FILE` (default
`../site-identity.json`).

## Build and preview

```bash
# From the publisher root: stage first (the publication authority)
node scripts/stage-content.mjs --kb-root <vault-root>

# Then build the static reader (from reader/)
cd reader && npm ci && npm run build

# Preview the export with an nginx-style static server
npx serve out
```

`reader/.source/` (generated content modules), `reader/.next/`, and
`reader/out/` are disposable build artifacts and stay untracked.

## Contract tests

```bash
# Fast static checks (no build)
node --test tests/shared-reader-contract.test.mjs

# Real-corpus production build + output inspection (needs the Shared vault)
SHARED_KB_ROOT=/path/to/shared-vault node --test tests/shared-reader-static.test.mjs

# Production-build browser check of the direct Travel note
SHARED_KB_ROOT=/path/to/shared-vault node --test tests/shared-reader-note-browser.test.mjs
```
