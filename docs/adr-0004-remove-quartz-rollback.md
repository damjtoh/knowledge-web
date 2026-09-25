# ADR-0004 — Remove the Quartz rollback machinery

- Status: Accepted
- Date: 2026-09-25
- Deciders: Knowledge Web Publisher maintainers
- Context: ADR-0002 kept the vendored Quartz v5 tree as a rollback path
  after the Knowledge reader became the current build.

## Context

ADR-0002 replaced Quartz with a static Knowledge reader but retained the
vendored `quartz/` tree, the local `plugins/knowledge-vault` plugin,
`quartz.lock.json` with its community plugin pins, and the plugin install
pipeline "for rollback only". The rollback path was never the release
scope: every documented build since ADR-0002 uses the reader over staged
content.

Keeping the tree had real costs. The Quartz source carried a documented
local delta that must be rebased on every upstream upgrade. A floating
`github:` dependency spec resolved different commits under different lock
tooling. Its build scripts, dependencies, and test suites duplicated
reader-side capabilities, and the vendored code sat outside the repository's
own lint and format gates. Git history already preserves every revision of
the vendored tree, so the rollback capability does not depend on keeping the
files in `HEAD`.

## Decision

Remove the Quartz rollback machinery from the working tree:

- `quartz/` (vendored snapshot at upstream `81db804f…` plus the local delta)
- `plugins/knowledge-vault/` and its seven `tests/knowledge-vault*.test.mjs`
  suites
- `quartz.config.yaml`, `quartz.config.default.yaml`, `quartz.lock.json`,
  `quartz.ts`, `globals.d.ts`, `index.d.ts`, `tsconfig.json`
- the plugin pinning pipeline (`scripts/pin-plugins.mjs`,
  `install-plugins`, `prebuild`) and the Quartz `build`/`serve`/`docs`/
  `profile` scripts
- Quartz-only root dependencies; test-only Markdown libraries move to
  `devDependencies`

The Publisher boundaries survive unchanged: the Publication Manifest and its
allowlist stay the publication authority, staging stays isolated and
deterministic, and the runtime stays stateless static files behind the
minimal nginx contract.

## Consequences

- Rolling back to Quartz means checking out a revision of this repository
  before the removal commit; `docs/UPSTREAM.md` records the upstream
  snapshot identity and the recovery anchor.
- `nginx.conf` serves the reader export (`reader/out/`); the Quartz
  `/static/` convention comment is retired with the path kept as generic
  immutable caching.
- The staging test's "tracked configuration" invariant now pins `nginx.conf`
  instead of `quartz.config.yaml`; the legacy `--config-file` rejection test
  is unchanged.
- Dependency management is pnpm 12 with Node 26; the reader and the
  publisher root each carry their own `pnpm-lock.yaml`.
