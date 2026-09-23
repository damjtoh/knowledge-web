# 04 — Verification and regression pass

**What to build:** One pass proving the tree and Search work together on the
synthetic export and the real corpus without regressing the reader contract.

**Blocked by:** 03 — Search dialog and keyboard journey.

**Status:** ready-for-agent

- [x] `npm test -- tests/knowledge-reader-static.test.mjs` passes, including extended sentinel, hidden-navigation-page, and readable-text exclusion checks.
- [x] Reader desktop and phone browser journeys pass with tree and Search assertions.
- [x] `npm run test:reader` passes; contract tests still pass.
- [ ] Manual desktop inspection: tree density, folder link versus disclosure, search dialog, focus, light and dark.
- [ ] Manual phone inspection: Browse tree, search dialog, touch targets, no page-level horizontal overflow.
- [x] No build-generated drift (for example `reader/next-env.d.ts`) or private content committed; `git status` clean after restore.

## Comments

- 2026-09-23: Automated verification green on the final state: `npm run test:reader` (3 pass, 0 fail; real-corpus journeys skip without `KNOWLEDGE_BASE_ROOT`), plus contract, navigation, and staging suites (52 pass, 0 fail). Worktree clean; no drift or private content in the three commits (`9412eea`, `8c349e0`, `2520d30`).
- 2026-09-23: The two manual inspections remain for the Knowledge Base owner. Inspection material was captured from a small synthetic staging: desktop light/dark tree, desktop light/dark search dialog with results, phone Browse tree, and phone search dialog (360×800). Serve an export and open it in a browser for the interactive pass (folder link vs disclosure, focus return, touch targets). Note: the disposable staged `content/` and generated `site-identity.json` were replaced by a synthetic probe corpus during verification; re-stage the real vault with `node scripts/stage-content.mjs --kb-root <vault> [--identity-file <path>]` before the manual pass.
