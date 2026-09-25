# Provenance and pinning

This document records where imported code came from, how every dependency is
pinned, and how future maintainers can verify and reproduce builds.

## Current components

| Component                     | Origin                                         | Pinning                                                            |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| Staging (`scripts/`)          | owned by this repository                       | n/a                                                                |
| Knowledge reader (`reader/`)  | owned by this repository over Next.js/Fumadocs | `reader/pnpm-lock.yaml` (exact integrity hashes)                   |
| Wikilink spike (`scripts/`)   | owned by this repository                       | n/a                                                                |
| Lint plugin (`tools/oxlint/`) | vendored from `dmmulroy/anti-slop` (see below) | snapshot revision recorded in `tools/oxlint/anti-slop/UPSTREAM.md` |
| Root tool dependencies        | npm registry                                   | `pnpm-lock.yaml` (exact integrity hashes)                          |

Dependency installs are reproducible: `pnpm install --frozen-lockfile` only.

## Vendored lint plugin

`tools/oxlint/anti-slop/` is vendored from
https://github.com/dmmulroy/anti-slop. The snapshot revision, verification
method, and update procedure are recorded in
`tools/oxlint/anti-slop/UPSTREAM.md`. `oxlint` and `@oxlint/plugins` are
pinned to the same exact version as the plugin snapshot's API requirements.

## Removed Quartz rollback machinery

The repository previously vendored the Quartz v5 build machinery
(`quartz/`, `plugins/knowledge-vault/`, `quartz.lock.json`, and the
plugin install pipeline) as a rollback path for the static Knowledge reader
(ADR-0002). That machinery was removed; ADR-0004 records the decision.

Recovery anchor, should the rollback ever be needed:

- Upstream: https://github.com/jackyzha0/quartz (v5 line)
- Vendored snapshot revision: `81db804f54a9a64cdf2cc09e856e562511d143c8`
  (2026-06-09) plus the documented local delta
- Available in this repository's git history: the tree immediately before
  the removal commit restores `quartz/`, `plugins/knowledge-vault/`,
  `quartz.config.yaml`, `quartz.lock.json`, and the build scripts verbatim.

## License

`LICENSE.txt` is the MIT license and copyright notice for the Publisher's
own files (scripts, tests, documentation, configuration). The vendored lint
plugin carries its upstream licenses inside `tools/oxlint/anti-slop/`.
