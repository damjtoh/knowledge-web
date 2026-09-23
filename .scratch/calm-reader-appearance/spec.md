# Calm reader appearance and theme

Status: ready-for-agent

## Problem Statement

The Web Projection works as a static knowledge reader, but its plain gray styling
feels dated. Reading and browsing should feel calm on desktop and phone. Readers
also need a light and dark appearance they can control. The Shared Knowledge Base
shows examples such as `[[Pets]]` as literal code; this has raised doubt about
whether actual wikilinks work.

## Solution

Give the generic reader a restrained grayscale reading interface using Tailwind
CSS and selected shadcn/ui components. Support Light, Dark, and System appearance:
follow the device by default, provide a visible control, and remember an explicit
choice. Preserve the static export and the same staged-content publication
boundary.

Keep backticked wikilink examples literal. Verify that a bare wikilink to an
allowlisted authored folder index resolves to its folder route in the exported
page. Fix reader link handling only if this verification finds a failure.

## User Stories

1. As a reader, I want a calm grayscale page, so that the content holds my attention.
2. As a reader, I want a comfortable reading width, so that long notes are easy to follow.
3. As a reader, I want clear headings and body text, so that I can scan a note and then read it.
4. As a reader, I want links to look like links, so that I can find related knowledge without guessing.
5. As a reader, I want distinct navigation and reading areas, so that I can tell where I am.
6. As a reader, I want the active page to remain clear, so that I do not lose my place.
7. As a reader, I want subdued borders and surfaces, so that the interface does not compete with the note.
8. As a reader, I want the reader to follow my device appearance by default, so that it fits my environment.
9. As a reader, I want to select Light, Dark, or System, so that I control the appearance.
10. As a returning reader, I want my explicit appearance choice remembered, so that I do not repeat it on every visit.
11. As a reader using System, I want the reader to follow device theme changes, so that the setting remains meaningful.
12. As a reader in either appearance, I want readable text, links, code, and navigation states, so that I can use the whole reader.
13. As a phone reader, I want the note to remain primary, so that navigation does not crowd the screen.
14. As a phone reader, I want Browse to remain easy to open and close, so that I can move through folders.
15. As a keyboard reader, I want visible focus and usable appearance and Browse controls, so that I can navigate without a pointer.
16. As a reader, I want wide tables, code, and images contained, so that they do not create page-level horizontal scrolling.
17. As a reader, I want a bare `[[Pets]]`-style link to open the published folder page, so that authored relationships work in the Web Projection.
18. As a reader, I want a backticked `[[Pets]]` example to remain literal, so that documentation shows the exact syntax.
19. As a reader, I want missing or unselected wikilink targets to stay unresolved, so that a link never exposes content outside the Allowlist.
20. As a reader, I want direct nested URLs and refreshed pages to work, so that bookmarks remain useful.
21. As a Knowledge Base owner, I want the same reader appearance for any Publication Manifest, so that I do not maintain per-Knowledge-Base themes.
22. As a Knowledge Web Publisher maintainer, I want the Web Projection to remain a static export, so that deployment needs no application server.

## Implementation Decisions

- Use Tailwind CSS for reader styles and introduce only the shadcn/ui components
  needed for the appearance control and existing reader controls. Do not replace
  the headless Markdown source or the reader's navigation model.
- Use a restrained grayscale palette with light and dark surfaces. Apply it to
  the page shell, navigation, article typography, links, code, tables, borders,
  hover states, active states, and keyboard focus. Keep the existing responsive
  reading hierarchy, usable touch targets, and overflow containment.
- Provide Light, Dark, and System modes. System is the initial state when no
  preference is saved. Save an explicit choice locally in the browser; System
  follows device changes. The control must have an accessible name and state.
- Keep the reader generic: no Knowledge Base name, subject, route, or theme
  exception in production styling or controls. Site identity continues to come
  from generated metadata.
- Keep publication unchanged. The reader consumes only staged Markdown and
  generated metadata; the Publication Manifest and Allowlist remain the
  publication authority. The runtime stays a static export.
- The maintained wikilink plugin and staged-content alias map continue to own
  body-link resolution. A bare title alias for an authored folder index resolves
  to its folder route. Inline code and frontmatter relationships remain literal
  or metadata, respectively. Do not rewrite Knowledge Base documentation to
  make instructional examples clickable.
- Keep the current browser navigation and history behavior when replacing
  controls. Preserve keyboard operation and focus visibility.

## Testing Decisions

- Test observable exported behavior, not Tailwind classes, shadcn internals,
  component structure, or snapshots of the stylesheet.
- Use the existing synthetic static-export test seam to assert that a bare
  title wikilink to an authored folder index exports as an internal link to
  that folder, while the backticked form stays literal. Keep the existing
  unresolved-link and Allowlist checks.
- Use existing reader build and browser checks as appropriate to catch broken
  navigation or static output. Do not add new automated theme tests or expand
  the CI browser matrix for the appearance control; the extra CI time is not
  justified for this change.
- Check light and dark appearance, System behavior, saved preference, desktop,
  and phone manually during implementation.

## Out of Scope

- Editing Knowledge Base notes or changing the meaning of backticked examples.
- A custom wikilink parser, frontmatter relationship rendering, search, PWA,
  binary attachment delivery, or deployment migration.
- Per-Knowledge-Base branding, accent colors, or theme configuration.
- New automated visual or theme-persistence tests.

## Further Notes

- Accepted reader decisions in ADR-0002 and ADR-0003 still apply, especially
  static output, generic navigation, and staged-only inputs.
- Existing synthetic static-export tests already cover title, filename, path,
  alias, unresolved, and code-literal wikilinks. This spec narrows the new link
  check to the authored folder-index case reported during local preview.
- The local preview previously required absolute reader input paths to avoid
  a bundled default-path resolution error. That build-path issue is separate
  from this visual and wikilink scope.
