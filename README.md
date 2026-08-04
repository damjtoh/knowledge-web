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

Enabled (the shared release scope):

- Responsive page rendering and explorer-based browsing by repository folder
- Local full-text search (no external service)
- Wikilink resolution compatible with Obsidian and Tolaria
- A synthetic landing page when selected content has no root `index.md`

Excluded (intentionally absent):

- Graph views, backlinks, comments, analytics, RSS/sitemap output, editing,
  and other digital-garden features
- Any database, writable volume, runtime Git, or content API — the runtime is
  stateless static files behind minimal nginx

## Repository layout

```text
quartz/                    Quartz v5 source (pinned, see docs/UPSTREAM.md)
scripts/stage-content.mjs  Manifest validation + content staging + identity injection
tests/                     Focused contract tests (synthetic fixtures only)
quartz.config.yaml         Shared Quartz configuration (pageTitle/baseUrl injected per site)
package.json               npm scripts; deps pinned by package-lock.json
quartz.lock.json           Community plugin pins (exact commits)
nginx.conf                 Minimal stateless runtime configuration for consumers
docs/                      Manifest contract, adoption guide, vocabulary, ADR, provenance
```

## Building a site

```bash
npm ci                        # install pinned npm dependencies
npm run install-plugins       # install community plugins at their pinned commits
node scripts/stage-content.mjs --kb-root /path/to/knowledge-base
npm run build                 # emits the static site into public/
```

`stage-content.mjs` validates the manifest, copies only allowlisted content
byte-for-byte into the isolated `content/` build tree, generates a synthetic
landing page only when no selected root `index.md` exists, and injects the
manifest title and hostname into `quartz.config.yaml`. The Knowledge Base is
never modified.

## Testing

```bash
npm run test:contract   # node --test tests/ — contract boundary tests
```

## Documentation

- [Publication Manifest contract](docs/manifest.md)
- [Adoption guide for Knowledge Bases](docs/adoption.md)
- [Canonical vocabulary](docs/vocabulary.md)
- [Architectural decision record](docs/adr-0001-knowledge-web-publisher.md)
- [Provenance and pinning](docs/UPSTREAM.md)

## License

The Quartz source vendored in `quartz/` is MIT-licensed
([LICENSE.txt](LICENSE.txt)). See [docs/UPSTREAM.md](docs/UPSTREAM.md) for the
exact upstream revision and the one local modification carried by this
repository. The Publisher's own files are MIT-licensed as well.
