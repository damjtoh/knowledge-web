# ADR-0002 — Replace Quartz with a custom static knowledge reader

- Status: Accepted
- Date: 2026-09-21
- Deciders: Knowledge Web publisher (Phase 0)
- Supersedes: ADR-0001 Decision 4 (Quartz v5 as publishing engine)

## Context

ADR-0001 accepted Quartz v5 as the publishing engine for explorer browsing,
local search, and Obsidian/Tolaria wikilinks. That decision served the first
release, but the current presentation reproduces the navigation problem for
real corpora: broad type collections are too flat and can show very long
lists, and the Quartz theme is a documentation theme rather than a
human-friendly reader for phones.

The publisher boundary itself remains sound: a dedicated public publisher,
opt-in projections, explicit allowlists, isolated staging, disposable static
runtime, canonical Markdown and Git. Only the rendering engine and
presentation need replacement.

## Decision

1. **Quartz will be replaced by a custom static knowledge reader.** The reader
   is a lean static application built from staged Markdown. It owns safe
   publication rendering, human navigation and reading, full-text search,
   Markdown and wikilink resolution, responsive mobile and desktop layouts,
   installable PWA behavior, and offline reading on trusted devices.

2. **Retain the dedicated publisher boundary.** The publisher repository
   continues to own build machinery, the manifest contract, and the runtime
   contract. Knowledge Bases do not vendor the reader; they fetch the
   publisher at an immutable commit and publish through the same thin
   container build.

3. **Retain explicit allowlists as the publication authority.** Only manifest
   `select` entries enter staging, the page model, search, and the final
   image. Validation still fails before partial output.

4. **Retain isolated staging.** The publisher copies only allowlisted content
   byte-for-byte into an isolated build tree, generates a synthetic landing
   page only when no root `index.md` exists, and never writes into the
   Knowledge Base. Staging now emits deterministic generated site identity
   (`title`, `canonicalHostname`) as JSON outside the staged content tree and
   never mutates `quartz.config.yaml` or another tracked configuration file.

5. **Retain canonical Markdown and Git.** Markdown and Git remain the
   canonical records. The reader is read-only. No editing, runtime Git sync,
   database, or mutable domain application lives in the reader.

6. **Retain a stateless static runtime.** The final image remains static files
   behind minimal nginx, with no database, writable volume, runtime Git, or
   content API. Interactive domain applications remain separate projects and
   link to the reader as normal configured links.

## Consequences

Positive:

- Staging no longer carries Quartz-specific configuration mutation, so the
  tracked `quartz.config.yaml` stays generic and public-safe.
- The reader can use area and folder navigation with filters instead of flat
  type lists, and can ship separate PWA identities per projection.
- Publication security properties (validation, isolation, atomic staging,
  byte preservation, synthetic landing) are preserved and covered by focused
  contract tests.

Negative:

- Quartz remains vendored until both projections pass production verification
  and Phase 7 removes it. During the transition the Quartz build uses generic
  placeholders rather than per-site identity.
- The reader, search index, PWA, and deployment migration are still to be
  built (Phases 1–6 in the replacement plan).

## Links

- ADR-0001: dedicated publisher with opt-in projections (retained except
  Decision 4).
- Replacement plan and phased exit criteria: knowledge-reader handoff.
