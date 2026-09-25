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
scripts/stage-content.mjs  Manifest validation + content staging + generated site metadata
reader/                    Knowledge reader (static Next.js export over staged content + generated metadata)
tools/oxlint/anti-slop/    Vendored Oxlint lint plugin (see docs/UPSTREAM.md)
tests/                     Focused contract tests (synthetic fixtures only)
nginx.conf                 Minimal stateless runtime configuration for consumers
package.json               pnpm scripts; deps pinned by pnpm-lock.yaml
docs/                      Manifest contract, adoption guide, vocabulary, ADRs, provenance
```

## Building a site

```bash
pnpm install --frozen-lockfile  # install pinned dependencies
node scripts/stage-content.mjs --kb-root /path/to/knowledge-base
cd reader && pnpm install --frozen-lockfile && pnpm run build   # emits the static reader into reader/out/
```

`stage-content.mjs` validates the manifest, copies only allowlisted content
byte-for-byte into the isolated `content/` build tree, generates a synthetic
landing page only when no selected root `index.md` exists, and emits
deterministic generated site metadata (`site-identity.json` with `title`,
`canonicalHostname`, and ordered `navigation`) outside the
staged tree. The reader build consumes only staged content
(`READER_CONTENT_DIR`) plus generated metadata
(`READER_SITE_METADATA_FILE`). Staging never modifies another tracked
configuration file. The Knowledge Base is never modified.
See [the manifest contract](docs/manifest.md) and the
[Knowledge reader](reader/README.md).

## Testing

One canonical command runs the whole suite through the `tsx` runner
(serial; never the plain Node runner — navigation imports TypeScript
reader modules that plain Node cannot load):

```bash
pnpm test

# Same suite against a real vault checkout
KNOWLEDGE_BASE_ROOT=/path/to/vault pnpm test
```

## Documentation

- [Publication Manifest contract](docs/manifest.md)
- [Adoption guide for Knowledge Bases](docs/adoption.md)
- [Knowledge reader](reader/README.md)
- [Canonical vocabulary](docs/vocabulary.md)
- [Architectural decision record](docs/adr-0001-knowledge-web-publisher.md)
- [Quartz replacement decision](docs/adr-0002-quartz-replacement-reader.md)
- [Generic knowledge reader decision](docs/adr-0003-generic-knowledge-reader.md)
- [Quartz rollback removal decision](docs/adr-0004-remove-quartz-rollback.md)
- [Provenance and pinning](docs/UPSTREAM.md)

## License

The Publisher's own files are MIT-licensed ([LICENSE.txt](LICENSE.txt)).
The vendored lint plugin under `tools/oxlint/anti-slop/` carries its
upstream licenses inside that directory.
