# 04 — Make the reader journey phone-ready

**What to build:** Make the approved Shared reading journey comfortable and
predictable on phones while preserving the desktop experience. Finish the
vertical slice with production-browser and static-output evidence rather than
expanding into search, offline support, or another projection.

**Blocked by:** 03 — Browse from Shared home to a Travel note.

**Status:** ready-for-agent

- [ ] Phone layouts do not show a permanent sidebar and keep note content primary.
- [ ] A compact Browse control opens and closes an area-and-folder navigation surface.
- [ ] Browse exposes the same selected areas and Travel hierarchy as desktop without creating a second navigation model.
- [ ] Navigation controls and list rows provide usable touch-target sizes.
- [ ] Normal browser Back closes or leaves surfaces predictably and returns through page history without a parallel application stack.
- [ ] Long titles and breadcrumbs wrap without obscuring navigation or content.
- [ ] Tables, code blocks, and wide images remain contained without page-level horizontal overflow.
- [ ] Article typography keeps a comfortable measure, spacing, and heading hierarchy at phone widths.
- [ ] Keyboard focus is visible and navigation, main content, and Browse use appropriate semantic landmarks and accessible names.
- [ ] Direct nested-page URLs and browser refreshes work through the static nginx-style routing contract.
- [ ] Production-browser coverage passes at a narrow phone, larger phone, and desktop viewport.
- [ ] Browser coverage includes Browse open/close, the full Home-to-Travel-to-note journey, breadcrumbs, browser Back, and direct refresh.
- [ ] Final output inspection finds no unselected sentinel, original-vault path, private absolute source path, or committed generated content.
- [ ] The final static reader still requires no database, writable content storage, runtime Git, content API, or Node.js production server.
- [ ] Search, PWA/offline behavior, the Damian Web Projection, deployment migration, and Quartz removal remain absent.
