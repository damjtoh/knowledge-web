# 01 — Install each Web Projection

**What to build:** Readers can install a Web Projection on their device and launch the right read-only site under its own name and icon.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Each static Web Projection exposes valid install metadata with its generated title, start URL, display settings, and Publisher-owned icons; no Knowledge Base-specific production rules or new Publication Manifest fields are needed.
- [ ] The installed app launches the same Web Projection and does not mix identity with another projection.
- [ ] Existing synthetic static-export checks confirm the generated install metadata and icons without an extra full reader build.
- [ ] The reader remains a static export behind the existing nginx runtime.
