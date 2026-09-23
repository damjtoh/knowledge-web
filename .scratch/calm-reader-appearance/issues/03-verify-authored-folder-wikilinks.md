# 03 — Verify authored-folder wikilinks

**What to build:** Prove that a bare title wikilink to an allowlisted authored folder index opens its published folder route, while a backticked example stays literal. Correct reader link resolution only if the exported result fails.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] An existing synthetic static-export check proves that a bare authored-folder title wikilink produces an internal link to the folder route.
- [ ] The same check proves that the backticked form remains literal code.
- [ ] Missing or unselected targets stay unresolved and never bypass the Allowlist.
- [ ] Existing wikilink and reader checks pass without changing Knowledge Base notes or adding a custom parser.
