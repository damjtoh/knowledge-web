# Styling ownership

Component visuals belong in Tailwind utilities in JSX. Scoped CSS in
`reader/app/globals.css` keeps only what utilities cannot own, plus the
official Typeset prose file at `reader/app/typeset.css`. Oxlint with
the shadcn lint stays the JSX check; no Konsistent install covers CSS.

## Approved scopes

- Theme, base, focus: `:root`, `.dark`, `@theme inline`, `@layer base`
  (`*`, `html`, `body` only), `html`/`body`, `:focus-visible` and its
  `.dark` variants.
- Generated Markdown: `.typeset` selectors (plus nested `&` inside them)
  in `@layer components` in `reader/app/typeset.css` only, using the
  official default Typeset stylesheet and app theme tokens. No bare
  element rules (`h1`, `p`, `a`, `table`, `pre`, `blockquote`) live in
  `globals.css`; Typeset styles those via `:where()` so utilities win.
  Authored Markdown bodies render inside `<div className="typeset">`;
  synthetic home and virtual folder React content stays outside it.
- Reading-column layout: `.reader-article` measure plus containment
  (`max-width`, `min-width`, `overflow-wrap`) and the layered
  `.reader-area-list` grid track in `@layer components` in `globals.css`.
  Layout rules must stay layered so utilities win over prose.
- Bounded Typeset table exception: phone-only (`max-width: 767px`)
  `display: block` plus `overflow-x: auto` on bare `table` in
  `reader/app/typeset.css`. Official defaults keep real tables with
  `max-width: 100%`, but nowrap header cells still overflow a 390px phone;
  the exception keeps the `<table>` element and token styling while making
  it locally scrollable so the integrated overflow probe stays contained.
- Library internals: `[data-slot="sidebar"]` and
  `[data-slot="sidebar-inset"]`.
- Reviewed exceptions with the reason utilities cannot cover them:
  - `.reader-projection-menu` max-width (`min()` bracket values are banned).
  - Open-row transparent wash (must beat layered SidebarMenuButton washes).
  - `.reader-search-list` cap, excerpt `mark`, `.reader-sidebar-footer`
    cap (bracket values banned or bare generated markup).
  - Layered `.reader-home-card-link`, `.reader-group-list a`, and
    `.reader-note-crumbs` hooks outside the inner `typeset` scope (plain
    reads where no utility targets the node; visited stays muted and the
    wash stays transparent).

## Rules

- Do not add a new `.reader-*` visual selector, a `.typeset` rule in
  `globals.css`, or a `.reader-*` rule in `typeset.css`. A new
  `.reader-header` rule fails layered or unlayered unless it becomes a
  reviewed exception; a `.typeset` rule outside `typeset.css` fails, and a
  `.reader-header` rule inside `typeset.css` fails.
- `pnpm run check` runs `scripts/check-css-ownership.mjs`, a PostCSS
  parse check over both `globals.css` and `typeset.css`. It reports the
  selector plus this ownership guidance.
- To request an exception, add the selector to the allowlist in
  `scripts/check-css-ownership.mjs` with a comment that states why
  utilities cannot cover it, and update this list.
