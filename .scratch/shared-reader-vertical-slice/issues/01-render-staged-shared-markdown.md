# 01 — Render staged Shared Markdown as a static reader

**What to build:** Produce a read-only static reader from the isolated Shared
staging tree and make a real Travel note directly readable. This first tracer
bullet must cross the full publication path from Publication Manifest through
staging, headless Markdown loading, static export, and browser-visible output.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The reader consumes only the isolated staged content and generated site identity; it cannot scan the original Knowledge Base.
- [ ] Fumadocs MDX/Core loads the staged Markdown as a headless content source without using Fumadocs UI.
- [ ] Next.js produces a static export that requires no Node.js production server.
- [ ] All 53 selected Shared Markdown files plus the synthetic landing page build successfully.
- [ ] A direct Travel note URL renders the authored title and body as a readable article.
- [ ] Real Shared tables, task lists, external links, external images, inline code, and code blocks render without a bespoke Markdown compiler.
- [ ] Non-Markdown staged files are not discovered as pages.
- [ ] The generated Shared title and canonical hostname appear in document metadata.
- [ ] Static output contains no known unselected sentinel, original-vault path, or private absolute source path.
- [ ] Staged content, generated content modules containing private text, and static output remain untracked.
- [ ] Quartz and its existing rollback build remain available and unchanged.
- [ ] A production-build browser check proves that the direct Travel note is readable from the exported files.
