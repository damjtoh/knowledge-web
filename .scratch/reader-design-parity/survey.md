# Reader design survey + gap matrix

Source: `design.pen`, walked per subtree (whole-document visitor broken in MCP sandbox; roots enumerated via `get_app_state`).
Date: 2026-09-27. Base: `main` d0d5ff8, branch `feat/reader-parity`.

## Top-level frames

| Frame                               | Contents                                                               |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `cFIGC` 01 Screens Reader           | 7 screens (below)                                                      |
| `wPn82` 02 Screens Supporting       | Landing `e4vTh`, Label, Hover Demo `SOaCY` — out of reader scope       |
| `Mo0va` 03 Components Reader Chrome | Sidebar, rows, phone header, footer variants, device chips             |
| `twore` 04 Components Article Vault | Other notes, cards, meta line, quote, callout, bullet, tag, search row |
| `emmfP` 05 Design System shadcn     | Design-side shadcn reference (`uURJa`)                                 |

## Screens

| Screen                           | ID       | Disposition                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Homepage (Desktop) 1440          | `pG2dv`  | Ported (PR #16/#17/#18). Header `[trigger, sep, crumbs] / [search]` confirmed matching. Article extras (meta line above title, quote/callout fidelity) → items 1, 4. Home card divergence → item 7 (new).                                                                                                                                                                             |
| Note (Desktop) 1440              | `G4YjX`  | Ported chrome. Article order: meta line ref → title → subtitle → Quote ref → body (h2/Code/Bullets/Callout/h3) → Tags → Other notes ref → Foot meta. Tags skipped by decision; meta → item 1; quote/callout → item 4.                                                                                                                                                                 |
| Homepage (Phone) 390             | `I1z3qM` | Ported (item 5 of mobile round).                                                                                                                                                                                                                                                                                                                                                      |
| Note (Phone) 390                 | `pWNyV`  | Ported (item 6); meta line + read-time pending → item 1; quote/callout → item 4.                                                                                                                                                                                                                                                                                                      |
| Sidebar Open (Phone) 390         | `h4qg4r` | Ported (registry Sheet). Drawer width registry 288px vs design ~300–320 — accepted visually.                                                                                                                                                                                                                                                                                          |
| Vault Switcher (Phone) 390       | `xPZVw`  | Ported (item 4); Add Vault row missing → item 2.                                                                                                                                                                                                                                                                                                                                      |
| **Search Dialog (Desktop) 1440** | `MnMak`  | **NOT ported to design — new item 6.** Dialog 512w, pad 16, radius 12, gap 12; header "Search" 16 + close; input pad [10,12] radius 8 w/ icon + 14px query; status 13px; results gap 4, rows pad [10,12] radius 8 gap 2 (title 14 / url 12 / excerpt 13; active wash `#f5f5f5`); keyboard hints 12px gap 8; Empty / No Results / Loading states (label 12, text 13, pad 12 radius 8). |

## Components

| Component                    | ID                               | Measured                                                                                                                                               | Code state                                                             |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Sidebar 320×800              | `LgKzZ`                          | Header (Vault Switcher → Vault Brand + swap icon; Menu → Home Row, Search Trigger), Content (NAV label, Tree), Footer (On Device, Divider, Appearance) | Ported (AppSidebar) ✓                                                  |
| Tree Row                     | `wzRNR`                          | icon 14 muted, label 13 `#171717`, spacer 12                                                                                                           | Ported ✓ (13px label confirmed in CSS)                                 |
| Note Row                     | `T3eHlR`                         | file 14 muted, label 12 muted                                                                                                                          | Audit tree note rows vs 12px muted — minor, item 4 sweep               |
| Phone Header 390×64          | `wC4F5`                          | fill `#fafafa`, stroke `#e5e5e5`; menu 16; brand 14/700; swap 14 muted; search 16                                                                      | Ported ✓                                                               |
| Footer On Device variants    | `QO1rc/iGMQn/e8clUi/reJ9b/NuASV` | Saved/Idle/Saving/Error/Offline                                                                                                                        | Ported ✓ (OfflineSave)                                                 |
| Footer Appearance            | `aspLQ`                          | Label Row + Segmented                                                                                                                                  | Ported ✓                                                               |
| Device Status chips          | `InGUO/t0kdtd/M2D2K`             | pill `#f5f5f5` radius full pad [8,12]; icon 12; label 11                                                                                               | Ported ✓ (item 3 mobile)                                               |
| Other notes                  | `e7RQaU`                         | head pad 12, title 13/600 + count pill pad [2,8]; 6 rows 36px; foot pad 12 "Show all" 13/600 + arrow 14                                                | Ported ✓ (item 6 mobile)                                               |
| Other Note Row               | `a4MmZf`                         | File 14 muted, Label 13 `#171717`, **Meta 11 muted**                                                                                                   | **Divergent: our rows lack the meta line → item 7**                    |
| Vault Card / Phone           | `YFp8Y`                          | 360×60, pad 12, radius 10, border; icon box 36 radius 10 `#f5f5f5`; texts gap 2; arrow 14                                                              | Ported ✓                                                               |
| **Vault Area Row / Desktop** | `D3O3k6`                         | 720w; **Icon Box 40 radius 10 `#f5f5f5`, icon 18**; Title 15; Desc 12 muted; Count 11 muted; Right: **Action 12 muted + Chevron 14**                   | **Divergent: desktop cards lack icon box + action + chevron → item 7** |
| Article Meta Line            | `HMIv8`                          | Tag 11 muted (`{category} • {N} min read`) + Dot 3 `#e5e5e5` + Date 11 muted                                                                           | Missing read-time/category → item 1                                    |
| Article Quote                | `Zk8lN`                          | fill `#fafafa`; Quote 13 `#171717`; Cite 11 muted (`↳ path`)                                                                                           | Item 4 compare/restyle                                                 |
| Article Callout              | `VFil6`                          | **fill `#171717` (inverted)**; Icon Wrap 32, icon 16 inverted; Title 13 `#fafafa`; Desc 11 muted                                                       | Item 4 compare/restyle                                                 |
| Article Bullet Row           | `pDRO9`                          | Dot 6 `#171717` + Text 13                                                                                                                              | Item 4 compare                                                         |
| Article Tag                  | `ifSnV`                          | pill `#f5f5f5`, label 11 muted                                                                                                                         | **Skipped by decision**                                                |
| Search Result Row            | `eQL3j`                          | Title 14 / URL 12 muted / Excerpt 13 muted; active wash                                                                                                | **Not designed-matched → item 6**                                      |

## Gap matrix → work items (amended plan)

1. **Item 1 — MetaLine + read-time heuristic** (as planned; category + read-time + date, 11px, above title both viewports).
2. **Item 2 — Vault sheet Add Vault mock row** (as planned).
3. **Item 3 — Breadcrumb family unification** (as planned; `breadcrumbs.tsx` is the registry wrapper — keep, unify derivation).
4. **Item 4 — Article extras fidelity** (Quote/Callout/Code/bullets; + Tree Note Row 12px-muted check).
5. **Item 5 — CSS consolidation** (as planned).
6. **Item 6 — Search dialog 1:1 (NEW)** — restyle `search-dialog.tsx` to `MnMak`: 512w dialog, header + close, input geometry, status line, result rows (title/url/excerpt, active wash), keyboard hints, empty/no-results/loading states. Registry `Dialog`/`Command`-style primitives preferred.
7. **Item 7 — Card + row alignments (NEW)** — desktop home cards gain icon box 40 + title 15 + count 11 + action/chevron right per `D3O3k6`; Other Note Rows gain 11px muted meta (source: note `updated_at` or excerpt — worker reports choice).
8. **Item 8 — Final sweep + merge** (as item 6 of prior plan).

Skipped by decision: Tags row (`ifSnV`), add-vault behavior (mock only, item 2), Landing screen, per-root category schema.

### Skipped by decision: Article Callout (`VFil6`, parity item 4)

No producing Markdown syntax exists for the inverted Callout, so it is skipped entirely with no dependency added. Verified empirically 2026-09-27: `> [!NOTE]` through `remark-parse` + `remark-gfm@4.0.1` + `remark-rehype` renders a plain `<blockquote>` whose first paragraph keeps the literal `[!NOTE]` text — byte-identical with and without the plugin, carrying no class or data attribute to style. Since GFM alerts yield no hook, `remark-gfm` stays a transitive-only entry (never a direct reader dependency) and no Callout CSS ships: a dependency without styling would be a half state. Revisit only if the pipeline gains an alert-producing plugin (e.g. an mdast alert transform) that emits a styleable hook.
