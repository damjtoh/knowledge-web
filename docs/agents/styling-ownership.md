# Styling ownership

Component visuals belong in Tailwind utilities in JSX. Scoped CSS in
`reader/app/globals.css` keeps only what utilities cannot own. Oxlint with
the shadcn lint stays the JSX check; no Konsistent install covers CSS.

## Approved scopes

- Theme, base, focus: `:root`, `.dark`, `@theme inline`, `@layer base`
  (`*`, `html`, `body` only), `html`/`body`, `:focus-visible` and its
  `.dark` variants.
- Generated Markdown: `.reader-article` selectors (plus
  `.dark .reader-article`) in `@layer components`, including bare
  elements (`h1`, `p`, `a`, `table`, `pre`, `blockquote`) and the layered
  `.reader-area-list` grid track. Article rules must stay layered so
  utilities win over prose.
- Library internals: `[data-slot="sidebar"]` and
  `[data-slot="sidebar-inset"]`.
- Reviewed exceptions with the reason utilities cannot cover them:
  - `.reader-projection-menu` max-width (`min()` bracket values are banned).
  - Open-row transparent wash (must beat layered SidebarMenuButton washes).
  - `.reader-search-list` cap, excerpt `mark`, `.reader-sidebar-footer`
    cap (bracket values banned or bare generated markup).
  - Layered `.reader-home-card-link`, `.reader-group-list a`, and
    `.reader-note-crumbs` overrides (win over prose by order where no
    utility targets the node).

## Rules

- Do not add a new `.reader-*` visual selector or an unlayered article
  rule. A new `.reader-header` rule fails layered or unlayered unless it
  becomes a reviewed exception.
- `pnpm run check` runs `scripts/check-css-ownership.mjs`, a PostCSS
  parse check. It reports the selector plus this ownership guidance.
- To request an exception, add the selector to the allowlist in
  `scripts/check-css-ownership.mjs` with a comment that states why
  utilities cannot cover it, and update this list.
