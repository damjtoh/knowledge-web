#!/usr/bin/env node
/**
 * CSS styling ownership guardrail for reader/app/globals.css.
 *
 * Component visuals belong in Tailwind utilities in JSX. Scoped CSS keeps
 * only theme tokens, base, focus, generated bare Markdown, library internals,
 * and documented sizing exceptions. The check parses with PostCSS (not regex
 * text scanning) and rejects new component selectors plus any unlayered
 * article rules with actionable ownership guidance.
 *
 * Usage:
 *   node scripts/check-css-ownership.mjs [css-file]
 *
 * See docs/agents/styling-ownership.md for the ownership scopes.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import postcss from "postcss"

const PUBLISHER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

const DEFAULT_CSS_FILE = path.join(PUBLISHER_ROOT, "reader", "app", "globals.css")

const OWNERSHIP_DOC = "docs/agents/styling-ownership.md"

const GUIDANCE =
  `Component visuals belong in Tailwind utilities in JSX. ` +
  `Scoped CSS is allowed only for theme/base/focus, generated Markdown ` +
  `(.reader-article in @layer components), library internals ([data-slot]), ` +
  `and documented exceptions. See ${OWNERSHIP_DOC}. ` +
  `To add a reviewed exception, update the allowlist in ` +
  `scripts/check-css-ownership.mjs with justification.`

// Unlayered documented exceptions: each entry is one comma-part after
// whitespace normalization. Every entry names CSS that cannot move to
// utilities (bracket values banned or layered-wash ordering).
const UNLAYERED_EXCEPTIONS = new Set([
  ".reader-projection-menu",
  ".reader-sidebar-nav .reader-tree-row.reader-tree-open a",
  ".reader-sidebar-nav .reader-tree-row.reader-tree-open a:hover",
  ".reader-search-list",
  ".reader-search-result-excerpt mark",
  ".dark .reader-search-result-excerpt mark",
  ".reader-sidebar-footer",
])

const UNLAYERED_GLOBALS = new Set([
  "html",
  "body",
  ":root",
  ".dark",
  ".dark body",
  ":focus-visible",
  ".dark :focus-visible",
])

const BASE_ALLOWED = new Set(["*", "html", "body"])

// Reviewed class hooks allowed inside @layer components. Every layered
// rule must stay in article scope and use only these classes; any new
// class (including .reader-header nested under .reader-article) fails.
const ALLOWED_COMPONENT_CLASSES = new Set([
  "dark",
  "reader-area-list",
  "reader-article",
  "reader-group-list",
  "reader-home-card-link",
  "reader-home-cards",
  "reader-note-crumbs",
])

function normalizePart(part) {
  return part.replace(/\s+/g, " ").trim()
}

function startsWithScope(part, scope) {
  if (part === scope) return true

  if (!part.startsWith(scope)) return false

  const next = part[scope.length]

  return next === " " || next === ":" || next === "." || next === "[" || next === "#"
}

function isComponentsAllowed(part) {
  if (part === ".reader-area-list") return true

  if (startsWithScope(part, ".reader-article")) return true

  if (startsWithScope(part, ".dark .reader-article")) return true

  return false
}

function isLibraryInternal(part) {
  return /^\[data-slot="[^"]+"\]$/u.test(part)
}

// Class names in a selector part. The leading character excludes digits
// so decimal values and function arguments never match as classes.
function extractClasses(part) {
  const names = []

  for (const match of part.matchAll(/\.(-?[_a-zA-Z]+[_a-zA-Z0-9-]*)/gu)) names.push(match[1])

  return names
}

function checkRuleParts(parts, layer) {
  const violations = []

  for (const raw of parts) {
    const part = normalizePart(raw)

    if (layer === "base") {
      if (!BASE_ALLOWED.has(part)) {
        violations.push({
          selector: part,
          layer,
          message:
            `CSS ownership rejection: selector "${part}" in @layer base is outside the ` +
            `approved base scope (*, html, body). ${GUIDANCE}`,
        })
      }

      continue
    }

    if (layer === "components") {
      if (!isComponentsAllowed(part)) {
        violations.push({
          selector: part,
          layer,
          message:
            `CSS ownership rejection: selector "${part}" in @layer components is outside ` +
            `the approved article scope (.reader-article and .reader-area-list only). ${GUIDANCE}`,
        })
      } else {
        const unreviewed = extractClasses(part).filter(
          (name) => !ALLOWED_COMPONENT_CLASSES.has(name),
        )

        if (unreviewed.length > 0) {
          violations.push({
            selector: part,
            layer,
            message:
              `CSS ownership rejection: selector "${part}" uses unreviewed class ` +
              `".${unreviewed[0]}" in @layer components; only reviewed article hooks are ` +
              `allowed. ${GUIDANCE}`,
          })
        }
      }

      continue
    }

    // Unlayered.
    if (UNLAYERED_GLOBALS.has(part) || isLibraryInternal(part)) continue

    if (UNLAYERED_EXCEPTIONS.has(part)) continue

    if (part.includes(".reader-article") || part.includes(".reader-area-list")) {
      violations.push({
        selector: part,
        layer,
        message:
          `CSS ownership rejection: article selector "${part}" must live in ` +
          `@layer components so utilities keep winning over prose. ${GUIDANCE}`,
      })
      continue
    }

    violations.push({
      selector: part,
      layer,
      message:
        `CSS ownership rejection: selector "${part}" is outside the approved unlayered ` +
        `scopes (theme/base/focus, library internals, documented exceptions). ${GUIDANCE}`,
    })
  }

  return violations
}

function checkAtRule(node, violations) {
  const name = node.name
  const params = (node.params ?? "").trim()

  if (name === "layer") {
    const layerName = params.split(/[,\s]/u)[0]

    if (layerName !== "base" && layerName !== "components") {
      violations.push({
        selector: `@layer ${params}`,
        layer: null,
        message:
          `CSS ownership rejection: @layer "${params}" is outside the approved layers ` +
          `(base, components). ${GUIDANCE}`,
      })
    }

    return "recurse-layer"
  }

  if (name === "utility") {
    const utilityName = params.split(/[\s(,]/u)[0]

    if (utilityName !== "tracking-label") {
      violations.push({
        selector: `@utility ${params}`,
        layer: null,
        message: `CSS ownership rejection: @utility "${utilityName}" is not a reviewed exception. ${GUIDANCE}`,
      })
    }

    return "skip"
  }

  if (name === "theme") {
    if (params !== "inline") {
      violations.push({
        selector: `@theme ${params}`,
        layer: null,
        message: `CSS ownership rejection: @theme "${params}" is not a reviewed exception. ${GUIDANCE}`,
      })
    }

    return "skip"
  }

  if (name === "custom-variant") {
    if (!params.startsWith("dark")) {
      violations.push({
        selector: `@custom-variant ${params}`,
        layer: null,
        message: `CSS ownership rejection: @custom-variant "${params}" is not a reviewed exception. ${GUIDANCE}`,
      })
    }

    return "skip"
  }

  if (name === "import") return "skip"

  if (name === "media" || name === "supports" || name === "container") return "recurse-keep"

  if (name === "apply" || name === "tailwind" || name === "reference" || name === "source") {
    return "skip"
  }

  return node.nodes && node.nodes.length > 0 ? "recurse-keep" : "skip"
}

/**
 * Check a CSS string with a real PostCSS parse. Returns an array of
 * violations ({ selector, layer, message }); an empty array means pass.
 */
export function checkCssOwnership(cssText) {
  let root

  try {
    root = postcss.parse(cssText)
  } catch (error) {
    return [
      {
        selector: "",
        layer: null,
        message: `CSS ownership rejection: globals.css does not parse (${error.message}). ${GUIDANCE}`,
      },
    ]
  }

  const violations = []

  function visit(node, layers) {
    for (const child of node.nodes ?? []) {
      if (child.type === "atrule") {
        const action = checkAtRule(child, violations)

        if (action === "recurse-layer") {
          const layerName = (child.params ?? "").trim().split(/[,\s]/u)[0]
          visit(child, [...layers, layerName])
        } else if (action === "recurse-keep") {
          visit(child, layers)
        }
      } else if (child.type === "rule") {
        const layer = layers.length > 0 ? layers[layers.length - 1] : null
        const parts = postcss.list.comma(child.selector ?? "")
        violations.push(...checkRuleParts(parts, layer))

        // Recurse only when a rule nests further rules (not the common case).
        if ((child.nodes ?? []).some((n) => n.type === "rule" || n.type === "atrule")) {
          visit(child, layers)
        }
      }
    }
  }

  visit(root, [])

  return violations
}

function main() {
  const cssFile = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CSS_FILE
  const cssText = fs.readFileSync(cssFile, "utf8")
  const violations = checkCssOwnership(cssText)

  if (violations.length === 0) return

  const rel = path.relative(process.cwd(), cssFile) || cssFile
  console.error(`✗ CSS ownership check failed for ${rel}:`)

  for (const violation of violations) console.error(`  - ${violation.message}`)

  process.exit(1)
}

const invokedAsScript =
  process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedAsScript) main()
