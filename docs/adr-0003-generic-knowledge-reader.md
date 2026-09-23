# ADR-0003 — Generic knowledge reader with manifest navigation

- Status: Accepted
- Date: 2026-09-22
- Deciders: Knowledge Web Publisher (Plan 001)
- Context: this decision generalizes the reader defined in ADR-0002 so one
  static build serves every Knowledge Base.

## Context

ADR-0001 makes the Allowlist the publication authority. ADR-0002 retains that
authority, isolated staging, canonical Markdown and Git, and a stateless
static runtime, and replaces Quartz with a custom static knowledge reader.

The first reader implementation instead carries Shared-specific production
rules: fixed area slugs, a special Travel hierarchy, a Shared-specific home,
and tests tied to one Knowledge Vault. It cannot provide correct home and
folder navigation for Knowledge Bases whose selected directories have no
`index.md`, or whose visible navigation differs from `select` order.

The Publisher must build the same static reader for Shared, Damian, Mica,
and future Knowledge Bases without a vault name, route, title, or subject
in production code.

## Decision

1. **The Allowlist remains the publication authority.** Only Publication
   Manifest `select` entries enter staging, the page model, search, and the
   final image. Navigation never exposes unselected content.

2. **The Publication Manifest gains an optional ordered `navigation` list.**
   Each entry names one allowlisted Markdown file or one allowlisted
   directory with at least one Markdown page. Vault owners add `navigation`
   only when `select` and visible navigation differ. Existing manifests
   without `navigation` stay valid. See the
   [manifest contract](manifest.md).

3. **When `navigation` is absent, staging derives roots from `select` in
   manifest order.** Derivation keeps Markdown files and directories
   containing Markdown pages, and ignores selections with no Markdown pages.
   Asset-only selections therefore never become navigation roots.

4. **`navigation` controls presentation only.** It selects the visible root
   order and subset. It cannot broaden `select`, publish an unselected path,
   or admit a non-Markdown page.

5. **Staging emits resolved navigation roots in generated public-safe
   metadata.** Staging validates `navigation` against the staged tree before
   the atomic swap, then writes the ordered `navigation` list into
   `site-identity.json` outside the staged content tree. The file carries
   relative public paths only, with stable key order
   (`title`, `canonicalHostname`, `navigation`) and manifest navigation
   order. It never carries a Knowledge Base root, an absolute path, a
   manifest path, or an unselected path. The reader build consumes staged
   content plus this generated file. The reader never reads the original
   Knowledge Base or Publication Manifest.

6. **A selected directory does not need an authored `index.md`.** The reader
   serves one virtual static folder page for every staged folder containing
   Markdown pages. A virtual page supplies a humanized title and child
   navigation. Root order follows generated metadata. Child nodes sort by
   authored title, then stable route. Every folder page uses the same
   generic direct-note and child-folder groups. No Knowledge Vault and no
   subject receives a special case.

7. **An authored `index.md` owns its folder route and introduction.** When
   the staged folder has an `index.md`, the reader renders it verbatim as
   the folder page. A virtual page exists only where no authored index
   exists.

8. **The reader stays a static export.** No database, runtime Git, writable
   content, content API, or application server. Virtual folder routes are
   static routes known at build time. Reader production code reads staged
   content through `READER_CONTENT_DIR` and generated metadata through
   `READER_SITE_METADATA_FILE`. Test harnesses may use
   `KNOWLEDGE_BASE_ROOT`; reader production code does not.

9. **Non-Markdown files remain excluded from page discovery.** Staging still
   copies allowlisted non-Markdown files byte-for-byte, but they never
   become pages, navigation nodes, or group entries. Binary attachment
   delivery is deferred to a follow-up plan and is outside this decision.

10. **Shared reader tests were tracer-bullet evidence, not production
    rules.** The Shared-specific assertions and fixtures proved the first
    vertical slice. They do not define the generic contract. The generic
    contract is this ADR plus the manifest contract plus the navigation
    module interface. Later steps rename the Shared-named tests and replace
    their subject-specific expectations with neutral synthetic fixtures.

## Consequences

Positive:

- One Publisher commit builds the same Web Projection shape for every
  Knowledge Base.
- Content repositories keep publication control through `select` and gain
  presentation control through optional `navigation`, without reorganizing
  canonical content for a disposable Web Projection.
- Generated metadata keeps navigation deterministic, reviewable, and
  public-safe.

Negative:

- Staging owns more validation: duplicate, uncovered, unsafe, missing, and
  Markdown-less navigation entries fail the build before partial output.
- The reader owns virtual routes, so static parameters and group rendering
  must stay generic.

Risks and mitigations:

- A malformed `navigation` list could suggest broader publication —
  mitigated by validation that rejects every entry not covered by `select`
  before the atomic swap.
- A vault-specific exception could reappear as a convenience — mitigated by
  rejecting any vault name, route, title, or subject in production code
  during review.

## Links

- ADR-0001: dedicated publisher with opt-in projections and explicit
  allowlists (retained).
- ADR-0002: custom static knowledge reader, isolated staging, and generated
  metadata (retained and extended by this decision).
- Manifest contract: optional `navigation` validation, default derivation,
  and generated JSON (see `manifest.md`).
- Plan 001: generalize the reader for every Knowledge Base.
