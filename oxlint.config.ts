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
          { allow: ["reader-tree-panel", "reader-offline-remove-error"] },
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
