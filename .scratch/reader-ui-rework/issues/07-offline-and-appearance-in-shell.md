# 07 — Offline status and appearance in the new shell

**What to build:** A reader sees offline state and appearance controls in the sidebar, with a compact offline-state cue available on a phone even while its drawer is closed.

**Blocked by:** 01 — Desktop reader shell and published file tree; 02 — Full-screen phone navigation drawer.

**Status:** ready-for-agent

- [ ] The sidebar has usable Light, Dark, and System choices and visible offline status/actions; the old page footer does not duplicate those controls.
- [ ] The closed phone drawer leaves a compact, understandable offline-state cue in the reading header. Opening the drawer reveals relevant details and actions.
- [ ] Checking, idle with size/trusted-device reminder, saving with progress, ready, update-ready Reload, incomplete/retry, and removal-failed states stay understandable at desktop and phone sizes.
- [ ] Remove offline copy is a clearly named, explicit action. No drawer or appearance interaction triggers a save or changes an unrelated origin's cache.
- [ ] The existing explicit full-projection save, Workbox integrity, ready/update checks, reload, and scoped removal behavior remain unchanged; saving stays possible on any connection.
- [ ] Browser journeys cover user-visible offline states and actions in both layouts, plus restored appearance without a light/dark flash. Retain the full save/offline/update/remove regression journey.
