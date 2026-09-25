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
              // the tree toggle above.
              { pattern: "^Button$", allow: ["reader-appearance-option"] },
              // Registry sidebar-11 tree hooks: published root order and
              // active cues must stay on the menu elements the browser
              // journeys query; wrappers would break
              // .reader-sidebar-nav > ul > li and active selectors.
              { pattern: "^SidebarMenu$", allow: ["reader-tree"] },
              { pattern: "^SidebarMenuSub$", allow: ["reader-tree-children"] },
              // Search and active hooks must live on the menu button itself;
              // a wrapper would break focus return and the 44px touch target.
              {
                pattern: "^SidebarMenuButton$",
                allow: [
                  "reader-search-trigger",
                  "reader-search-sidebar",
                  "reader-sidebar-home",
                  "is-active",
                ],
              },
              // Registry shell layout: trigger offset and mobile visibility
              // must stay on the trigger itself; the header has no wrapper
              // that can own them without breaking the sample header row.
              { pattern: "^SidebarTrigger$", allow: ["-ml-1", "max-md:hidden"] },
              // Separator spacing and responsive visibility must stay on the
              // separator; it renders no wrapper DOM.
              { pattern: "^Separator$", allow: ["mr-2", "hidden", "md:block"] },
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
