# 06 — Trustworthy Last edited time on notes

**What to build:** A reader sees the source note's Last edited date, hour, and minute when a valid `updated_at` timestamp exists, with no false freshness label on other pages.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A valid timezone-aware `updated_at` from staged Markdown produces a subdued Last edited line with date, hour, minute, a clear time zone, and a machine-readable time value on the published note.
- [ ] If the existing content loader does not expose that frontmatter field, the build carries only the needed metadata across the existing isolated staging/static-render boundary without rewriting source Markdown or adding a runtime API.
- [ ] The static page has an unambiguous fallback time; any device-local enhancement occurs after hydration without mismatch and identifies its time zone.
- [ ] Missing or invalid `updated_at`, a date-only field, `created_at`, copied-file timestamps, and build timestamps do not create a Last edited claim. Virtual folders without authored timestamps do not get one.
- [ ] The label describes an edit time, not live synchronization or drift. The same source timestamp remains available on an offline saved page.
- [ ] Focused fixtures cover valid timezone offsets, missing and invalid values, authored notes and folders, unchanged source files, and a static-export browser journey including offline rendering.
- [ ] The Last edited line preserves bespoke article typography and uses shadcn registry components only where needed. Block sample data is not product data.
