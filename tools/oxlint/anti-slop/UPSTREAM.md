# Upstream provenance — anti-slop Oxlint plugin

This directory is a vendored copy of the anti-slop lint plugin. The
repository owns the copied rules; this file records where they came from and
how the copy is verified.

## Source

- Upstream repository: https://github.com/dmmulroy/anti-slop
- Snapshot revision: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
  (`main`, 2026-09-10, "Merge pull request #36 from
  K-Mistele/contrib/effect-tag-match-rules")
- Upstream path: `skills/install-anti-slop/assets/anti-slop/`
- Installed path: `tools/oxlint/anti-slop/` (whole tree)

## Verification

The installed tree was compared with
`skills/install-anti-slop/assets/anti-slop/` at the snapshot revision above
(upstream `main` tarball) and is byte-identical. No local deviations.

The vendored `vendor/eslint-stylistic/` subtree carries its own provenance
record in `vendor/eslint-stylistic/UPSTREAM.md`; preserve it when updating.

## Dependency pairing

- `oxlint` and `@oxlint/plugins` are pinned to the same exact version
  (`1.85.0`) in the root `package.json`. Upgrade both together.
- The plugin entry point referenced by `oxlint.config.ts` is
  `./tools/oxlint/anti-slop/index.ts`.

## Updating

Route updates through the update procedure rather than re-copying over this
directory: re-verify the upstream snapshot, diff against this tree, and
review any local deltas before adopting them. Refresh this file with the new
snapshot revision and verification result.
