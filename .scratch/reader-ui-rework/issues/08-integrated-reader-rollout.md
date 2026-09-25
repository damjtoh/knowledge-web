# 08 — Integrated reader verification and staged rollout

**What to build:** Readers get the complete UI rework on live Web Projections without losing navigation, access protection, or their existing offline copy.

**Blocked by:** 03 — Route breadcrumbs in the reading header; 04 — Published root cards on Home; 05 — Opt-in Personal and Shared Web Projection switcher; 06 — Trustworthy Last edited time on notes; 07 — Offline status and appearance in the new shell.

**Status:** ready-for-agent

- [ ] The combined synthetic static export and desktop/phone browser journeys pass with Home cards, tree, drawer, breadcrumbs, switcher, note time, Search, appearance, and offline states together.
- [ ] Verify narrow and wide viewports, long titles, deep routes, direct loads, keyboard focus, browser Back, safe areas where supported, and light/dark appearance; document any real-device checks not performed.
- [ ] The reader remains a static read-only Web Projection with Allowlist enforcement, no runtime content API, per-origin installs/caches, and unchanged Cloudflare Access protection.
- [ ] Pin a reviewed Publisher revision in Damian's consumer and verify authenticated live browsing, Save/offline restart, update/reload, and removal before updating another consumer.
- [ ] When Shared's owner has opted in, pin and verify Shared independently. Do not change other Web Projections as a side effect or claim an unverified live workflow passed.
- [ ] The integrated rollout verifies the registry-installed sidebar-11 shell with no block sample data shipped as product data.
