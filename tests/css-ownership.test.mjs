/**
 * CSS styling ownership guardrail regression test.
 *
 * Guards the styling ownership boundary in one unit over two inputs:
 * approved scopes pass (layered article Markdown, focus, and a documented
 * sizing exception) while a new .reader-header visual fails layered or
 * unlayered with ownership guidance.
 */

import assert from "node:assert/strict"
import { test } from "node:test"
import { checkCssOwnership } from "../scripts/check-css-ownership.mjs"

const APPROVED = [
  "@layer components {",
  "  .reader-article { max-width: 68ch; }",
  "  .reader-article h1 { font-size: 1.75rem; }",
  "  .reader-article .reader-group-list a:hover { color: var(--foreground); }",
  "  .reader-area-list { grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr)); }",
  "}",
  ":focus-visible { outline: 2px solid #171717; }",
  ".reader-search-list { max-height: min(50vh, 24rem); }",
  "",
].join("\n")

const REJECTED = [
  ".reader-header { display: flex; }",
  "@layer components {",
  "  .reader-header { display: flex; }",
  "  .reader-article .reader-header { color: red; }",
  "  .reader-article .foo { color: red; }",
  "}",
  "",
].join("\n")

test("css ownership allows approved scopes and rejects reader-header visuals", () => {
  assert.deepEqual(checkCssOwnership(APPROVED), [])

  const violations = checkCssOwnership(REJECTED)
  assert.equal(violations.length, 4)
  assert.ok(
    violations.some((violation) => violation.selector === ".reader-header"),
    "unlayered and layered header visuals must fail",
  )
  assert.ok(
    violations.some((violation) => violation.selector === ".reader-article .reader-header"),
    "header hooks nested under article scope must fail",
  )
  assert.ok(
    violations.some((violation) => violation.selector === ".reader-article .foo"),
    "new classes nested under article scope must fail",
  )
  assert.ok(
    violations.every((violation) => violation.message.includes("docs/agents/styling-ownership.md")),
    "failures must point at the ownership policy",
  )
})
