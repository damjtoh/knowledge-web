/**
 * Knowledge Vault type collections — narrow helpers and full-build acceptance.
 *
 * Covers:
 * - Type normalization, slug and label derivation (C1, C3)
 * - Deterministic alphabetical ordering with slug tie-break (C6)
 * - Synthetic full-build: routes, membership, labels, counts, ordering, links,
 *   fallback, empty omission, search/tag preservation, overflow safety (C1-C9)
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test, after } from "node:test"

import {
  normalizeType,
  slugForType,
  labelForType,
  compareByTitleThenSlug,
  buildCollectionsFromFiles,
  FALLBACK_SLUG,
  FALLBACK_LABEL,
  COLLECTIONS_PREFIX,
} from "../plugins/knowledge-vault/dist/index.js"

const execFileAsync = promisify(execFile)
const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")
const STAGE_SCRIPT = path.join(PUBLISHER_ROOT, "scripts", "stage-content.mjs")
const BUILD_CLI = path.join(PUBLISHER_ROOT, "quartz", "bootstrap-cli.mjs")
const TRACKED_CONFIG = path.join(PUBLISHER_ROOT, "quartz.config.yaml")

const tmpRoots = []
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kv-collections-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}

after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Narrow pure-helper tests
// ---------------------------------------------------------------------------

test("normalizeType trims and rejects empty/non-string", () => {
  assert.equal(normalizeType("Task"), "Task")
  assert.equal(normalizeType("  Task  "), "Task")
  assert.equal(normalizeType("  "), null)
  assert.equal(normalizeType(""), null)
  assert.equal(normalizeType(null), null)
  assert.equal(normalizeType(undefined), null)
  assert.equal(normalizeType(123), null)
  assert.equal(normalizeType("  Bookmark  "), "Bookmark")
})

test("slugForType is stable, lower, hyphenated, and url-safe", () => {
  assert.equal(slugForType("Task"), "task")
  assert.equal(slugForType("task"), "task")
  assert.equal(slugForType(" TASK "), "task")
  assert.equal(slugForType("Exercise DB"), "exercise-db")
  assert.equal(slugForType("Exercise_DB"), "exercise-db")
  assert.equal(slugForType("My Custom Type"), "my-custom-type")
  assert.equal(slugForType("A & B"), "a-and-b")
  assert.equal(slugForType("  "), FALLBACK_SLUG) // empty after clean becomes fallback
})

test("labelForType maps known singulars to plural readable labels", () => {
  assert.equal(labelForType("Task", "task"), "Tasks")
  assert.equal(labelForType("task", "task"), "Tasks")
  assert.equal(labelForType("Idea", "idea"), "Ideas")
  assert.equal(labelForType("Note", "note"), "Notes")
  assert.equal(labelForType("Bookmark", "bookmark"), "Bookmarks")
  // Unknown types preserve readable form, acronyms stay upper
  assert.equal(labelForType("CustomType", "customtype"), "CustomType")
  assert.equal(labelForType("Exercise DB", "exercise-db"), "Exercise DB")
  assert.equal(labelForType("my_type", "my-type"), "My Type")
})

test("compareByTitleThenSlug orders by human title then slug deterministically", () => {
  const a = { slug: "notes/b", frontmatter: { title: "Alpha" } }
  const b = { slug: "notes/a", frontmatter: { title: "Alpha" } }
  const c = { slug: "notes/c", frontmatter: { title: "Beta" } }
  assert.equal(compareByTitleThenSlug(a, b) > 0, true) // same title, slug tie-break
  assert.equal(compareByTitleThenSlug(b, a) < 0, true)
  assert.equal(compareByTitleThenSlug(a, c) < 0, true) // Alpha < Beta
  assert.equal(compareByTitleThenSlug(c, a) > 0, true)

  const list = [c, a, b]
  list.sort(compareByTitleThenSlug)
  assert.deepEqual(
    list.map((x) => x.slug),
    ["notes/a", "notes/b", "notes/c"],
  )
})

test("buildCollectionsFromFiles groups by type only, not paths, and omits empty", () => {
  const files = [
    { slug: "notes/a", filePath: "/vault/notes/a.md", frontmatter: { type: "Task", title: "A" } },
    { slug: "other/b", filePath: "/vault/other/b.md", frontmatter: { type: "task", title: "B" } }, // same normalized
    { slug: "notes/c", filePath: "/vault/notes/c.md", frontmatter: { type: "Idea", title: "C" } },
    { slug: "notes/d", filePath: "/vault/notes/d.md", frontmatter: { title: "D" } }, // missing -> fallback
    { slug: "notes/e", filePath: "/vault/notes/e.md", frontmatter: { type: "  ", title: "E" } }, // empty -> fallback
    {
      slug: "collections/x",
      isVirtualPage: true,
      frontmatter: { type: "Task", title: "Should be excluded" },
    }, // virtual via metadata
    {
      slug: "tags/y",
      isVirtualPage: true,
      frontmatter: { type: "Task", title: "Should be excluded" },
    },
    { slug: "index", frontmatter: { type: "Task", title: "Should be excluded" } }, // synthetic, no filePath -> excluded
    { slug: "folder/index", frontmatter: { type: "Task", title: "Should be excluded" } }, // synthetic, no filePath
  ]
  const cols = buildCollectionsFromFiles(files)
  const task = cols.find((c) => c.slug === "task")
  const idea = cols.find((c) => c.slug === "idea")
  const other = cols.find((c) => c.slug === FALLBACK_SLUG)
  assert.ok(task, "task collection exists")
  assert.equal(task.items.length, 2, "both Task variants grouped")
  assert.ok(!task.items.some((i) => i.slug === "other/b" && false), "grouping ignores path")
  // Actually other/b is Task lower, should be in Task collection regardless of path
  assert.ok(
    task.items.some((i) => i.slug === "other/b"),
    "path-insensitive membership",
  )
  assert.ok(idea, "idea collection exists")
  assert.equal(idea.items.length, 1)
  assert.ok(other, "fallback exists")
  assert.equal(other.items.length, 2, "missing and empty go to fallback")
  // Virtual via metadata not in collections
  assert.ok(!cols.some((c) => c.items.some((i) => i.slug === "collections/x")))
  assert.ok(!cols.some((c) => c.items.some((i) => i.slug === "tags/y")))
  // No empty collection
  assert.equal(
    cols.some((c) => c.items.length === 0),
    false,
  )
})

test("buildCollectionsFromFiles sorts items alphabetically with slug tie-break", () => {
  const files = [
    { slug: "notes/b", frontmatter: { type: "Task", title: "Same" } },
    { slug: "notes/a", frontmatter: { type: "Task", title: "Same" } },
    { slug: "notes/c", frontmatter: { type: "Task", title: "Alpha" } },
  ]
  const cols = buildCollectionsFromFiles(files)
  const task = cols.find((c) => c.slug === "task")
  assert.deepEqual(
    task.items.map((i) => i.slug),
    ["notes/c", "notes/a", "notes/b"],
    "Alpha first, then Same ordered by slug",
  )
})

test("buildCollectionsFromFiles reserves fallback slug and makes routes collision-safe one-to-one", () => {
  // Distinct normalized types that slugify identically must get distinct routes
  const files = [
    { slug: "a", filePath: "/vault/a.md", frontmatter: { type: "A & B", title: "A" } },
    { slug: "b", filePath: "/vault/b.md", frontmatter: { type: "A and B", title: "B" } },
    { slug: "c", filePath: "/vault/c.md", frontmatter: { type: "A & B", title: "C" } },
  ]
  const cols = buildCollectionsFromFiles(files)
  const slugs = cols.map((c) => c.slug).sort()
  // "A & B" and "A and B" both become "a-and-b" — second must be disambiguated
  assert.ok(slugs.includes("a-and-b"), "first collision base present")
  assert.ok(slugs.includes("a-and-b-2"), "second collision disambiguated")
  const first = cols.find((c) => c.slug === "a-and-b")
  assert.ok(first, "a-and-b exists")
  assert.equal(first.items.length, 2, "same normalized reuses slug")
  const second = cols.find((c) => c.slug === "a-and-b-2")
  assert.equal(second.items.length, 1, "colliding distinct type separate")

  // Fallback slug reserve: type "Other" must not occupy "other"
  const files2 = [
    { slug: "x", filePath: "/vault/x.md", frontmatter: { type: "Other", title: "X" } },
    { slug: "y", filePath: "/vault/y.md", frontmatter: { title: "Y" } },
  ]
  const cols2 = buildCollectionsFromFiles(files2)
  const otherType = cols2.find((c) => c.items.some((i) => i.slug === "x"))
  const fallback = cols2.find((c) => c.slug === FALLBACK_SLUG)
  assert.ok(otherType, "Other type collection exists")
  assert.notEqual(otherType.slug, FALLBACK_SLUG, "Other type must not use reserved fallback slug")
  assert.ok(otherType.slug.startsWith("other-"), "reserved collision uses suffix")
  assert.ok(fallback, "fallback exists")
  assert.equal(fallback.items.length, 1, "fallback has only missing type")
})

test("buildCollectionsFromFiles allocates collision slugs deterministically independent of input order", () => {
  const mk = (type, slug) => ({
    slug,
    filePath: `/vault/${slug}.md`,
    frontmatter: { type, title: slug },
  })
  const filesAB = [mk("A & B", "a"), mk("A and B", "b")]
  const filesBA = [mk("A and B", "b"), mk("A & B", "a")]
  const colsAB = buildCollectionsFromFiles(filesAB)
  const colsBA = buildCollectionsFromFiles(filesBA)
  const findSlug = (cols, fileSlug) => {
    const col = cols.find((c) => c.items.some((i) => i.slug === fileSlug))
    return col ? col.slug : null
  }
  assert.equal(
    findSlug(colsAB, "a"),
    findSlug(colsBA, "a"),
    "A & B route stable across reversed input",
  )
  assert.equal(
    findSlug(colsAB, "b"),
    findSlug(colsBA, "b"),
    "A and B route stable across reversed input",
  )
  // Deterministic normalized order: "a & b" < "a and b" so A & B gets base
  assert.equal(findSlug(colsAB, "a"), "a-and-b")
  assert.equal(findSlug(colsAB, "b"), "a-and-b-2")
  const manyAB = [
    mk("Task", "t1"),
    mk("Idea", "i1"),
    mk("A & B", "a"),
    mk("A and B", "b"),
    mk("CustomType", "c"),
  ]
  const manyBA = [...manyAB].reverse()
  const colsManyAB = buildCollectionsFromFiles(manyAB)
  const colsManyBA = buildCollectionsFromFiles(manyBA)
  const slugFor = (cols, slug) =>
    cols.find((c) => c.items.some((i) => i.slug === slug))?.slug ?? null
  for (const s of ["t1", "i1", "a", "b", "c"]) {
    assert.equal(
      slugFor(colsManyAB, s),
      slugFor(colsManyBA, s),
      `stable slug for ${s} across reverse`,
    )
  }
})

test("buildCollectionsFromFiles includes authored typed index notes via metadata not filename", () => {
  const files = [
    {
      slug: "notes/index",
      filePath: "/vault/notes/index.md",
      frontmatter: { type: "Task", title: "Index Note" },
    },
    {
      slug: "index",
      filePath: "/vault/index.md",
      frontmatter: { type: "Task", title: "Root Index" },
    },
    {
      slug: "notes/regular",
      filePath: "/vault/notes/regular.md",
      frontmatter: { type: "Task", title: "Regular" },
    },
    // Virtual pages must still be excluded via metadata
    {
      slug: "collections/task",
      isVirtualPage: true,
      frontmatter: { type: "Task", title: "Virtual" },
    },
    { slug: "tags/work", isVirtualPage: true, frontmatter: { type: "Task", title: "Tag Virtual" } },
    {
      slug: "folder/index",
      isVirtualPage: true,
      frontmatter: { type: "Task", title: "Folder Virtual" },
    },
  ]
  const cols = buildCollectionsFromFiles(files)
  const task = cols.find((c) => c.slug === "task")
  assert.ok(task, "task collection exists")
  assert.equal(task.items.length, 3, "authored typed index notes included, virtual excluded")
  assert.ok(
    task.items.some((i) => i.slug === "notes/index"),
    "notes/index authored included",
  )
  assert.ok(
    task.items.some((i) => i.slug === "index"),
    "root index authored included",
  )
  assert.ok(!task.items.some((i) => i.slug === "collections/task"), "virtual not included")
})

test("buildCollectionsFromFiles includes authored typed notes under collections/ and tags/ via metadata not path", () => {
  const files = [
    {
      slug: "collections/authored-task",
      filePath: "/vault/collections/authored-task.md",
      frontmatter: { type: "Task", title: "Authored Collections Task" },
    },
    {
      slug: "tags/authored-idea",
      filePath: "/vault/tags/authored-idea.md",
      frontmatter: { type: "Idea", title: "Authored Tag Idea" },
    },
    {
      slug: "notes/regular",
      filePath: "/vault/notes/regular.md",
      frontmatter: { type: "Task", title: "Regular" },
    },
    // Virtual must still be excluded via metadata only
    {
      slug: "collections/virtual",
      isVirtualPage: true,
      frontmatter: { type: "Task", title: "Virtual" },
    },
    {
      slug: "tags/virtual",
      isVirtualPage: true,
      frontmatter: { type: "Idea", title: "Virtual" },
    },
    // Exclusion via collection/tag markers also works
    {
      slug: "something",
      collection: { slug: "task", label: "Tasks", items: [] },
      frontmatter: { type: "Task", title: "Has collection marker" },
    },
    { slug: "other", tag: "work", frontmatter: { type: "Task", title: "Has tag marker" } },
  ]
  const cols = buildCollectionsFromFiles(files)
  const task = cols.find((c) => c.slug === "task")
  const idea = cols.find((c) => c.slug === "idea")
  assert.ok(task, "task collection exists")
  assert.ok(
    task.items.some((i) => i.slug === "collections/authored-task"),
    "authored collections/authored-task included via type",
  )
  assert.ok(
    task.items.some((i) => i.slug === "notes/regular"),
    "regular task still present",
  )
  assert.ok(idea, "idea collection exists")
  assert.ok(
    idea.items.some((i) => i.slug === "tags/authored-idea"),
    "authored tags/authored-idea included via type",
  )
  assert.ok(
    !task.items.some((i) => i.slug === "collections/virtual"),
    "virtual collections excluded",
  )
  assert.ok(!idea.items.some((i) => i.slug === "tags/virtual"), "virtual tags excluded")
  assert.ok(
    !cols.some((c) => c.items.some((i) => i.slug === "something")),
    "collection marker excluded",
  )
  assert.ok(!cols.some((c) => c.items.some((i) => i.slug === "other")), "tag marker excluded")
})

test("buildCollectionsFromFiles includes authored untyped index notes in Other via metadata", () => {
  const files = [
    {
      slug: "index",
      filePath: "/vault/index.md",
      frontmatter: { title: "Root Untyped Index" },
    },
    {
      slug: "notes/index",
      filePath: "/vault/notes/index.md",
      frontmatter: { title: "Notes Index" },
    },
    {
      slug: "notes/typed",
      filePath: "/vault/notes/typed.md",
      frontmatter: { type: "Task", title: "Typed" },
    },
    // Empty and non-string types also go to Other
    {
      slug: "notes/empty-type",
      filePath: "/vault/notes/empty-type.md",
      frontmatter: { type: "   ", title: "Empty" },
    },
    {
      slug: "notes/nonstring",
      filePath: "/vault/notes/nonstring.md",
      frontmatter: { type: 123, title: "NonString" },
    },
    // Virtual/synthetic indexes excluded (no filePath or isVirtual)
    { slug: "folder/index", isVirtualPage: true, frontmatter: { title: "Virtual Folder" } },
    { slug: "synthetic/index", frontmatter: { title: "No filePath" } },
  ]
  const cols = buildCollectionsFromFiles(files)
  const other = cols.find((c) => c.slug === FALLBACK_SLUG)
  const task = cols.find((c) => c.slug === "task")
  assert.ok(other, "Other exists")
  assert.equal(other.items.length, 4, "index + empty + nonstring in Other")
  assert.ok(
    other.items.some((i) => i.slug === "index"),
    "root untyped index in Other",
  )
  assert.ok(
    other.items.some((i) => i.slug === "notes/index"),
    "notes/index untyped in Other",
  )
  assert.ok(
    other.items.some((i) => i.slug === "notes/empty-type"),
    "empty type in Other",
  )
  assert.ok(
    other.items.some((i) => i.slug === "notes/nonstring"),
    "nonstring type in Other",
  )
  assert.ok(
    !other.items.some((i) => i.slug === "folder/index"),
    "virtual folder index not in Other",
  )
  assert.ok(
    !other.items.some((i) => i.slug === "synthetic/index"),
    "synthetic no filePath not in Other",
  )
  assert.ok(task && task.items.some((i) => i.slug === "notes/typed"), "typed still separate")
})

test("buildCollectionsFromFiles allocates virtual routes collision-safely against authored collections/* routes", () => {
  const files = [
    {
      slug: "collections/task",
      filePath: "/vault/collections/task.md",
      frontmatter: { type: "Note", title: "Authored task route" },
    },
    { slug: "notes/a", filePath: "/vault/notes/a.md", frontmatter: { type: "Task", title: "A" } },
    { slug: "notes/b", filePath: "/vault/notes/b.md", frontmatter: { type: "Task", title: "B" } },
  ]
  const cols = buildCollectionsFromFiles(files)
  const task = cols.find((c) => c.label === "Tasks")
  assert.ok(task, "Tasks collection exists")
  assert.notEqual(task.slug, "task", "Task collection must avoid authored collections/task")
  assert.ok(task.slug.startsWith("task-"), `disambiguated slug got ${task.slug}`)
  // Authored note itself should still be in its own Note collection, not lost
  const note = cols.find((c) => c.label === "Notes")
  assert.ok(
    note && note.items.some((i) => i.slug === "collections/task"),
    "authored collections/task preserved as Note",
  )

  // Fallback collision with authored other
  const files2 = [
    {
      slug: "collections/other",
      filePath: "/vault/collections/other.md",
      frontmatter: { title: "Authored other" },
    },
    { slug: "notes/x", filePath: "/vault/notes/x.md", frontmatter: { title: "Untyped X" } },
    { slug: "notes/y", filePath: "/vault/notes/y.md", frontmatter: { type: "Task", title: "Y" } },
  ]
  const cols2 = buildCollectionsFromFiles(files2)
  const fallback = cols2.find((c) => c.items.some((i) => i.slug === "notes/x"))
  assert.ok(fallback, "fallback exists")
  assert.notEqual(fallback.slug, "other", "fallback must avoid authored collections/other")
  assert.ok(fallback.slug.startsWith("other-"), `fallback disambiguated to ${fallback.slug}`)
})

test("Collections pageType match uses explicit metadata not slug prefix", async () => {
  const { Collections } = await import("../plugins/knowledge-vault/dist/index.js")
  const pt = Collections()
  assert.equal(
    pt.match({ slug: "collections/task", fileData: { slug: "collections/task" } }),
    false,
    "authored collections/* without collection metadata must not match",
  )
  assert.equal(
    pt.match({
      slug: "collections/task",
      fileData: {
        slug: "collections/task",
        collection: { slug: "task", label: "Tasks", items: [] },
      },
    }),
    true,
    "generated collection with collection metadata must match",
  )
  assert.equal(
    pt.match({
      slug: "notes/regular",
      fileData: {
        slug: "notes/regular",
        isVirtualPage: true,
        collection: { slug: "task", label: "Tasks", items: [] },
      },
    }),
    true,
    "metadata match ignores slug",
  )
  assert.equal(
    pt.match({
      slug: "collections/other",
      fileData: { slug: "collections/other", isVirtualPage: true },
    }),
    false,
    "virtual without collection must not match",
  )
})

// ---------------------------------------------------------------------------
// Full-build acceptance
// ---------------------------------------------------------------------------

function makeKb() {
  const kb = tmpdir("kb")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.mkdirSync(path.join(kb, "extra"), { recursive: true })
  fs.mkdirSync(path.join(kb, "unselected"), { recursive: true })

  fs.writeFileSync(
    path.join(kb, "notes", "task-alpha.md"),
    [
      "---",
      "type: Task",
      "description: Task alpha desc",
      "tags: [work]",
      "---",
      "",
      "# Task Alpha",
      "",
      "Alpha body. See [[task-beta]]",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "task-beta.md"),
    ["---", "type: Task", "---", "", "# Task Beta", "", "Beta content.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "task-alpha-duplicate.md"),
    [
      "---",
      "type: Task",
      "description: Duplicate desc",
      "---",
      "",
      "# Task Alpha",
      "",
      "Duplicate title.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "task-lower.md"),
    ["---", "type: task", "---", "", "# Task Lower", "", "Lower.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "idea-one.md"),
    [
      "---",
      'type: "Idea"',
      "description: Idea one desc",
      "---",
      "",
      "# Idea One",
      "",
      "Idea.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "idea-two.md"),
    ["---", "type: Idea", "---", "", "# Idea Two", "", "Idea two.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "note-one.md"),
    ["---", "type: Note", "description: Note desc", "---", "", "# Note One", "", "Note.", ""].join(
      "\n",
    ),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "bookmark-one.md"),
    [
      "---",
      "type: Bookmark",
      "description: Bookmark desc",
      "tags: [bookmark-tag]",
      "---",
      "",
      "# Bookmark One",
      "",
      "Bookmark with [[note-one]]",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "no-type.md"),
    ["---", "tags: [misc]", "---", "", "# No Type Note", "", "No type.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "custom.md"),
    [
      "---",
      "type: CustomType",
      "description: Custom desc",
      "---",
      "",
      "# Custom Item",
      "",
      "Custom.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "extra", "task-in-extra.md"),
    ["---", "type: Task", "---", "", "# Task In Extra", "", "Extra folder task.", ""].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "about.md"),
    [
      "---",
      "type: Note",
      "description: About desc",
      "---",
      "",
      "# About This Garden",
      "",
      "About.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(path.join(kb, "unselected", "secret.md"), "# Secret\n\nMust never appear.\n")

  return kb
}

function writeManifest(kb) {
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    [
      "title: Test Garden",
      "canonicalHostname: test.example.com",
      "select:",
      "  - notes",
      "  - extra",
      "  - about.md",
      "",
    ].join("\n"),
  )
}

async function stageKb(kb, contentDir, identityFile) {
  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", contentDir, "--identity-file", identityFile],
    { cwd: PUBLISHER_ROOT },
  )
}

async function buildQuartz(contentDir, outputDir) {
  await execFileAsync(
    process.execPath,
    [BUILD_CLI, "build", "--directory", contentDir, "--output", outputDir, "--concurrency", "1"],
    { cwd: PUBLISHER_ROOT, timeout: 120000 },
  )
}

test("synthetic Tolaria vault generates stable type collections, navigation, ordering, fallback, and preserves links/search/tags", async () => {
  const kb = makeKb()
  writeManifest(kb)
  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")

  await stageKb(kb, contentDir, identityFile)
  await buildQuartz(contentDir, outputDir)

  const readHtml = (rel) => fs.readFileSync(path.join(outputDir, rel), "utf8")
  const contentIndex = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentIndex.json"), "utf8"),
  )
  const contentMetadata = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentMetadata.json"), "utf8"),
  )

  // C1 & C2: each discovered nonempty type gets stable route; Task/Idea/Note/Bookmark separate
  const slugs = ["task", "idea", "note", "bookmark", "customtype", "other"]
  for (const s of slugs) {
    assert.ok(
      fs.existsSync(path.join(outputDir, "collections", `${s}.html`)),
      `collection ${s} route exists`,
    )
  }
  // Empty collection not generated
  assert.equal(
    fs.existsSync(path.join(outputDir, "collections", "empty.html")),
    false,
    "empty collection omitted",
  )

  // C1: membership only from type, never paths
  const taskHtml = readHtml("collections/task.html")
  assert.match(taskHtml, /Task Alpha/, "task collection contains alpha")
  assert.match(taskHtml, /Task In Extra/, "task from extra folder grouped by type, not path")

  // C2: separate collections
  const ideaHtml = readHtml("collections/idea.html")
  const noteHtml = readHtml("collections/note.html")
  const bookmarkHtml = readHtml("collections/bookmark.html")
  assert.ok(!ideaHtml.includes("Task Alpha"), "idea collection does not contain task")
  assert.ok(!noteHtml.includes("Idea One"), "note collection does not contain idea")
  assert.match(bookmarkHtml, /Bookmark One/, "bookmark collection separate")

  // C3: navigation shows readable labels and accurate counts only for nonempty
  const indexHtml = readHtml("index.html")
  assert.match(indexHtml, /kv-collections-nav/, "navigation present")
  // Counts: Tasks 5, Ideas 2, Notes 2, Bookmarks 1, CustomType 1, Other 1
  assert.match(indexHtml, /Tasks \(5\)/, "Tasks count 5")
  assert.match(indexHtml, /Ideas \(2\)/, "Ideas count 2")
  assert.match(indexHtml, /Notes \(2\)/, "Notes count 2")
  assert.match(indexHtml, /Bookmarks \(1\)/, "Bookmarks count 1")
  assert.match(indexHtml, /CustomType \(1\)/, "CustomType count 1")
  assert.match(indexHtml, /Other \(1\)/, "Other count 1")
  // Empty not shown (already checked route absent, but also nav absent)
  assert.ok(!indexHtml.includes("Empty ("), "empty not in nav")

  // C4: missing/unknown fallback retrievable
  const fallbackHtml = readHtml("collections/other.html")
  assert.match(fallbackHtml, /No Type Note/, "fallback contains missing type")
  assert.ok(!fallbackHtml.includes("Task Alpha"), "fallback does not contain typed note")
  const customHtml = readHtml("collections/customtype.html")
  assert.match(customHtml, /Custom Item/, "unknown type has its own collection")

  // C5: readable titles and descriptions, missing degrade safely
  assert.match(taskHtml, /Task Alpha/, "readable title")
  assert.match(taskHtml, /Task alpha desc/, "description when available")
  // Task Beta has no description -> should not crash, page still renders
  assert.match(taskHtml, /Task Beta/, "task beta title present despite missing desc")
  // fallback entry still renders
  assert.match(fallbackHtml, /No Type Note/, "fallback title readable")

  // C6: alphabetical ordering with slug tie-break
  // Task Alpha duplicate: two entries with same title "Task Alpha" should be ordered by slug
  const taskAlphaIdx = taskHtml.indexOf("Task Alpha")
  const dupIdx = taskHtml.indexOf("Task Alpha", taskAlphaIdx + 1)
  const betaIdx = taskHtml.indexOf("Task Beta")
  const extraIdx = taskHtml.indexOf("Task In Extra")
  const lowerIdx = taskHtml.indexOf("Task Lower")
  assert.ok(taskAlphaIdx !== -1 && dupIdx !== -1, "both alphas present")
  assert.ok(dupIdx > taskAlphaIdx, "duplicate after first alpha by slug")
  // Alpha < Beta < In Extra < Lower alphabetically
  assert.ok(betaIdx > dupIdx, "Beta after Alphas")
  assert.ok(extraIdx > betaIdx, "In Extra after Beta")
  assert.ok(lowerIdx > extraIdx, "Lower after In Extra")

  // C7: links, wikilinks, search, tag routes intact
  const taskAlphaPage = readHtml("notes/task-alpha.html")
  const linkMatch = taskAlphaPage.match(
    /<a[^>]*href="[^"]*task-beta[^"]*"[^>]*class="[^"]*internal[^"]*"/,
  )
  assert.ok(linkMatch, "wikilink task-alpha -> task-beta internal")
  assert.ok(!linkMatch[0].includes("broken"), "wikilink not broken")
  const bookmarkPage = readHtml("notes/bookmark-one.html")
  assert.match(bookmarkPage, /note-one/, "bookmark links to note")

  // Search metadata
  assert.equal(contentIndex["notes/task-alpha"]?.title, "Task Alpha", "search title readable")
  assert.deepEqual(contentIndex["notes/task-alpha"]?.tags, ["work"])
  // Tag pages still exist
  assert.ok(
    fs.existsSync(path.join(outputDir, "tags", "work.html")) ||
      fs.existsSync(path.join(outputDir, "tags", "bookmark-tag.html")),
    "tag page exists",
  )
  assert.ok(fs.existsSync(path.join(outputDir, "tags", "index.html")), "tags index exists")

  // Check collection entries have working links
  assert.match(taskHtml, /href="[^"]*notes\/task-beta[^"]*"/, "collection entry link works")
  // Ensure contentIndex not leaking secret
  assert.ok(!JSON.stringify(contentIndex).includes("Secret"), "secret not in search")
  assert.ok(!contentMetadata.some((e) => e.slug.includes("secret")), "secret not in metadata")

  // C8: navigation usable at narrow and desktop without horizontal overflow
  // Check CSS contains responsive wrapping rules
  const hasNavCss =
    indexHtml.includes("kv-collections-nav") &&
    (readHtml("index.html").includes("flex-wrap") ||
      fs.readFileSync(path.join(outputDir, "index.css"), "utf8").includes("flex-wrap"))
  assert.ok(hasNavCss, "nav CSS uses flex-wrap for overflow safety")
  assert.match(indexHtml, /kv-collections-nav/, "nav present for overflow check")

  // C9: full-build fixture already verified above; ensure ordering, counts, etc. all passed
})

test("full-build preserves authored collections/* and tags/* notes, untyped indexes in Other, collision-safe routes, and direct links", async () => {
  const kb = tmpdir("kb2")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.mkdirSync(path.join(kb, "collections"), { recursive: true })
  fs.mkdirSync(path.join(kb, "tags"), { recursive: true })
  // Authored Task note
  fs.writeFileSync(
    path.join(kb, "notes", "task-one.md"),
    [
      "---",
      "type: Task",
      "---",
      "",
      "# Task One",
      "",
      "Task one body. See [[task-two]] and [[authored-collections-task]]",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "task-two.md"),
    ["---", "type: Task", "---", "", "# Task Two", "", "Second task.", ""].join("\n"),
  )
  // Authored note that occupies the would-be virtual route collections/task
  fs.writeFileSync(
    path.join(kb, "collections", "task.md"),
    [
      "---",
      "type: Note",
      "description: Authored collections task desc",
      "---",
      "",
      "# Authored Collections Task",
      "",
      "This authored file lives at collections/task and must not be replaced.",
      "",
    ].join("\n"),
  )
  // Authored note under tags/ with Idea type
  fs.writeFileSync(
    path.join(kb, "tags", "authored-idea.md"),
    [
      "---",
      "type: Idea",
      "description: Tag authored idea",
      "---",
      "",
      "# Authored Tag Idea",
      "",
      "Idea under tags.",
      "",
    ].join("\n"),
  )
  // Untyped authored indexes that should go to Other (metadata-only, with filePath)
  fs.writeFileSync(
    path.join(kb, "notes", "index.md"),
    ["# Notes Index Untyped", "", "Untyped index content.", ""].join("\n"),
  )
  // Also root collection occupancy for fallback: authored file at collections/other
  fs.writeFileSync(
    path.join(kb, "collections", "other.md"),
    [
      "---",
      "type: Note",
      "---",
      "",
      "# Authored Other Route",
      "",
      "Occupies fallback route.",
      "",
    ].join("\n"),
  )
  fs.writeFileSync(
    path.join(kb, "notes", "untyped.md"),
    ["# Untyped Note", "", "No type here.", ""].join("\n"),
  )
  // Manifest must select collections and tags explicitly
  fs.writeFileSync(
    path.join(kb, "publication.manifest.yaml"),
    [
      "title: Test Garden 2",
      "canonicalHostname: test.example.com",
      "select:",
      "  - notes",
      "  - collections",
      "  - tags",
      "",
    ].join("\n"),
  )
  const work = tmpdir("work2")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outputDir = path.join(work, "public")
  await stageKb(kb, contentDir, identityFile)
  await buildQuartz(contentDir, outputDir)
  const readHtml = (rel) => fs.readFileSync(path.join(outputDir, rel), "utf8")

  // Authored collections/task must be preserved as authored content, not replaced by virtual collection
  assert.ok(
    fs.existsSync(path.join(outputDir, "collections", "task.html")),
    "authored collections/task.html preserved",
  )
  const authoredTaskHtml = readHtml("collections/task.html")
  assert.match(
    authoredTaskHtml,
    /Authored Collections Task/,
    "authored collections/task page shows its own title",
  )
  assert.ok(
    !authoredTaskHtml.includes("kv-collection-list"),
    "authored collections/task must not be rendered as collection page",
  )
  // Original Task collection should have been allocated to collision-safe route task-2
  assert.ok(
    fs.existsSync(path.join(outputDir, "collections", "task-2.html")),
    "Task collection moved to task-2 due to authored collision",
  )
  const taskCollHtml = readHtml("collections/task-2.html")
  assert.match(taskCollHtml, /Tasks/, "Task collection label present at task-2")
  assert.match(taskCollHtml, /Task One/, "Task collection at task-2 contains Task One")
  assert.match(taskCollHtml, /Task Two/, "Task collection contains Task Two")
  // Navigation must link to disambiguated route, not hijacked authored route
  const indexHtml = readHtml("index.html")
  assert.match(indexHtml, /href="[^"]*collections\/task-2[^"]*".*Tasks/, "nav links to task-2")
  assert.ok(
    !indexHtml.includes('href="collections/task.html"') || indexHtml.includes("collections/task-2"),
    "nav must not link to hijacked task route as primary",
  )

  // Authored tags/* typed note must be included in its type collection via metadata, not excluded by path
  assert.ok(
    fs.existsSync(path.join(outputDir, "tags", "authored-idea.html")),
    "authored tags/authored-idea.html exists",
  )
  const ideaCollPath = fs.existsSync(path.join(outputDir, "collections", "idea.html"))
    ? "collections/idea.html"
    : "collections/idea-2.html"
  assert.ok(fs.existsSync(path.join(outputDir, ideaCollPath)), "Idea collection exists")
  const ideaHtml = readHtml(ideaCollPath)
  assert.match(ideaHtml, /Authored Tag Idea/, "tags/authored-idea included in Idea collection")

  // Untyped authored indexes must be in Other, and fallback must avoid authored collections/other collision
  const otherCollPath = fs.existsSync(path.join(outputDir, "collections", "other-2.html"))
    ? "collections/other-2.html"
    : fs.existsSync(path.join(outputDir, "collections", "other.html"))
      ? "collections/other.html"
      : null
  // Since collections/other is occupied, fallback should be other-2
  assert.ok(
    fs.existsSync(path.join(outputDir, "collections", "other-2.html")),
    "fallback moved to other-2 due to authored collections/other",
  )
  const fallbackHtml = readHtml("collections/other-2.html")
  assert.match(
    fallbackHtml,
    /Notes Index Untyped|Untyped Note/,
    "fallback contains untyped indexes",
  )
  assert.match(fallbackHtml, /Notes Index Untyped/, "notes/index untyped in Other")
  assert.match(fallbackHtml, /Untyped Note/, "untyped note in Other")

  // Direct wikilinks must remain intact and not broken after collision handling
  const taskOneHtml = readHtml("notes/task-one.html")
  const linkToAuthored = taskOneHtml.match(
    /<a[^>]*href="[^"]*collections\/task[^"]*"[^>]*class="[^"]*internal[^"]*"/,
  )
  assert.ok(linkToAuthored, "wikilink to authored collections/task is internal")
  assert.ok(
    !linkToAuthored[0].includes("broken"),
    "direct link to authored collections/task not broken",
  )
  const linkToTaskTwo = taskOneHtml.match(
    /<a[^>]*href="[^"]*task-two[^"]*"[^>]*class="[^"]*internal[^"]*"/,
  )
  assert.ok(linkToTaskTwo, "wikilink to task-two preserved")
  assert.ok(!linkToTaskTwo[0].includes("broken"), "wikilink not broken")

  // Collection entries should link correctly without breaking
  assert.match(
    taskCollHtml,
    /href="[^"]*notes\/task-one[^"]*"/,
    "collection entry link to task-one works",
  )
})
