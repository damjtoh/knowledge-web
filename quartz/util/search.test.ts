import test, { describe } from "node:test"
import assert from "node:assert"
import {
  parseSearchQuery,
  matchesTags,
  filterByTags,
  getFolderPath,
  getFolderDisplay,
  matchesTagSubstring,
  rankByTitleBoost,
} from "./search"

describe("search query parsing", () => {
  test("empty input", () => {
    assert.deepStrictEqual(parseSearchQuery(""), { tags: [], query: "" })
    assert.deepStrictEqual(parseSearchQuery("   "), { tags: [], query: "" })
  })

  test("plain query without tags", () => {
    assert.deepStrictEqual(parseSearchQuery("hello world"), {
      tags: [],
      query: "hello world",
    })
  })

  test("single tag: prefix", () => {
    assert.deepStrictEqual(parseSearchQuery("tag:recipes"), {
      tags: ["recipes"],
      query: "",
    })
  })

  test("tag: prefix case-insensitive", () => {
    assert.deepStrictEqual(parseSearchQuery("TAG:Recipes"), {
      tags: ["Recipes"],
      query: "",
    })
    assert.deepStrictEqual(parseSearchQuery("Tag:travel"), {
      tags: ["travel"],
      query: "",
    })
  })

  test("multiple tag: prefixes combine with AND", () => {
    const parsed = parseSearchQuery("tag:alpha tag:beta hello")
    assert.deepStrictEqual(parsed.tags, ["alpha", "beta"])
    assert.strictEqual(parsed.query, "hello")
  })

  test("tag: with query terms interleaved", () => {
    const parsed = parseSearchQuery("hello tag:alpha world tag:beta")
    assert.deepStrictEqual(parsed.tags, ["alpha", "beta"])
    assert.strictEqual(parsed.query, "hello world")
  })

  test("bare tag: ignored", () => {
    assert.deepStrictEqual(parseSearchQuery("tag:"), { tags: [], query: "" })
    assert.deepStrictEqual(parseSearchQuery("tag: hello"), {
      tags: [],
      query: "hello",
    })
  })

  test("hash prefix still supported", () => {
    assert.deepStrictEqual(parseSearchQuery("#recipes"), {
      tags: ["recipes"],
      query: "",
    })
    assert.deepStrictEqual(parseSearchQuery("#alpha #beta query"), {
      tags: ["alpha", "beta"],
      query: "query",
    })
  })

  test("mixed tag: and #", () => {
    assert.deepStrictEqual(parseSearchQuery("tag:alpha #beta hello"), {
      tags: ["alpha", "beta"],
      query: "hello",
    })
  })

  test("query with extra whitespace", () => {
    assert.deepStrictEqual(parseSearchQuery("  tag:foo   bar   baz  "), {
      tags: ["foo"],
      query: "bar baz",
    })
  })

  test("tag value preserves case but filtering is case-insensitive via matchesTags", () => {
    const parsed = parseSearchQuery("tag:Travel")
    assert.deepStrictEqual(parsed.tags, ["Travel"])
    // filtering should be case-insensitive
    assert.strictEqual(matchesTags(["travel"], parsed.tags), true)
    assert.strictEqual(matchesTags(["TRAVEL"], parsed.tags), true)
  })
})

describe("tag filtering (AND, case-insensitive)", () => {
  test("empty required tags matches all", () => {
    assert.strictEqual(matchesTags(["a", "b"], []), true)
    assert.strictEqual(matchesTags([], []), true)
  })

  test("single tag must be present case-insensitive", () => {
    assert.strictEqual(matchesTags(["recipes", "travel"], ["recipes"]), true)
    assert.strictEqual(matchesTags(["recipes", "travel"], ["RECIPES"]), true)
    assert.strictEqual(matchesTags(["recipes"], ["travel"]), false)
  })

  test("multiple required tags combine with AND", () => {
    assert.strictEqual(matchesTags(["alpha", "beta", "gamma"], ["alpha", "beta"]), true)
    assert.strictEqual(matchesTags(["alpha", "beta"], ["alpha", "beta", "gamma"]), false)
    assert.strictEqual(matchesTags(["alpha"], ["alpha", "beta"]), false)
  })

  test("filterByTags is pure and does not mutate", () => {
    const items = [
      { tags: ["alpha", "beta"], id: 1 },
      { tags: ["alpha"], id: 2 },
      { tags: ["beta", "gamma"], id: 3 },
    ]
    const copy = [...items]
    const filtered = filterByTags(items, ["alpha", "beta"])
    assert.strictEqual(filtered.length, 1)
    assert.strictEqual(filtered[0].id, 1)
    assert.deepStrictEqual(items, copy)
  })

  test("filterByTags with empty required returns copy", () => {
    const items = [{ tags: ["a"], id: 1 }]
    const filtered = filterByTags(items, [])
    assert.strictEqual(filtered.length, 1)
    assert.notStrictEqual(filtered, items)
  })
})

describe("folder path derivation", () => {
  test("top-level slug yields empty folder", () => {
    assert.strictEqual(getFolderPath("index"), "")
    assert.strictEqual(getFolderPath("notes"), "")
    assert.strictEqual(getFolderPath(""), "")
  })

  test("single folder", () => {
    assert.strictEqual(getFolderPath("notes/project-alpha"), "notes")
  })

  test("nested folders", () => {
    assert.strictEqual(getFolderPath("a/b/c/d"), "a/b/c")
    assert.strictEqual(getFolderPath("a/b/c"), "a/b")
  })

  test("folder/index", () => {
    assert.strictEqual(getFolderPath("notes/index"), "notes")
  })

  test("trailing slash", () => {
    assert.strictEqual(getFolderPath("notes/project/"), "notes")
  })

  test("getFolderDisplay mirrors getFolderPath", () => {
    assert.strictEqual(getFolderDisplay("notes/x"), "notes")
    assert.strictEqual(getFolderDisplay("index"), "")
  })
})

describe("tag substring matching", () => {
  test("matches when any tag contains query substring case-insensitive", () => {
    assert.strictEqual(matchesTagSubstring(["recipes", "travel"], "rec"), true)
    assert.strictEqual(matchesTagSubstring(["recipes", "travel"], "REC"), true)
    assert.strictEqual(matchesTagSubstring(["recipes"], "travel"), false)
  })

  test("empty query never matches", () => {
    assert.strictEqual(matchesTagSubstring(["a"], ""), false)
  })
})

describe("rankByTitleBoost", () => {
  test("title matches rank above content-only", () => {
    const items = [
      { title: "hello world", content: "hello" },
      { title: "other", content: "hello world" },
      { title: "hello test", content: "x" },
      { title: "nope", content: "y" },
    ]
    const ranked = rankByTitleBoost(items, "hello")
    assert.deepStrictEqual(
      ranked.map((r) => r.title),
      ["hello world", "hello test", "other", "nope"],
    )
  })

  test("stable within groups", () => {
    const items = [
      { title: "a hello", content: "" },
      { title: "b hello", content: "" },
      { title: "c", content: "" },
      { title: "d", content: "" },
    ]
    const ranked = rankByTitleBoost(items, "hello")
    assert.deepStrictEqual(
      ranked.map((r) => r.title),
      ["a hello", "b hello", "c", "d"],
    )
  })

  test("empty query preserves order", () => {
    const items = [{ title: "b" }, { title: "a" }]
    const ranked = rankByTitleBoost(items, "")
    assert.deepStrictEqual(ranked, items)
    assert.notStrictEqual(ranked, items)
  })

  test("case-insensitive", () => {
    const items = [{ title: "Hello" }, { title: "other" }]
    const ranked = rankByTitleBoost(items, "hello")
    assert.strictEqual(ranked[0].title, "Hello")
  })
})
