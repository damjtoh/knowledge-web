import type { OxlintConfig } from "oxlint/config"

const config: OxlintConfig = {
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".windsurf/**",
    ".playwright-cli/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    "@shadcn/lint",
  ],
  rules: {
    "oxc/no-accumulating-spread": "error",
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
  overrides: [
    {
      files: ["reader/**"],
      rules: {
        // Component hook classes below are project CSS/JS selectors, not
        // Tailwind restyles: each contract names the single component that
        // may carry its hook class, so nothing else can reuse them.
        "shadcn/no-restyle": [
          "error",
          {
            contracts: [
              // Touch-target styling must live on the trigger button itself;
              // a wrapper would break focus and the 44px touch target.
              { pattern: "^CollapsibleTrigger$", allow: ["reader-tree-toggle"] },
              // Branch hook carries only min-width containment; moving it to
              // the parent <li> would break the browser-test selector
              // li > .reader-tree-collapsible > .reader-tree-panel.
              { pattern: "^Collapsible$", allow: ["reader-tree-collapsible"] },
              // Panel hook is a DOM selector only (no CSS declared); it must
              // stay on the collapsible content element.
              { pattern: "^CollapsibleContent$", allow: ["reader-tree-panel"] },
              // Width must stay on the dialog popup: Dialog renders no
              // wrapper DOM, so there is no parent element to move it to.
              { pattern: "^DialogContent$", allow: ["sm:max-w-lg"] },
              // Touch-target sizing must live on the button itself, same as
              // the tree toggle above. Offline actions share the same
              // 44px target and the browser journeys query them by hook
              // class; a wrapper would break activation and selectors.
              {
                pattern: "^Button$",
                allow: [
                  "reader-appearance-option",
                  "reader-offline-save",
                  "reader-offline-retry",
                  "reader-offline-reload",
                  "reader-offline-remove",
                  "flex-1",
                  "rounded-full",
                  "px-2.5",
                  "py-1.5",
                  "gap-1.5",
                ],
              },
              // Registry sidebar-11 tree hooks: published root order and
              // active cues must stay on the menu elements the browser
              // journeys query; wrappers would break
              // .reader-sidebar-nav > ul > li and active selectors.
              {
                pattern: "^SidebarMenu$",
                allow: ["reader-tree", "reader-projection-switcher", "gap-1"],
              },
              // Published tree children indent and guide must stay on the
              // menu sub itself; a wrapper would break the
              // li > .reader-tree-collapsible > .reader-tree-panel selector.
              {
                pattern: "^SidebarMenuSub$",
                allow: [
                  "reader-tree-children",
                  "gap-0.5",
                  "border-l",
                  "border-border",
                  "py-1",
                  "pl-2.5",
                ],
              },
              // Published section label owns its muted 11px/600/0.6px
              // tracking; the group owns layout padding.
              {
                pattern: "^SidebarGroupLabel$",
                allow: ["text-2xs", "font-semibold", "tracking-label", "text-muted-foreground"],
              },
              // Search and active hooks must live on the menu button itself;
              // a wrapper would break focus return and the 44px touch target.
              // The tree selected wash lives on the button with the active
              // hook so folder and note rows share one active-row element.
              {
                pattern: "^SidebarMenuButton$",
                allow: [
                  "reader-search-trigger",
                  "reader-search-sidebar",
                  "reader-sidebar-home",
                  "reader-projection-trigger",
                  "is-active",
                  "rounded-md",
                  "px-2.5",
                  "py-2",
                  "gap-2",
                  "bg-border",
                ],
              },
              // Desktop top chrome owns its header spacing from design.pen:
              // the header keeps the switcher-to-menu gap and padding, and
              // the Home/Search menu keeps its vertical gap.
              { pattern: "^SidebarHeader$", allow: ["gap-3", "px-3", "py-4"] },
              // Search kbd pill aligns to the row end; the Kbd primitive
              // owns its own surface.
              { pattern: "^Kbd$", allow: ["ml-auto"] },
              // Projection switcher trigger owns its hook through the
              // dropdown trigger render composition; the menu button has
              // no other wrapper that can own it.
              { pattern: "^DropdownMenuTrigger$", allow: ["reader-projection-trigger"] },
              // Projection menu width must stay on the dropdown popup: the
              // menu renders in a portal with no wrapper DOM.
              { pattern: "^DropdownMenuContent$", allow: ["reader-projection-menu"] },
              // Projection choices carry only readable long-name wrapping;
              // the DropdownMenu primitive owns the menu surface and the
              // anchors must stay on the menu items.
              {
                pattern: "^DropdownMenuItem$",
                allow: ["reader-projection-current", "reader-projection-choice"],
              },
              // Registry shell layout: trigger owns the design inset-header
              // treatment (bordered 28px square) plus its sample offset and
              // mobile visibility; the header has no wrapper that can own
              // them without breaking the sample header row.
              {
                pattern: "^SidebarTrigger$",
                allow: [
                  "-ml-1",
                  "max-md:hidden",
                  "size-7",
                  "rounded-md",
                  "border",
                  "border-border",
                  "bg-card",
                ],
              },
              // Separator spacing, responsive visibility, and design
              // 1x16 size must stay on the separator; it renders no
              // wrapper DOM.
              {
                pattern: "^Separator$",
                allow: ["mr-2", "hidden", "md:block", "w-px", "h-4"],
              },
              // Reading-header trail keeps 13px/600 crumbs on the link
              // and current-page elements; the Breadcrumb primitives own
              // landmarks and aria, so utilities stay on the items.
              {
                pattern: "^BreadcrumbLink$",
                allow: ["text-13", "font-semibold"],
              },
              {
                pattern: "^BreadcrumbPage$",
                allow: ["text-13", "font-semibold"],
              },
              // Phone drawer dimensions must stay on the Sheet popup: Sheet
              // renders no wrapper DOM, so full-viewport width/height and
              // safe-area containment cannot move to a parent.
              { pattern: "^SheetContent$", allow: ["reader-phone-drawer"] },
              // Home root cards use the registry Card surface (not a
              // hand-written CSS card). Hook classes carry only readable
              // long-title wrapping and folder/note meta layout; the Card
              // primitive owns the surface and there is no wrapper that can
              // own them without breaking the card composition.
              { pattern: "^Card$", allow: ["reader-home-card"] },
              { pattern: "^CardHeader$", allow: ["reader-home-card-header"] },
              { pattern: "^CardTitle$", allow: ["reader-home-card-title"] },
              { pattern: "^CardDescription$", allow: ["reader-home-card-meta"] },
              // Visible Close touch target must live on the Sheet close
              // button itself; a wrapper would break focus return and the
              // 44px touch target.
              { pattern: "^SheetClose$", allow: ["reader-drawer-close"] },
              // Sidebar and drawer footers own offline plus appearance
              // layout (border, scroll cap, safe-area reachability). The
              // registry Footer elements render no wrapper DOM, so the
              // hook must stay on the footer itself; a parent would scope
              // the wrong element and break the fixed-footer/tree-scroll
              // split. Design footer stack adds a top border with padded
              // gaps; the divider between On Device and Appearance is the
              // registry Separator with no wrapper.
              {
                pattern: "^SidebarFooter$",
                allow: ["reader-sidebar-footer", "gap-4", "border-t", "p-4"],
              },
              {
                pattern: "^SheetFooter$",
                allow: ["reader-phone-drawer-footer", "gap-4", "border-t", "p-4"],
              },
              // Appearance segmented control owns its muted pill container;
              // the ToggleGroup primitive renders no wrapper DOM, so the
              // pill utilities must stay on the group itself.
              {
                pattern: "^ToggleGroup$",
                allow: ["bg-muted", "rounded-full", "p-0.5", "gap-0.5", "w-full"],
              },
              // Appearance options keep the DOM hook for touch sizing plus
              // the pill option layout; the toggle primitive renders the
              // button itself, so flex and active-state utilities must stay
              // on the item. Active state uses aria-pressed variants; the
              // readable names live in screen-reader labels.
              {
                pattern: "^ToggleGroupItem$",
                allow: [
                  "reader-appearance-option",
                  "flex-1",
                  "rounded-full",
                  "border",
                  "border-transparent",
                  "p-1.5",
                  "justify-center",
                  "text-muted-foreground",
                  "aria-pressed:bg-card",
                  "aria-pressed:border-border",
                  "aria-pressed:text-primary",
                ],
              },
            ],
          },
        ],
        "shadcn/no-raw-colors": "error",
        "shadcn/no-arbitrary-values": "error",
        "shadcn/no-inline-styles": "error",
        // Hook classes with no declared CSS, kept as DOM/test selectors:
        // allow-listed by exact name so no other unknown class passes.
        "shadcn/no-unknown-classes": [
          "error",
          {
            allow: [
              "reader-tree-panel",
              "reader-offline-remove-error",
              "reader-tree-label",
              "reader-sidebar-home",
              "reader-sidebar-brand",
            ],
          },
        ],
        "shadcn/require-static-classes": "error",
      },
    },
    // Design-system source: Button/Dialog own their internal values (the
    // upstream README documents exempting the component directory this way).
    {
      files: ["reader/components/ui/**"],
      rules: {
        "shadcn/no-restyle": "off",
        "shadcn/no-raw-colors": "off",
        "shadcn/no-arbitrary-values": "off",
        "shadcn/no-inline-styles": "off",
        "shadcn/no-unknown-classes": "off",
        "shadcn/require-static-classes": "off",
      },
    },
  ],
}

export default config
