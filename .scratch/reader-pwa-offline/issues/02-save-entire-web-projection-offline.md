# 02 — Save the entire Web Projection offline

**What to build:** A reader on a trusted device can deliberately save every published page and then browse and search that complete Web Projection without a connection.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A visible Save for offline use action explains the trusted-device copy, shows an estimated size, allows mobile data, and starts no whole-site download before the reader chooses it.
- [ ] The save shows progress and reports Ready offline only after every published page, including authored and virtual folders and published pages omitted from navigation, plus the search index and required reader assets, are available offline.
- [ ] Offline launch, extensionless page URLs, Browse, search, search-result links, and normal navigation work after a successful save and browser restart.
- [ ] Interrupted download, storage failure, or denied online access produces a clear incomplete state with retry; sign-in or redirect responses cannot masquerade as published pages.
- [ ] Offline inputs come only from the finished static export of Allowlisted content on that Web Projection's origin, without a content API or a custom caching engine.
- [ ] One focused production-export browser journey demonstrates save, offline browsing, and search using the existing synthetic reader build; existing output-safety checks cover the generated offline inputs.
