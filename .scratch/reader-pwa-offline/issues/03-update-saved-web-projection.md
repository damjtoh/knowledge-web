# 03 — Update a saved Web Projection

**What to build:** A reader with a saved copy gets a complete new publication, can finish reading before reloading, and never loses the previous complete copy to a failed update.

**Blocked by:** 02 — Save the entire Web Projection offline.

**Status:** ready-for-agent

- [ ] Changed pages and the search index use new revisions, while unchanged exported assets can be reused; removed pages do not remain available in the current offline publication after a successful update.
- [ ] A failed or interrupted update leaves the previous complete offline copy usable, including when online access cannot provide valid published responses.
- [ ] Once the replacement is ready, the reader offers Update ready — Reload and does not forcibly interrupt the current reading session.
- [ ] After reload, offline pages and search reflect the same published version.
- [ ] A small exported-file fixture verifies changed and removed cache entries without a second full Next.js reader build; extend the existing browser journey only where observable update behavior needs proof.
