# Knowledge Web Publisher

A small, public, reusable build system that turns **selected** Markdown from a
[Knowledge Base](docs/vocabulary.md) into a read-only **Web Projection**:
a mobile-friendly static website with explorer-style browsing, local
full-text search, and Obsidian/Tolaria-compatible wikilinks.

The Publisher is deliberately narrow. It does not edit the Knowledge Base, run
a database, synchronize content at runtime, or expose a content API. It ships
a minimal nginx runtime contract and nothing else runs in production.

This repository contains **no personal knowledge and no secrets**. All
examples are synthetic. Content repositories never copy the Publisher into
themselves; they fetch it at an immutable revision during their own container
build (see [Adoption](docs/adoption.md)).

## What is published, and why

Every Web Projection starts from a **Publication Manifest** in the Knowledge
Base — a small YAML file declaring the site title, the canonical hostname, and
an **explicit allowlist** of content roots and files:

```yaml
title: Example Garden
canonicalHostname: garden.example.com
select:
  - notes
  - about.md
```

The allowlist is the publication authority. Files outside it never enter the
generated site or the final runtime image, even though the private repository
is the Docker build context. The Publisher rejects malformed or unsafe
manifests — missing fields, empty allowlists, nonexistent, absolute,
traversing, out-of-root, or symlink-escaping selections — before any build
output exists. See [the manifest contract](docs/manifest.md).

## Capabilities

Enabled (the current release scope):

- Responsive page rendering and explorer-based browsing by repository folder
- Ordered navigation roots from generated site metadata, with safe
  defaults derived from the allowlist when no explicit order is listed
- Virtual static folder pages for selected directories without an
  authored `index.md`; authored indexes own their folder route
- Local full-text search (no external service)
- Wikilink resolution compatible with Obsidian and Tolaria
- A synthetic landing page when selected content has no root `index.md`

Excluded (intentionally absent):

- Graph views, backlinks, comments, analytics, RSS/sitemap output, editing,
  and other digital-garden features
- Binary attachment delivery: allowlisted non-Markdown files are staged
  byte-for-byte but never become pages or navigation entries
- Any database, writable volume, runtime Git, or content API — the runtime is
  stateless static files behind minimal nginx

## Repository layout

```text
quartz/                    Quartz v5 source (pinned, see docs/UPSTREAM.md; rollback only, see docs/adr-0002-quartz-replacement-reader.md)
scripts/stage-content.mjs  Manifest validation + content staging + generated site metadata
reader/                    Knowledge reader (static Next.js export over staged content + generated metadata)
tests/                     Focused contract tests (synthetic fixtures only)
quartz.config.yaml         Quartz configuration (generic placeholders; staging never mutates it)
site-identity.json         Generated site metadata (title, canonicalHostname, navigation; gitignored build output)
package.json               npm scripts; deps pinned by package-lock.json
quartz.lock.json           Community plugin pins (exact commits)
nginx.conf                 Minimal stateless runtime configuration for consumers
docs/                      Manifest contract, adoption guide, vocabulary, ADRs, provenance
```

## Building a site

### Static Knowledge reader build (current)

```bash
npm ci                        # install pinned npm dependencies
node scripts/stage-content.mjs --kb-root /path/to/knowledge-base
cd reader && npm ci && npm run build   # emits the static reader into reader/out/
```

`stage-content.mjs` validates the manifest, copies only allowlisted content
byte-for-byte into the isolated `content/` build tree, generates a synthetic
landing page only when no selected root `index.md` exists, and emits
deterministic generated site metadata (`site-identity.json` with `title`,
`canonicalHostname`, and ordered `navigation`) outside the
staged tree. The reader build consumes only staged content
(`READER_CONTENT_DIR`) plus generated metadata
(`READER_SITE_METADATA_FILE`). Staging never modifies `quartz.config.yaml`
or another tracked configuration file. The Knowledge Base is never modified.
See [the manifest contract](docs/manifest.md) and the
[Knowledge reader](reader/README.md).

### Quartz rollback (separate)

Quartz remains vendored for rollback only:

```bash
npm ci                        # install pinned npm dependencies
npm run install-plugins       # install community plugins at their pinned commits
node scripts/stage-content.mjs --kb-root /path/to/knowledge-base
npm run build                 # emits the Quartz static site into public/
```

Do not mix the two outputs: the Knowledge reader emits `reader/out/`;
the Quartz rollback emits `public/`. The publisher, allowlist,
staging, canonical Markdown/Git, and stateless runtime boundaries are
retained (see docs/adr-0002-quartz-replacement-reader.md and
docs/adr-0003-generic-knowledge-reader.md).

## Testing

```bash
# Focused publisher + navigation suites (tsx runner)
npm test -- tests/stage-content.test.mjs tests/knowledge-reader-contract.test.mjs tests/navigation.test.mjs tests/wiki-aliases.test.mjs

# Synthetic Knowledge reader production suites (no vault required)
npm run test:reader          # static + journey + phone suites
npm run test:reader:browser  # journey + phone suites only

# Real-corpus matrix (same generic suites against a vault checkout)
KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-static.test.mjs tests/knowledge-reader-journey-browser.test.mjs tests/knowledge-reader-phone-browser.test.mjs
```

## Documentation

- [Publication Manifest contract](docs/manifest.md)
- [Adoption guide for Knowledge Bases](docs/adoption.md)
- [Knowledge reader](reader/README.md)
- [Canonical vocabulary](docs/vocabulary.md)
- [Architectural decision record](docs/adr-0001-knowledge-web-publisher.md)
- [Quartz replacement decision](docs/adr-0002-quartz-replacement-reader.md)
- [Generic knowledge reader decision](docs/adr-0003-generic-knowledge-reader.md)
- [Provenance and pinning](docs/UPSTREAM.md)

## License

The Quartz source vendored in `quartz/` is MIT-licensed
([LICENSE.txt](LICENSE.txt)). See [docs/UPSTREAM.md](docs/UPSTREAM.md) for the
exact upstream revision and the one local modification carried by this
repository. The Publisher's own files are MIT-licensed as well.
