# Web Projection reader UI rework

Status: ready-for-agent

## Problem Statement

The current Web Projection reader has a plain home list, a narrow desktop tree,
an inline phone Browse panel, breadcrumbs above each article, and offline
controls in a page footer. Readers must move between these places to browse,
search, understand their location, check offline state, or change appearance.
The interface does not make Personal and Shared easy to switch between. Notes
that carry an edit timestamp do not show it, so readers cannot compare the
published note with their memory of a recent edit.

## Solution

Give every Web Projection a cohesive static reader shell. Use a collapsible
desktop sidebar and a full-viewport phone drawer with one published folder-and-
note tree. Put the current projection, explicitly configured projection links,
Home, and Search at the top; the tree in the scrollable middle; and offline
status/actions plus appearance at the bottom. Put the sidebar trigger and
route-derived breadcrumbs in the reading header. Keep the article a readable
width. Present published roots as responsive home cards rather than a plain
list. Show a note's trustworthy `updated_at` date, hour, and minute when it
exists, without suggesting that the Web Projection is synchronized with the
Knowledge Base.

Keep whole-projection offline saving. Personal and Shared are the first
explicitly configured switch destinations; links move between separate origins
and retain each origin's access policy, installed identity, and offline copy.

## User Stories

1. As a reader, I want one consistent shell on Home, folder pages, and notes, so that navigation stays familiar.
2. As a desktop reader, I want the published file tree beside my article, so that I can browse without leaving what I read.
3. As a desktop reader, I want to hide and restore the sidebar, so that I can make room for long articles.
4. As a reader, I want the projection name at the top of the sidebar, so that I know which Web Projection I opened.
5. As a reader, I want a Home link in the sidebar, so that I can return to the entry page.
6. As a reader, I want Search in the sidebar, so that I can find a published note.
7. As a reader, I want the same Search dialog and keyboard shortcut in the new shell, so that my existing search workflow still works.
8. As a reader, I want folder and note icons, so that I can distinguish their routes at a glance.
9. As a reader, I want the active page and its ancestor folders to be clear, so that I know my position in the tree.
10. As a reader, I want to open multiple folder branches, so that I can compare sections.
11. As a reader, I want a folder name to open its own page, so that I can read its authored or virtual introduction.
12. As a reader, I want a separate folder disclosure control, so that I can inspect children without leaving my page.
13. As a reader, I want branches I opened to remain open during this browser session, so that moving between notes does not reset my work.
14. As a reader, I want browser Back and direct URLs to restore the right page and visible ancestors, so that navigation remains predictable.
15. As a phone reader, I want navigation in a full-width, full-height drawer, so that long titles and nested folders have room.
16. As a phone reader, I want a visible Close control and Escape support, so that I can return to the article easily.
17. As a keyboard reader, I want focus to return to the drawer trigger after I dismiss it, so that I do not lose my place.
18. As a phone reader, I want the drawer to close after selecting a page, so that I can start reading immediately.
19. As a phone reader, I want the drawer tree to scroll without moving the article behind it, so that controls stay usable.
20. As a reader, I want the current path in the reading header, so that I can understand and navigate the folder hierarchy.
21. As a phone reader, I want long paths to fit without horizontal page overflow, so that the current page remains visible.
22. As a reader, I want Home cards for published roots, so that I can choose a starting section quickly.
23. As a reader, I want folder and note cards to look distinct, so that I know what a card opens.
24. As a reader, I want folder cards to show a useful immediate-child count, so that I can judge their size without opening them.
25. As a reader, I want an authored Home introduction retained above the cards, so that the publisher's introduction is not lost.
26. As a Knowledge Base owner, I want root cards to keep Publication Manifest navigation order, so that my presentation choice is respected.
27. As a reader, I want to switch between Personal and Shared from the sidebar, so that I can reach the intended Web Projection.
28. As a reader, I want a switch to follow the destination site's normal link, so that its access rules and browser history still apply.
29. As a reader, I want each destination's offline state to stay independent, so that switching sites does not imply both are saved.
30. As a Knowledge Base owner, I want to opt in to each displayed destination, so that a site does not automatically advertise another projection.
31. As a reader, I want the switcher to work even when only the current projection is configured, so that a single-projection site has a complete header.
32. As a reader, I want a note's Last edited date and time when the note supplies one, so that I can compare it with when I remember editing the note.
33. As a reader, I want the time zone to be clear, so that the displayed hour and minute are not ambiguous.
34. As a reader, I do not want a guessed Last edited date on notes without a valid edit timestamp, so that a precise-looking label does not mislead me.
35. As a reader, I want the edit time to remain available offline, so that the saved page gives the same source information.
36. As a reader, I want offline status in the sidebar, so that I can tell whether this projection is saved on this device.
37. As a phone reader, I want an offline-state cue while the drawer is closed, so that saving, failures, and ready updates are not hidden.
38. As a reader, I want save progress, estimated size, retry, update-ready Reload, and removal actions to remain clear, so that the new layout does not reduce control over my offline copy.
39. As a reader, I want Remove offline copy to remain an explicit named action, so that I do not mistake an icon for a harmless navigation control.
40. As a reader, I want Light, Dark, and System appearance choices in the new shell, so that my preference remains available.
41. As a keyboard reader, I want visible focus and operable controls throughout the shell, so that I can browse without a pointer.
42. As a reader of long titles or deeply nested folders, I want labels and controls to remain readable, so that navigation does not clip my content.
43. As a Knowledge Web Publisher maintainer, I want the rework to preserve the static export, so that no content API or runtime application server is required.
44. As a Knowledge Base owner, I want the Allowlist to remain the publication authority, so that the UI never exposes unselected pages.

## Implementation Decisions

- Reuse the reader's existing staged content, generated site identity, navigation tree, route-derived breadcrumbs, Search dialog, appearance control, and offline control. Do not create a second content or navigation model.
- Keep the publication boundary of ADR-0001 through ADR-0003: read-only Web Projections, allowlisted content only, static output, no runtime Git, database, content API, or editing. Respect the accepted removal of the Quartz rollback path in ADR-0004.
- Compose a desktop sidebar with a header, scrollable published tree, and footer, beside a reading inset. Preserve a bounded article width. Collapse the desktop sidebar fully rather than showing a file-icon rail.
- Use one tree across desktop and phone. Retain separate folder page links and disclosure controls, current-page/ancestor indication, session-open branches, page-scoped deliberate closes, and ordinary anchor navigation/Back behavior.
- Make the phone drawer occupy the available viewport width and height. Account for safe areas and small viewport heights. Provide an accessible name, a visible Close control, keyboard focus containment, focus return, background scroll lock, Escape dismissal, and closure on page selection. Keep opening it out of URL history.
- Keep Search available while the phone drawer is closed and preserve its existing shortcut and focus return. Avoid a second independent Search dialog.
- Place one route-derived breadcrumb trail in the reading header instead of duplicating it above the article. Home, authored and virtual folders, deep notes, and routes outside visible navigation must retain meaningful paths; adapt long paths without horizontal overflow.
- Build Home cards from already published navigation roots in their declared order. Treat root folders and root notes differently, show an immediate-child count only when meaningful, keep authored Home content above cards, and avoid a self-linking Home card. Do not invent summaries or add card metadata requirements.
- Offer optional, owner-declared projection destinations through validated publication configuration and generated public-safe site identity. Existing manifests with no destinations remain valid. Require explicit display names and secure absolute HTTPS origins; reject unsafe/malformed values, duplicates, and conflicting current-origin entries. Do not auto-discover destinations or hard-code Personal/Shared hosts into generic Publisher code. Initially configure only the Personal and Shared sites in their respective consumer repositories when those owners opt in. Destination choice is an ordinary cross-origin link, not a client-side content switch or a new access mechanism.
- Use the source note's valid, timezone-aware `updated_at` timestamp as the sole source for Last edited. Confirm whether the current content loader exposes it; if not, carry only the needed metadata across the existing staged-content/build boundary without changing source Markdown. Do not use `created_at`, date-only fields, copied-file mtime, or build time as a replacement. Render machine-readable time and a stable, unambiguous time-zone fallback in static HTML; any client-local display must enhance after hydration without a mismatch and identify the time zone. Omit the line on missing or invalid data. Do not describe it as a drift or synchronization check.
- Keep the existing explicit whole-projection Save, Workbox revisioned precache/integrity behavior, update/reload, and scoped removal. The shell may change their presentation, but must not move saving behind an automatic event or mix origins. Keep a visible phone-header offline-state cue and detailed actions in the drawer.
- Preserve grayscale light/dark styling, high-contrast active and focus states, readable long labels, and adequate touch targets. Prefer the project's current styling and component conventions; adopt only the UI primitives needed for this shell.
- Deliver in reviewable vertical slices: shell/tree; phone drawer/breadcrumbs; Home cards; optional destination contract/switcher; edit timestamps; offline/appearance placement and polish. Verify the complete UI before rollout. Update the shared Publisher first, then pin and verify Damian; change Shared's pin only after its owner opts in and Damian's critical journey passes.

## Testing Decisions

- Prefer externally visible behavior at the highest useful seam: stage a neutral synthetic Knowledge Base, build its static Web Projection, and exercise Home → folder → deep note, tree expansion, Search, breadcrumbs, switcher links, timestamps, and offline UI through browser journeys. Do not test CSS class names or component nesting as the primary proof.
- Extend existing synthetic static-export and desktop/phone journey tests rather than building a parallel harness. Retain the current offline save/update/remove browser journey as regression evidence.
- Include a phone viewport that verifies the full-viewport drawer, safe-area reachability, independent tree scroll, background scroll lock, keyboard close/focus return, page-selection dismissal, and access to Search/offline state when closed. Include desktop collapsed/expanded and direct-deep-link cases.
- Exercise authored and virtual folders, mixed root folders/notes, declared root ordering, an authored Home introduction, a Home root self-link case, long labels, a published route omitted from visible navigation that remains discoverable through existing mechanisms, and Back/refresh behavior.
- Add focused staging-contract checks for absent, valid, and invalid optional destination configuration. Assert that generated metadata contains only explicitly declared public destinations and that legacy manifests still build unchanged.
- Add focused timestamp checks at the content-to-static-page seam for valid timezone-aware `updated_at`, missing and invalid values, date-only fields, and local-time enhancement without hydration error. Confirm that source Markdown remains unchanged and that offline HTML retains the timestamp.
- Verify offline states as user-visible labels and actions, including saving progress, ready, update ready, incomplete/retry, and removal failure. Check that merely opening a sidebar or drawer does not start a save.
- Check supported narrow and wide viewport layouts, long titles, keyboard focus, touch targets, light/dark/System appearance, and lack of horizontal overflow. Report any checks not run on a real phone as unverified rather than assuming equivalence with a desktop viewport.
- On live rollout, verify the authenticated Damian Web Projection before updating another consumer; confirm its static manifest, page navigation, Save and offline restart, update/reload, and removal still work. Keep Access and edge response integrity intact.

## Out of Scope

- Selective folder saving. Whole-projection saving is fast enough for now.
- Editing the Knowledge Base, publishing new content through the UI, or adding a runtime content API.
- Live comparison with canonical knowledge, drift detection, or a claim that the Web Projection is up to date.
- Team management, adding vaults from the reader, automatic projection discovery, workspace/favorites sections, or links to projections an owner has not declared.
- Changing Access policies, sharing authentication across sites, or sharing offline caches across origins.
- New card summaries, images, site-specific iconography, or mandatory new frontmatter fields.
- Reorganizing `notes` or changing any Knowledge Base's content hierarchy.

## Further Notes

- The sample shadcn sidebar examples are layout references, not product data or a requirement to copy their component tree verbatim. In particular, the sample folder row's single expand action must not replace this reader's separate folder-page link.
- Inspection of the local Damian Knowledge Base found timezone-aware `updated_at` on 93 of 95 Markdown files directly under `notes/`. Other published areas generally lack edit timestamps. Absence must remain visible as absence, not inferred freshness.
- The current Damian consumer excludes `.git` from its Docker build context, so Git history is not a dependable note-edit source. Personal and Shared currently advertise separate canonical hostnames and must remain separate Web Projections.
- The working tree had unrelated in-progress changes when this spec was written. This specification did not alter them.
