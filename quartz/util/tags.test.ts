import test, { describe } from "node:test"
import assert from "node:assert"
import {
  getDistinctTags,
  getTagCounts,
  getPagesForTag,
  slugForTag,
  slugForTagIndex,
  getSortedTagsByCount,
} from "./tags"
import { FullSlug } from "./path"
import { QuartzPluginData } from "../plugins/vfile"

function makeFile(slug: string, tags?: string[], unlisted?: boolean): QuartzPluginData {
  return {
    slug: slug as FullSlug,
    frontmatter: { title: slug, tags: tags ?? [] },
    ...(unlisted !== undefined ? { unlisted } : {}),
  } as unknown as QuartzPluginData
}

describe("tag enumeration", () => {
  test("distinct tags enumerates all unique tags", () => {
    const files = [
      makeFile("a", ["recipes", "travel"]),
      makeFile("b", ["travel", "food"]),
      makeFile("c", ["recipes"]),
    ]
    const distinct = getDistinctTags(files)
    assert.deepStrictEqual(new Set(distinct), new Set(["recipes", "travel", "food"]))
  })

  test("per-tag page lists returns only pages carrying that tag", () => {
    const files = [
      makeFile("a", ["recipes"]),
      makeFile("b", ["recipes", "travel"]),
      makeFile("c", ["travel"]),
    ]
    const recipes = getPagesForTag(files, "recipes")
    assert.strictEqual(recipes.length, 2)
    assert.ok(recipes.every((f) => (f.frontmatter?.tags as string[]).includes("recipes")))
    assert.ok(recipes.some((f) => f.slug === "a"))
    assert.ok(recipes.some((f) => f.slug === "b"))
    assert.ok(!recipes.some((f) => f.slug === "c"))

    const travel = getPagesForTag(files, "travel")
    assert.strictEqual(travel.length, 2)
    assert.ok(travel.some((f) => f.slug === "b"))
    assert.ok(travel.some((f) => f.slug === "c"))
  })

  test("counts reflect number of pages per tag", () => {
    const files = [
      makeFile("a", ["alpha", "beta"]),
      makeFile("b", ["alpha"]),
      makeFile("c", ["beta", "gamma"]),
      makeFile("d", ["alpha"]),
    ]
    const counts = getTagCounts(files)
    assert.strictEqual(counts.get("alpha"), 3)
    assert.strictEqual(counts.get("beta"), 2)
    assert.strictEqual(counts.get("gamma"), 1)
  })

  test("slug mapping preserves tag casing and uses tags/ prefix", () => {
    const slug = slugForTag("my-tag")
    assert.strictEqual(slug, "tags/my-tag" as FullSlug)
    const nested = slugForTag("parent/child")
    assert.strictEqual(nested, "tags/parent/child" as FullSlug)
    const index = slugForTagIndex()
    assert.strictEqual(index, "tags/index" as FullSlug)
  })

  test("edge case: pages with no tags produce empty sets and counts", () => {
    const files = [makeFile("a"), makeFile("b", []), makeFile("c", ["solo"])]
    const distinct = getDistinctTags(files)
    assert.deepStrictEqual(new Set(distinct), new Set(["solo"]))
    const counts = getTagCounts(files)
    assert.strictEqual(counts.size, 1)
    assert.strictEqual(counts.get("solo"), 1)
    const none = getPagesForTag(files, "missing")
    assert.strictEqual(none.length, 0)
  })

  test("edge case: empty file list yields empty tags and index", () => {
    const files: QuartzPluginData[] = []
    assert.deepStrictEqual(getDistinctTags(files), [])
    assert.strictEqual(getTagCounts(files).size, 0)
    assert.deepStrictEqual(getPagesForTag(files, "any"), [])
    assert.deepStrictEqual(getSortedTagsByCount(getTagCounts(files)), [])
  })

  test("sorted tags by count descending", () => {
    const files = [
      makeFile("a", ["alpha"]),
      makeFile("b", ["alpha", "beta"]),
      makeFile("c", ["beta"]),
      makeFile("d", ["gamma"]),
      makeFile("e", ["alpha"]),
    ]
    const counts = getTagCounts(files)
    // alpha 3, beta 2, gamma 1
    const sorted = getSortedTagsByCount(counts)
    assert.strictEqual(sorted[0].tag, "alpha")
    assert.strictEqual(sorted[0].count, 3)
    assert.strictEqual(sorted[1].tag, "beta")
    assert.strictEqual(sorted[1].count, 2)
    assert.strictEqual(sorted[2].tag, "gamma")
    assert.strictEqual(sorted[2].count, 1)
  })

  test("slug mapping consistent with PageList link generation", () => {
    // PageList generates href via `tags/${tag}` with resolveRelative.
    // Our slugForTag must produce the same string so links resolve.
    const tag = "casita"
    const slug = slugForTag(tag)
    assert.strictEqual(slug, `tags/${tag}` as FullSlug)
  })

  test("excludes unlisted pages from tag enumeration and listings", () => {
    const files = [
      makeFile("a", ["alpha"]),
      makeFile("b", ["alpha"], true),
      makeFile("c", ["secret"], true),
      makeFile("d", ["beta"], false),
    ]

    // distinct tags: secret only in unlisted should not appear
    const distinct = getDistinctTags(files)
    assert.deepStrictEqual(new Set(distinct), new Set(["alpha", "beta"]))
    assert.ok(!distinct.includes("secret"))

    // counts: alpha counted once (unlisted ignored), secret absent
    const counts = getTagCounts(files)
    assert.strictEqual(counts.get("alpha"), 1)
    assert.strictEqual(counts.get("beta"), 1)
    assert.strictEqual(counts.has("secret"), false)

    // per-tag listings: unlisted pages not discoverable
    const alphaPages = getPagesForTag(files, "alpha")
    assert.strictEqual(alphaPages.length, 1)
    assert.ok(alphaPages.some((f) => f.slug === "a"))
    assert.ok(!alphaPages.some((f) => f.slug === "b"))

    const secretPages = getPagesForTag(files, "secret")
    assert.strictEqual(secretPages.length, 0)

    // explicit unlisted: false is included
    const visibleBeta = getPagesForTag(files, "beta")
    assert.strictEqual(visibleBeta.length, 1)
    assert.ok(visibleBeta.some((f) => f.slug === "d"))
  })
})
