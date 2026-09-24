# Installable and offline Knowledge reader

Status: ready-for-agent

## Problem Statement

Readers can browse and search a Web Projection only while connected. They
cannot install the reader as an app or deliberately keep their published
knowledge available on a trusted device. A page they read online is not
reliably available later, and changes to a publication have no offline update
path. This matters especially on phones and during travel.

## Solution

Make each Web Projection installable under its own site identity. Offer an
explicit **Save for offline use** action that downloads every published page,
the search index, and the assets needed to browse and search. Show the
estimated download size, progress, and a clear ready or failure state. Allow
the reader to save on any connection and to remove the offline copy later.

Use Workbox to manage the versioned offline cache. When the publication
changes, download a complete replacement before offering **Update ready —
Reload**. Preserve the current reading session until the reader reloads.
Online access remains governed by the existing Cloudflare Access policy;
saved content remains readable without an online identity check on that
trusted device, even after an online session expires.

## User Stories

1. As a reader, I want to install a Web Projection, so that I can launch it from my device.
2. As a reader, I want the installed app to show the right site name, so that I can distinguish Web Projections.
3. As a reader, I want the installed app to open the corresponding Web Projection, so that I arrive at the right home page.
4. As a reader, I want a visible Save for offline use action, so that downloading content is my choice.
5. As a reader, I want to see the estimated download size before I save, so that I can decide whether to use mobile data or device storage.
6. As a reader, I want to start saving on any connection, so that I do not have to wait for Wi-Fi.
7. As a reader, I want to see download progress, so that I know the save is still working.
8. As a reader, I want a clear Ready offline state only after the download completes, so that I can rely on the saved copy.
9. As a reader, I want an understandable failure and retry option if saving fails, so that an incomplete save is not mistaken for a complete one.
10. As a reader, I want saving to fail clearly when storage is insufficient, so that the reader does not claim that every page is available.
11. As a reader, I want a trusted-device reminder beside Save for offline use, so that I understand that saved pages remain on this device.
12. As a reader, I want the home page available offline, so that I can open the saved reader without a connection.
13. As a reader, I want every published note available offline, so that I do not need to guess which pages I opened while online.
14. As a reader, I want authored and virtual folder pages available offline, so that Browse keeps working.
15. As a reader, I want pages omitted from visible navigation but still published to remain available offline, so that search results can open them.
16. As a reader, I want local full-text search to work offline, so that I can find a saved note.
17. As a reader, I want page styling and controls to work offline, so that reading and navigation stay usable.
18. As a reader, I want normal note URLs, links, and browser navigation to work offline, so that the saved reader behaves like the online one.
19. As a reader, I want to know when an updated publication has finished downloading, so that I can choose when to switch versions.
20. As a reader, I want to finish my current reading session before I reload, so that an update does not interrupt me.
21. As a reader, I want changed notes and search results to match after an update, so that search does not lead to an outdated offline page.
22. As a reader, I want a failed update to leave my previous complete offline copy usable, so that a weak connection does not remove it.
23. As a reader, I want removed pages to disappear from the current offline publication after a successful update, so that the saved copy reflects the new publication.
24. As a reader, I want an option to remove the offline copy, so that I can clear saved content before I stop using a device.
25. As a reader, I want removal to change the displayed offline status, so that the reader no longer claims content is saved.
26. As a reader, I want offline availability to survive a browser restart after a successful save, so that I can use it later.
27. As a reader, I want to know when the browser has cleared saved data, so that an outdated Ready offline label does not mislead me.
28. As a Knowledge Base owner, I want only Allowlisted content in the offline download, so that offline use does not widen publication.
29. As a Knowledge Base owner, I want offline copies kept under each Web Projection's origin, so that one projection cannot mix with another.
30. As a Knowledge Web Publisher maintainer, I want the offline download generated from the finished static export, so that the reader remains a read-only static site without a content API.
31. As a Knowledge Web Publisher maintainer, I want changed files detected automatically, so that updates do not require hand-written cache-busting rules.
32. As a Knowledge Web Publisher maintainer, I want a small test seam, so that offline support does not add another long-running full reader build.

## Implementation Decisions

- Target the custom Knowledge reader, not the vendored Quartz rollback. Keep
  the stateless static export behind nginx. No database, content API, runtime
  Git, editable Knowledge Base, or change to the publication authority.
- Use the existing staged content and generated public site identity. Generate
  an installable app manifest per Web Projection with its title and start URL;
  use generic Publisher-owned icons unless a later requirement adds per-site
  artwork. Do not require new Publication Manifest fields.
- Use Next.js App Router manifest support for install metadata. Use Workbox
  build tooling after the reader's static export and search-index generation
  to produce a service worker and a revisioned cache list from the final
  export. Do not build a custom cache engine or rely on a Next.js server.
- Cache every exported published HTML page, including virtual folders and
  pages outside visible navigation, together with the local search index and
  assets required to render and navigate offline. Do not scan the original
  Knowledge Base, add unselected content, or bundle the Quartz output.
- Match extensionless published URLs to exported HTML in the offline worker,
  consistent with the existing nginx route mapping. Keep the cache on the
  projection's own origin and do not cache cross-origin requests, Cloudflare
  Access sign-in pages, or authentication redirects as published content.
- Saving is an explicit action after the reader reaches the online Web
  Projection. Do not start whole-site precaching merely because someone
  visited or installed it. Register the precaching worker when the reader
  chooses to save; persist its control for later offline visits and updates.
- Calculate and show a useful estimated download size from the generated
  export. Allow saving on Wi-Fi or mobile data. Show progress, a completion
  state, and an actionable failure/retry state. Do not claim readiness before
  the whole published set needed for offline reading and search is saved.
- Treat insufficient storage, interrupted connectivity, or denied online
  access as incomplete saves. Keep a prior complete offline copy if a later
  update fails. An online session or sign-in failure must not cause a login
  response to replace a published page in the cache.
- Let Workbox use file revisions for stable page and search-index URLs and
  existing hashed asset URLs where applicable. Publish the updated worker
  with headers that allow update checks; coordinate activation and the
  **Update ready — Reload** control so the current reading session is not
  forcibly reloaded. A successful new version must stop serving removed
  pages from the old offline publication.
- Provide Remove offline copy in the same reader-facing control. Remove this
  projection's saved worker and caches, clear the saved state, and prevent a
  later visit from silently restarting the whole-site download. A future
  Save action can create a new offline copy.
- Cloudflare Access email OTP remains the online entry policy. Offline
  content is a device-local copy that cannot recheck identity or be remotely
  revoked while offline. Describe Save for offline use as a trusted-device
  choice. Do not suggest that an expired online session deletes that copy.
- Keep the existing generic reader and build boundaries: one Publisher
  implementation works for every Knowledge Base, driven only by its staged
  Web Projection and generated identity. Do not add vault-specific rules.

## Testing Decisions

- Test observable behavior through the highest existing seam: one synthetic
  production static export served by the nginx-style test server and opened
  in a browser. Reuse the existing reader build and journey fixture rather
  than create another full-build suite.
- In one focused browser journey, verify the explicit save action, a complete
  ready state, offline launch and navigation to an unvisited published page,
  offline folder navigation, offline search and result opening, and removal
  of the offline copy. Check the displayed state after removal.
- Test revision behavior with a small exported-file fixture: change a page
  and the search index, regenerate the Workbox output, and inspect its changed
  revision entries and removed entries. Do not perform a second Next.js
  production build solely to test cache busting.
- Extend existing static-output safety checks to cover install metadata and
  generated offline inputs. Assert that unselected fixture content and local
  source paths never enter the generated export or offline cache list.
- Keep browser assertions focused on what a reader can do, not Workbox's
  internal cache layout. Use synthetic Knowledge Base content, existing
  static/export and browser test conventions, and the existing optional
  real-corpus harness where applicable.
- Replace legacy assertions that prohibit service workers or web manifests
  in reader production code. Retain their other publication-boundary checks.
- Keep the required verification slim: one existing synthetic reader build
  plus the focused browser journey and cheap generated-output checks. Avoid
  duplicate builds or a broad device/browser matrix for this feature.

## Out of Scope

- Offline editing, synchronization, a local canonical Knowledge Base, or
  background upload.
- Offline Cloudflare Access authentication or automatic revocation of a
  saved device copy when an online session expires.
- Per-page offline selection, Wi-Fi-only restrictions, or automatic download
  on first visit.
- Publishing new binary attachments solely for PWA support. If a binary is
  already part of a published reader page, its delivery follows the existing
  publication boundary.
- Quartz rollback PWA support, push notifications, and an app store package.

## Further Notes

- Accepted ADR-0002 calls for an installable PWA and offline reading on
  trusted devices. ADR-0003 requires a generic reader built only from staged
  content and generated public metadata. ADR-0001 preserves the Allowlist
  and stateless runtime boundaries.
- The current reader uses Next.js static export. Its search index is generated
  after the Next.js build, and nginx maps extensionless routes to exported
  HTML. Offline generation must run after both output steps and preserve that
  route behavior.
- Browser storage may be evicted by the device. The reader must base its
  Ready offline claim on actual saved state, not solely on an old local flag.
- The offline copy is intentionally a trusted-device artifact. Removing it
  from one browser does not revoke copies previously saved on other devices.
