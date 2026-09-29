# Testing

## Philosophy

Tests exist to give confidence in what readers see and what the
Publication Manifest allowlist guarantees: only allowlisted content is
published, and it renders as staged. Judge every decision about what to
test, how to test it, and how much to test against that metric. A test
that passes without reflecting reader-visible behavior or a publication
contract gives false confidence and is worse than no test at all.

Test behavior, not implementation. Observe only what a reader or a
publisher operator observes: staged files, generated site identity,
rendered routes, and script exit codes with their error output. A test
that breaks when an internal variable is renamed or a helper is
extracted — without any behavior change — is a bad test.

Assume third-party code works. Unified, Fumadocs, Next.js, nginx, and
Playwright are correct; test the integration with them: the right files
staged, the right identity emitted, the right rejection surfaced.

## Stack

- `node:test` with `node:assert/strict` — test runner and assertions,
  executed through `tsx` (`pnpm test`)
- `node:child_process` subprocesses — staging and reader builds run as
  real scripts against synthetic Knowledge Bases in temporary
  directories
- Playwright Chromium — real-browser journeys in the integrated reader
  suite (install with `pnpm exec playwright install chromium`)

## Layout

Tests live in `tests/`, one file per boundary:

- `tests/stage-content.test.mjs` — staging contract: allowlist
  enforcement, byte preservation, landing page, identity output
- `tests/stage-destinations.test.mjs` — destination mapping contract
- `tests/navigation.test.mjs`, `tests/wiki-aliases.test.mjs` — pipeline
  unit behavior over synthetic inputs
- `tests/knowledge-reader-contract.test.mjs` — static reader boundary:
  no vault input, headless Fumadocs source, static export
- `tests/knowledge-reader-integrated.test.mjs` — production static
  export served nginx-style, exercised in desktop and phone browsers
- `tests/knowledge-reader-last-edited.test.mjs`,
  `tests/knowledge-reader-default-input.test.mjs` — focused reader
  behavior
- `tests/helpers/`, `tests/fixtures/` — shared environment setup and
  synthetic corpora

## Commands

| Command                             | What it does                         |
| ----------------------------------- | ------------------------------------ |
| `pnpm test <file>`                  | Run one suite (`tsx --test`, serial) |
| `pnpm test`                         | Run every suite                      |
| `pnpm run check`                    | Lint plus Prettier check (CI gate)   |
| `pnpm run lint`                     | Lint with oxlint                     |
| `pnpm exec prettier <file> --check` | Verify formatting for a changed file |

CI runs the focused publisher suites first, then the integrated reader
suite with one retry. Match that order locally: run the focused file,
then the integrated suite only when the change touches reader behavior.

## Boundaries every test upholds

- The Allowlist is the publication authority: anything outside it never
  enters staged content, generated identity, or the runtime image.
  Rejection tests assert the error message and that no partial output
  exists.
- Staging never mutates tracked files. Tests stage into temporary
  directories and assert the tracked `nginx.conf` stays byte-identical.
- Generated identity stays deterministic, outside the staged content
  tree, and outside the Knowledge Base root; it never leaks absolute
  vault paths.
- The reader consumes only staged content plus generated site metadata.
  It declares no Knowledge Base, vault, or manifest input and reads only
  `READER_CONTENT_DIR` and `READER_SITE_METADATA_FILE` from the
  environment.
- The reader emits a serverless static export (`output: 'export'`) with
  no Fumadocs UI dependency.

## Decision rules

Add a test when a change moves a boundary above: new allowlist,
navigation, destination, or identity behavior; new staged-output shape;
new reader input or export behavior. Cover the boundary through the
public surface (script CLI, staged tree, identity file, rendered route),
never through internals.

Modify a test only when its boundary intentionally moved. Update the
asserted behavior and the file-level contract comment together so the
comment keeps describing the boundary the file guards.

Remove a test when its behavior stays covered by another test, or when
it asserts implementation detail instead of observable behavior (prefer
rewriting it against the public surface first). Keep every boundary
guard above while its boundary exists in production code, and never
delete a failing test to hide the failure — the failure is evidence
about the change.

Keep new tests synthetic and isolated: build a synthetic Knowledge Base
in a temporary directory, run the real script, assert on outputs, and
clean up. Never point a test at a real vault checkout except through
the existing `KNOWLEDGE_BASE_ROOT` opt-in in the integrated suite, and
never write into tracked publisher files.
