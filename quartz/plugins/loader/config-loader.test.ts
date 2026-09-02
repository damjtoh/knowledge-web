import assert from "node:assert/strict"
import test from "node:test"
import { findFactory } from "./config-loader.js"

test("findFactory selects via quartzCategory without invoking candidates", () => {
  let transformerCalls = 0
  function TransformerFactory(_opts?: unknown) {
    transformerCalls++
    return { name: "Transformer", markdownPlugins: () => [] as unknown[] }
  }
  ;(TransformerFactory as unknown as Record<string, unknown>).quartzCategory = "transformer"

  let pageTypeCalls = 0
  function PageTypeFactory(_opts?: unknown) {
    pageTypeCalls++
    return {
      name: "PageType",
      match: () => true,
      generate: () => [],
      layout: "collection",
      body: () => () => null as unknown,
    }
  }
  ;(PageTypeFactory as unknown as Record<string, unknown>).quartzCategory = "pageType"

  const mod: Record<string, unknown> = {
    default: TransformerFactory,
    Collections: PageTypeFactory,
  }

  const selTransformer = findFactory(mod, "transformer")
  assert.equal(transformerCalls, 0, "findFactory must not invoke transformer candidate")
  assert.equal(pageTypeCalls, 0, "findFactory must not invoke pageType candidate")
  assert.equal(selTransformer, TransformerFactory, "transformer selection via marker")

  const _inst = (selTransformer as unknown as (o?: unknown) => unknown)()
  assert.equal(transformerCalls, 1, "selected transformer factory executes exactly once")
  assert.equal(pageTypeCalls, 0, "non-selected factory must not execute")
  void _inst

  // second selection
  transformerCalls = 0
  pageTypeCalls = 0
  const selPageType = findFactory(mod, "pageType")
  assert.equal(transformerCalls, 0, "findFactory must not invoke transformer for pageType")
  assert.equal(pageTypeCalls, 0, "findFactory must not invoke pageType during discovery")
  assert.equal(selPageType, PageTypeFactory, "pageType selection via marker")

  const _inst2 = (selPageType as unknown as (o?: unknown) => unknown)()
  assert.equal(pageTypeCalls, 1, "selected pageType factory executes exactly once")
  assert.equal(transformerCalls, 0, "non-selected transformer must not execute")
  void _inst2
})

test("findFactory preserves single-candidate behavior without invoking", () => {
  let calls = 0
  function SoloFactory(_opts?: unknown) {
    calls++
    return { name: "Solo", markdownPlugins: () => [] as unknown[] }
  }
  const mod: Record<string, unknown> = { default: SoloFactory }
  const sel = findFactory(mod, "transformer")
  assert.equal(calls, 0, "single candidate must not be invoked during discovery")
  assert.equal(sel, SoloFactory)
  const _inst = (sel as unknown as (o?: unknown) => unknown)()
  assert.equal(calls, 1, "single factory executes exactly once after instantiate")
  void _inst
})

test("findFactory falls back to single probing for multi-export without marker", () => {
  let aCalls = 0
  function AFactory() {
    aCalls++
    return { name: "A", markdownPlugins: () => [] as unknown[] }
  }
  let bCalls = 0
  function BFactory() {
    bCalls++
    return { name: "B", match: () => true, generate: () => [], layout: "x", body: () => () => null }
  }
  const mod: Record<string, unknown> = { default: AFactory, BFactory }
  const sel = findFactory(mod, "pageType")
  // Without marker, fallback probes each candidate once; A does not match pageType, B does
  assert.equal(aCalls, 1, "probed AFactory once")
  assert.equal(bCalls, 1, "probed BFactory once")
  assert.equal(sel, BFactory, "should select BFactory via probing")
  // Probing counts as one execution; actual instantiation will be second, so total two
  // Marker path (first test) proves exactly-once for Knowledge Vault
})

test("Knowledge Vault factories expose static category markers", async () => {
  const kv = await import("../../../plugins/knowledge-vault/dist/index.js")
  assert.equal(
    (kv.KnowledgeVault as unknown as Record<string, unknown>).quartzCategory,
    "transformer",
  )
  assert.equal((kv.Collections as unknown as Record<string, unknown>).quartzCategory, "pageType")
  assert.equal((kv.default as unknown as Record<string, unknown>).quartzCategory, "transformer")
})

test("findFactory prefers explicit marker over shape probing even when both candidates could match shape", () => {
  // Ensure that without marker probing would have needed invocation, but marker prevents it
  let sideEffect = 0
  function TransformerWithSideEffect() {
    sideEffect++
    if (sideEffect > 1) throw new Error("side effect repeated")
    return { name: "Transformer", markdownPlugins: () => [] as unknown[] }
  }
  ;(TransformerWithSideEffect as unknown as Record<string, unknown>).quartzCategory = "transformer"

  function PageTypeWithSideEffect() {
    sideEffect++
    if (sideEffect > 1) throw new Error("side effect repeated")
    return {
      name: "PageType",
      match: () => true,
      generate: () => [],
      layout: "x",
      body: () => () => null,
    }
  }
  ;(PageTypeWithSideEffect as unknown as Record<string, unknown>).quartzCategory = "pageType"

  const mod: Record<string, unknown> = {
    default: TransformerWithSideEffect,
    Collections: PageTypeWithSideEffect,
  }

  const t = findFactory(mod, "transformer")
  assert.equal(sideEffect, 0, "no side effect during transformer discovery")
  ;(t as unknown as () => unknown)()
  assert.equal(sideEffect, 1)

  sideEffect = 0
  const p = findFactory(mod, "pageType")
  assert.equal(sideEffect, 0, "no side effect during pageType discovery")
  ;(p as unknown as () => unknown)()
  assert.equal(sideEffect, 1)
})
