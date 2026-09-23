# 01 — Tree sidebar on desktop and phone

**What to build:** Render the existing generic navigation tree in the reader
sidebar: folders and notes under each published root, on desktop and in the
phone Browse panel. A folder keeps a link to its own page and a separate
disclosure control for its children.

**Blocked by:** none.

**Status:** ready-for-agent

- [x] The desktop sidebar shows nested folders and notes; published root order and child order match folder pages.
- [x] A folder name navigates to its page; a separate disclosure control expands or collapses its children without navigation.
- [x] Several branches can stay expanded at once.
- [x] Arriving at a page opens its ancestor branches; the current page and section remain clearly indicated.
- [x] A deliberately collapsed branch stays closed on the current page; open branches survive page visits and browser Back during the session.
- [x] Phone Browse shows the same tree, stays closed while reading, and closes after selecting a page.
- [x] Navigation uses normal URLs and history; deep folders and long titles remain readable at representative desktop and phone widths.
- [x] Reader browser journeys cover the tree behavior on the synthetic static export.

## Comments

- 2026-09-23: Implemented in `9412eea`. Notable: deliberate closes are page-scoped and released on any pathname change AND on Chrome back/forward-cache restores (`pageshow` listener), because a bfcache Back restores the document with stale React state and no router navigation.
