/**
 * Item 02 focused adapter contract.
 *
 * Pure coverage for the small repository alias adapter plus the maintained
 * plugin boundary: title priority, route derivation, deterministic alias
 * resolution, ambiguity failure, unresolved rendering, code literals, and
 * frontmatter preservation. No vault or production build required.
 *
 * Run with: npm test -- tests/wiki-aliases.test.mjs
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, after } from "node:test"
import { unified } from "unified"
import remarkParse from "remark-parse"
import wikiLinkPlugin from "@flowershow/remark-wiki-link"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import {
  routeForSourcePath,
  titleForContent,
  buildWikiLinkMaps,
} from "../reader/lib/wiki-aliases.ts"

const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")

const tmpRoots = []

after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-alias-${prefix}-`))
  tmpRoots.push(dir)

  return dir
}

function writeTree(root, entries) {
  for (const [rel, content] of Object.entries(entries)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
}

async function renderBody(maps, markdown) {
  const processor = unified()
    .use(remarkParse)
    .use(wikiLinkPlugin, { format: "regular", files: maps.files, permalinks: maps.permalinks })
    .use(remarkRehype)

  const stringifier = unified().use(rehypeStringify)
  const hast = await processor.run(processor.parse(markdown))

  return String(stringifier.stringify(hast))
}

test("title priority is frontmatter, then first H1, then filename", () => {
  assert.equal(
    titleForContent('---\ntitle: "Authored"\n---\n\n# Ignored\n', "fallback"),
    "Authored",
  )
  assert.equal(titleForContent('---\ntitle: ""\n---\n\n# Real H1\n', "fallback"), "Real H1")
  assert.equal(titleForContent('---\ntitle: "   "\n---\n\n# Real H1\n', "fallback"), "Real H1")
  assert.equal(titleForContent("# Tolaria Note\n\nBody.\n", "fallback"), "Tolaria Note")
  assert.equal(titleForContent("No heading here.\n", "my-file"), "my-file")
  // Frontmatter relationships are metadata, not titles.
  assert.equal(
    titleForContent(
      '---\narea: "Some Area"\nrelated_to:\n  - "Other"\n---\n\n# Kept H1\n',
      "fallback",
    ),
    "Kept H1",
  )
  // First H1 wins; H1 inside fenced code is ignored.
  assert.equal(titleForContent("```md\n# Not a title\n```\n\n# Real\n", "fallback"), "Real")
})

test("routes collapse indexes and strip extensions", () => {
  assert.equal(routeForSourcePath("index.md"), "/")
  assert.equal(routeForSourcePath("travel/index.md"), "/travel")
  assert.equal(routeForSourcePath("travel/upcoming/japan/index.md"), "/travel/upcoming/japan")
  assert.equal(
    routeForSourcePath("finance/fire-and-savings-plan.md"),
    "/finance/fire-and-savings-plan",
  )
  assert.equal(routeForSourcePath("notes/guide.mdx"), "/notes/guide")
})

test("title, filename, path, and nested-index aliases resolve deterministically", async () => {
  const root = tmpdir("aliases")
  writeTree(root, {
    "travel/index.md": "# Travel\n\nBody.\n",
    "travel/upcoming/japan/index.md": "# Japan\n\nBody.\n",
    "finance/fire-and-savings-plan.md": "# FIRE and Savings Plan\n\nBody.\n",
    "notes/plain.md": "# Plain H1\n\nBody.\n",
  })
  const first = buildWikiLinkMaps(root)
  const second = buildWikiLinkMaps(root)
  assert.deepEqual(second, first)
  assert.deepEqual([...first.files].sort(), first.files)
  assert.equal(first.permalinks["FIRE and Savings Plan"], "/finance/fire-and-savings-plan")
  assert.equal(first.permalinks["fire-and-savings-plan"], "/finance/fire-and-savings-plan")
  assert.equal(first.permalinks["finance/fire-and-savings-plan"], "/finance/fire-and-savings-plan")
  assert.equal(first.permalinks["Japan"], "/travel/upcoming/japan")
  assert.equal(first.permalinks["travel/upcoming/japan"], "/travel/upcoming/japan")
  assert.equal(first.permalinks["Travel"], "/travel")

  assert.match(
    await renderBody(first, "See [[FIRE and Savings Plan]] here."),
    /href="\/finance\/fire-and-savings-plan"[^>]*class="internal"/,
  )
  assert.match(
    await renderBody(first, "See [[fire-and-savings-plan]] here."),
    /href="\/finance\/fire-and-savings-plan"/,
  )
  assert.match(
    await renderBody(first, "See [[finance/fire-and-savings-plan]] here."),
    /href="\/finance\/fire-and-savings-plan"/,
  )
  assert.match(await renderBody(first, "See [[Japan]] here."), /href="\/travel\/upcoming\/japan"/)
  assert.match(
    await renderBody(first, "See [[travel/upcoming/japan]] here."),
    /href="\/travel\/upcoming\/japan"/,
  )
})

test("ambiguous filenames are omitted while unique paths still resolve", async () => {
  const root = tmpdir("ambiguous-filename")
  writeTree(root, {
    "inbox.md": "# Household Inbox\n\nBody.\n",
    "a/inbox.md": "# A Inbox\n\nBody.\n",
    "b/inbox.md": "# B Inbox\n\nBody.\n",
    "a/itinerary.md": "# A Itinerary\n\nBody.\n",
    "b/itinerary.md": "# B Itinerary\n\nBody.\n",
  })
  const maps = buildWikiLinkMaps(root)
  // Bare filename is ambiguous so it is omitted; the unique root path keeps its route.
  assert.equal(maps.permalinks["inbox"], "/inbox")
  assert.equal(maps.permalinks["a/inbox"], "/a/inbox")
  assert.match(await renderBody(maps, "See [[inbox]] here."), /href="\/inbox"[^>]*class="internal"/)
  assert.match(await renderBody(maps, "See [[a/inbox]] here."), /href="\/a\/inbox"/)
  // No root itinerary path exists, so the bare ambiguous name stays unresolved.
  const missing = await renderBody(maps, "See [[itinerary]] here.")
  assert.match(missing, /class="internal new"/)
  assert.match(await renderBody(maps, "See [[a/itinerary]] here."), /href="\/a\/itinerary"/)
})

test("duplicate normalized aliases fail with every candidate path", () => {
  const root = tmpdir("dups")
  writeTree(root, {
    "a.md": "# Same Title\n\nBody.\n",
    "b.md": "# Same Title\n\nBody.\n",
  })
  assert.throws(
    () => buildWikiLinkMaps(root),
    (error) => {
      assert.match(error.message, /duplicate wikilink aliases/)
      assert.match(error.message, /a\.md/)
      assert.match(error.message, /b\.md/)

      return true
    },
  )
  const caseRoot = tmpdir("dups-case")
  writeTree(caseRoot, {
    "a.md": "# Travel Style\n\nBody.\n",
    "b.md": "# travel  style\n\nBody.\n",
  })
  assert.throws(() => buildWikiLinkMaps(caseRoot), /duplicate wikilink aliases/)
})

test("label aliases and heading fragments keep plugin behavior", async () => {
  const root = tmpdir("alias-fragment")
  writeTree(root, {
    "finance/fire-and-savings-plan.md": "# FIRE and Savings Plan\n\n## Purpose\n\nBody.\n",
  })
  const maps = buildWikiLinkMaps(root)
  const aliased = await renderBody(maps, "See [[FIRE and Savings Plan|custom label]] here.")
  assert.match(aliased, /href="\/finance\/fire-and-savings-plan"/)
  assert.match(aliased, />custom label<\/a>/)
  const headed = await renderBody(maps, "See [[FIRE and Savings Plan#Purpose]] here.")
  assert.match(headed, /href="\/finance\/fire-and-savings-plan#Purpose"/)
  const both = await renderBody(maps, "See [[FIRE and Savings Plan#Purpose|label]] here.")
  assert.match(both, /href="\/finance\/fire-and-savings-plan#Purpose"/)
  assert.match(both, />label<\/a>/)
})

test("missing targets do not fail and render unresolved", async () => {
  const root = tmpdir("missing")
  writeTree(root, { "notes/plain.md": "# Plain H1\n\nBody.\n" })
  const maps = buildWikiLinkMaps(root)
  const html = await renderBody(maps, "See [[No Such Page]] here.")
  assert.match(html, /class="internal new"/)
  assert.match(html, />No Such Page<\/a>/)
})

test("wikilink-like text in code stays literal", async () => {
  const root = tmpdir("code")
  writeTree(root, { "notes/plain.md": "# Plain H1\n\nBody.\n" })
  const maps = buildWikiLinkMaps(root)
  assert.match(await renderBody(maps, "See `[[Plain H1]]` here."), /<code>\[\[Plain H1\]\]<\/code>/)
  const fenced = await renderBody(maps, "```js\nconst x = '[[Plain H1]]';\n```")
  assert.match(fenced, /<code[^>]*>[\s\S]*\[\[Plain H1\]\][\s\S]*<\/code>/)
  assert.doesNotMatch(fenced, /class="internal"/)
})

test("adapter stays small and leaves syntax to the maintained plugin", () => {
  const adapterPath = path.join(PUBLISHER_ROOT, "reader", "lib", "wiki-aliases.ts")
  const text = fs.readFileSync(adapterPath, "utf8")
  assert.ok(
    text.split("\n").length < 200,
    `adapter must stay below ~200 lines (got ${text.split("\n").length})`,
  )
  assert.ok(!text.includes("[["), "adapter must not parse wikilink syntax")
  assert.ok(!text.includes("]]"), "adapter must not parse wikilink syntax")
  assert.ok(
    !/remark-wiki-link/.test(text),
    "adapter supplies maps; only source.config wires the plugin",
  )
  const config = fs.readFileSync(path.join(PUBLISHER_ROOT, "reader", "source.config.ts"), "utf8")
  assert.match(config, /@flowershow\/remark-wiki-link/, "reader wires the maintained plugin")
  assert.match(config, /buildWikiLinkMaps/, "reader uses the small alias adapter")

  for (const token of ["custom compiler", "sanitizer", "compatibility report"]) {
    assert.ok(
      !config.includes(token) && !text.includes(token),
      `no project-owned ${token} framework`,
    )
  }
})
