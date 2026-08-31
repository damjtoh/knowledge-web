import test, { describe } from "node:test"
import assert from "node:assert"
import {
  matchesQuery,
  matchesTags,
  filterEntries,
  sortEntries,
  getDistinctTagsFromEntries,
  toFolderEntry,
  isTagPagePath,
  type FolderEntry,
} from "./folderFilters"
import { FullSlug } from "./path"
import type { QuartzPluginData } from "../plugins/vfile"

function entry(overrides: Partial<FolderEntry> & { slug: string; title: string }): FolderEntry {
  return {
    tags: [],
    date: null,
    description: "",
    ...overrides,
  }
}

describe("folderFilters pure logic", () => {
  describe("matchesQuery", () => {
    test("empty query matches all", () => {
      const e = entry({ slug: "a", title: "Hello World", tags: ["foo"] })
      assert.strictEqual(matchesQuery(e, ""), true)
      assert.strictEqual(matchesQuery(e, "   "), true)
    })

    test("matches title case-insensitive substring", () => {
      const e = entry({ slug: "a", title: "Project Alpha", tags: [] })
      assert.strictEqual(matchesQuery(e, "project"), true)
      assert.strictEqual(matchesQuery(e, "ALPHA"), true)
      assert.strictEqual(matchesQuery(e, "ject Alp"), true)
      assert.strictEqual(matchesQuery(e, "beta"), false)
    })

    test("matches tag case-insensitive substring", () => {
      const e = entry({ slug: "a", title: "Nope", tags: ["recipes", "travel"] })
      assert.strictEqual(matchesQuery(e, "rec"), true)
      assert.strictEqual(matchesQuery(e, "TRAVEL"), true)
      assert.strictEqual(matchesQuery(e, "food"), false)
    })

    test("query matches title or tag", () => {
      const a = entry({ slug: "a", title: "Chocolate Cake", tags: ["dessert"] })
      const b = entry({ slug: "b", title: "Vanilla Cake", tags: ["recipes"] })
      assert.strictEqual(matchesQuery(a, "chocolate"), true)
      assert.strictEqual(matchesQuery(b, "chocolate"), false)
      assert.strictEqual(matchesQuery(b, "recipes"), true)
      assert.strictEqual(matchesQuery(a, "recipes"), false)
    })
  })

  describe("matchesTags (AND)", () => {
    test("empty selectedTags matches all", () => {
      const e = entry({ slug: "a", title: "t", tags: ["a", "b"] })
      assert.strictEqual(matchesTags(e, []), true)
    })

    test("single tag must be present", () => {
      const e = entry({ slug: "a", title: "t", tags: ["alpha", "beta"] })
      assert.strictEqual(matchesTags(e, ["alpha"]), true)
      assert.strictEqual(matchesTags(e, ["gamma"]), false)
    })

    test("multiple selected tags combine with AND", () => {
      const e1 = entry({ slug: "a", title: "t", tags: ["alpha", "beta", "gamma"] })
      const e2 = entry({ slug: "b", title: "t", tags: ["alpha", "beta"] })
      const e3 = entry({ slug: "c", title: "t", tags: ["alpha"] })
      assert.strictEqual(matchesTags(e1, ["alpha", "beta"]), true)
      assert.strictEqual(matchesTags(e2, ["alpha", "beta"]), true)
      assert.strictEqual(matchesTags(e3, ["alpha", "beta"]), false)
      assert.strictEqual(matchesTags(e1, ["alpha", "beta", "gamma"]), true)
      assert.strictEqual(matchesTags(e2, ["alpha", "beta", "gamma"]), false)
    })

    test("tag matching is exact case-sensitive", () => {
      const e = entry({ slug: "a", title: "t", tags: ["Travel"] })
      assert.strictEqual(matchesTags(e, ["Travel"]), true)
      assert.strictEqual(matchesTags(e, ["travel"]), false)
    })
  })

  describe("filterEntries", () => {
    test("combines query and tag filters", () => {
      const entries = [
        entry({ slug: "a", title: "Chocolate Cake", tags: ["dessert", "travel"] }),
        entry({ slug: "b", title: "Travel Guide", tags: ["travel"] }),
        entry({ slug: "c", title: "Chocolate Travel", tags: ["dessert"] }),
      ]
      const result = filterEntries(entries, "chocolate", ["dessert"])
      assert.strictEqual(result.length, 2)
      assert.ok(result.some((e) => e.slug === "a"))
      assert.ok(result.some((e) => e.slug === "c"))
      assert.ok(!result.some((e) => e.slug === "b"))
    })

    test("empty query and no tags returns all", () => {
      const entries = [
        entry({ slug: "a", title: "t", tags: [] }),
        entry({ slug: "b", title: "u", tags: [] }),
      ]
      assert.strictEqual(filterEntries(entries, "", []).length, 2)
    })

    test("pure does not mutate input", () => {
      const entries = [entry({ slug: "a", title: "Hello", tags: [] })]
      const copy = [...entries]
      filterEntries(entries, "hello", [])
      assert.deepStrictEqual(entries, copy)
    })
  })

  describe("sortEntries", () => {
    test("alpha sorts A–Z case-insensitive", () => {
      const entries = [
        entry({ slug: "c", title: "zebra" }),
        entry({ slug: "a", title: "Apple" }),
        entry({ slug: "b", title: "mango" }),
        entry({ slug: "d", title: "apple" }),
      ]
      const sorted = sortEntries(entries, "alpha")
      assert.deepStrictEqual(
        sorted.map((e) => e.slug),
        ["a", "d", "b", "c"],
      )
    })

    test("alpha tie-breaker is slug", () => {
      const entries = [entry({ slug: "b", title: "Same" }), entry({ slug: "a", title: "Same" })]
      const sorted = sortEntries(entries, "alpha")
      assert.deepStrictEqual(
        sorted.map((e) => e.slug),
        ["a", "b"],
      )
    })

    test("date sorts newest-first", () => {
      const entries = [
        entry({ slug: "a", title: "Old", date: "2020-01-01T00:00:00.000Z" }),
        entry({ slug: "b", title: "New", date: "2024-01-01T00:00:00.000Z" }),
        entry({ slug: "c", title: "Mid", date: "2022-06-15T00:00:00.000Z" }),
      ]
      const sorted = sortEntries(entries, "date")
      assert.deepStrictEqual(
        sorted.map((e) => e.slug),
        ["b", "c", "a"],
      )
    })

    test("date fallback to alpha when dates missing or equal", () => {
      const entries = [
        entry({ slug: "a", title: "Zebra", date: null }),
        entry({ slug: "b", title: "Apple", date: "2024-01-01T00:00:00.000Z" }),
        entry({ slug: "c", title: "Mango", date: null }),
        entry({ slug: "d", title: "Banana", date: "2024-01-01T00:00:00.000Z" }),
      ]
      const sorted = sortEntries(entries, "date")
      // dated first sorted alpha among equal dates, then undated sorted alpha
      assert.deepStrictEqual(
        sorted.map((e) => e.slug),
        ["b", "d", "c", "a"],
      )
    })

    test("date with Date objects", () => {
      const entries = [
        entry({ slug: "a", title: "A", date: new Date("2021-01-01") }),
        entry({ slug: "b", title: "B", date: new Date("2023-01-01") }),
      ]
      const sorted = sortEntries(entries, "date")
      assert.deepStrictEqual(
        sorted.map((e) => e.slug),
        ["b", "a"],
      )
    })

    test("does not mutate input", () => {
      const entries = [entry({ slug: "b", title: "B" }), entry({ slug: "a", title: "A" })]
      const copy = [...entries]
      sortEntries(entries, "alpha")
      assert.deepStrictEqual(entries, copy)
    })
  })

  describe("getDistinctTagsFromEntries", () => {
    test("returns sorted distinct tags", () => {
      const entries = [
        entry({ slug: "a", title: "t", tags: ["recipes", "travel"] }),
        entry({ slug: "b", title: "t", tags: ["travel", "food"] }),
        entry({ slug: "c", title: "t", tags: [] }),
      ]
      assert.deepStrictEqual(getDistinctTagsFromEntries(entries), ["food", "recipes", "travel"])
    })

    test("empty entries", () => {
      assert.deepStrictEqual(getDistinctTagsFromEntries([]), [])
    })
  })

  describe("isTagPagePath", () => {
    test("detects tag pages under /tags/", () => {
      assert.strictEqual(isTagPagePath("/tags"), true)
      assert.strictEqual(isTagPagePath("/tags/"), true)
      assert.strictEqual(isTagPagePath("/tags/foo"), true)
      assert.strictEqual(isTagPagePath("/tags/foo/"), true)
      assert.strictEqual(isTagPagePath("/tags/index"), true)
      assert.strictEqual(isTagPagePath("/base/tags/foo"), true)
    })

    test("allows folder pages and non-tag paths", () => {
      assert.strictEqual(isTagPagePath("/"), false)
      assert.strictEqual(isTagPagePath("/folder/"), false)
      assert.strictEqual(isTagPagePath("/folder/index"), false)
      assert.strictEqual(isTagPagePath("/mytags/page"), false)
      assert.strictEqual(isTagPagePath("/tagsfoo"), false)
      assert.strictEqual(isTagPagePath("/index"), false)
      assert.strictEqual(isTagPagePath("/some/other"), false)
    })
  })

  describe("toFolderEntry", () => {
    function makeData(overrides: Record<string, unknown> = {}): QuartzPluginData {
      return {
        slug: "test" as FullSlug,
        frontmatter: { title: "Test Title", tags: ["a", "b"] },
        description: "A description",
        dates: { created: new Date("2024-01-01T00:00:00.000Z") },
        defaultDateType: "created",
        ...overrides,
      } as unknown as QuartzPluginData
    }

    test("maps slug, title, tags, date, description", () => {
      const data = makeData()
      const e = toFolderEntry(data)
      assert.strictEqual(e.slug, "test")
      assert.strictEqual(e.title, "Test Title")
      assert.deepStrictEqual(e.tags, ["a", "b"])
      assert.strictEqual(e.date, "2024-01-01T00:00:00.000Z")
      assert.strictEqual(e.description, "A description")
    })

    test("uses frontmatter description fallback", () => {
      const data = makeData({
        description: undefined,
        frontmatter: { title: "t", tags: [], description: "from frontmatter" },
      })
      const e = toFolderEntry(data)
      assert.strictEqual(e.description, "from frontmatter")
    })

    test("handles missing date", () => {
      const data = makeData({ dates: undefined, defaultDateType: undefined })
      const e = toFolderEntry(data)
      assert.strictEqual(e.date, null)
    })

    test("filters non-string tags", () => {
      const data = makeData({ frontmatter: { title: "t", tags: ["a", 123, null, "b"] } })
      const e = toFolderEntry(data)
      assert.deepStrictEqual(e.tags, ["a", "b"])
    })
  })
})
