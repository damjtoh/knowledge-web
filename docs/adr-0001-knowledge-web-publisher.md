# ADR-0001 — Dedicated Knowledge Web Publisher with opt-in projections

- Status: Accepted (Decision 4 superseded by ADR-0002)
- Date: 2026-08-04
- Deciders: Knowledge Web launch (implementation ticket 01)
- Context: this decision is recorded at the boundary between the first
  adopter (the Travel Knowledge Base) and the Publisher itself.
- Note: Decision 4 (Quartz v5 as publishing engine) is superseded by
  [ADR-0002](adr-0002-quartz-replacement-reader.md). Decisions 1–3 and 5
  (dedicated publisher, opt-in projections, explicit allowlists, isolated
  staging, canonical content, stateless static runtime) are retained.

## Context

Multiple Knowledge Bases want a read-only, mobile-friendly website of
**selected** Markdown with explorer-style browsing, local full-text search,
and Obsidian/Tolaria-compatible wikilinks. One Knowledge Base previously
carried a complete private copy of Quartz plus a rebuild script. That pattern
does not scale: copying the full build machinery into every content repository
creates a large duplicated maintenance surface, and publishing a whole
repository by default risks exposing material that was never intentionally
selected.

We need a reusable but deliberately small publication boundary, a secure
selection mechanism, and a way for content repositories to stay independent.

## Decision

1. **A dedicated public Publisher repository owns the build machinery.**
   Quartz v5 source, its npm lockfile, the community-plugin lockfile, the
   shared presentation configuration, the manifest contract, and the runtime
   contract live in one repository (this one). Knowledge Bases do not vendor
   or fork Quartz; they fetch the Publisher at an immutable commit SHA during
   their own thin container build. The Publisher is public and generic so
   builds can obtain it without a private registry credential, and it contains
   no personal knowledge or secrets.

2. **Web Projections are opt-in per Knowledge Base.**
   A Knowledge Base publishes only by adding a small Publication Manifest and
   a thin multi-stage Docker build. There is no repository-wide publish mode
   and no denylist mode: unmodified repositories have no web surface.

3. **Explicit allowlists are the publication authority.**
   The manifest names the content roots and files to publish. Files outside
   the allowlist never enter the generated site or the final runtime image,
   even though the private repository is the Docker build context. The build
   rejects malformed or unsafe selections — missing, nonexistent, absolute,
   parent-traversing, out-of-root, or symlink-escaping — before producing any
   partial output. This complements (does not replace) identity-aware access
   control at the application boundary: the manifest controls what the
   application contains; the proxy controls who may reach it.

4. **Quartz v5 is the publishing engine. — SUPERSEDED by ADR-0002.**
   It natively provides the confirmed requirements: explorer-style browsing,
   local search, and Obsidian/Tolaria wikilinks, with a YAML configuration
   surface and a plugin ecosystem. VitePress and Material for MkDocs were
   considered but would require custom wikilink translation or ongoing plugin
   maintenance for the same behavior. Only browsing, search, wikilinks, and
   responsive rendering are enabled; graph views, backlinks, comments,
   analytics, RSS/sitemap output, and editing are excluded from the shared
   configuration. Quartz remains vendored for rollback until Phase 7, but new
   work targets the custom static knowledge reader defined in ADR-0002.

5. **Web Projections are separated from canonical content.**
   The Publisher copies only allowlisted content into an isolated build tree,
   preserving Markdown and frontmatter byte-for-byte, and never writes into
   the Knowledge Base. The runtime is stateless static files behind minimal
   nginx: no database, writable volume, runtime Git, synchronization, or
   content API. A Web Projection is derived and disposable; its canonical
   source is always the selected content in the Knowledge Base repository.

## Consequences

Positive:

- Content repositories carry only a manifest and a thin Dockerfile.
- Publication is explicit and reviewable; upgrades are explicit SHA bumps.
- Private content exists only in its own content-specific build and final
  application image, never in the shared Publisher artifact.
- Rebuilding a projection is safe because the Knowledge Base is never
  modified.

Negative:

- The Publisher becomes a platform dependency that must be maintained and
  pinned; adopters must update it deliberately.
- The allowlist must be extended explicitly when new content should appear;
  this is a deliberate tradeoff favoring safety over convenience.

Risks and mitigations:

- A malformed manifest could broaden publication — mitigated by strict
  validation that fails the build before any output exists.
- The vendored Quartz machinery could diverge from upstream — mitigated by
  pinning the upstream revision, recording the one local modification, and
  pinning all npm and plugin dependencies through lockfiles (see
  [UPSTREAM.md](UPSTREAM.md)).
- This decision is hard to reverse once multiple Knowledge Bases adopt it —
  by design; it is the reason the decision is recorded here rather than in
  any single content repository.
