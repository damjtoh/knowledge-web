import test, { describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import type { Root as HastRoot, Element } from "hast"
import { VFile } from "vfile"
import { ContentMetadata, buildMetadataEntries } from "./contentMetadata"
import type { BuildCtx } from "../../util/ctx"
import type { ProcessedContent } from "../vfile"
import type { QuartzConfig } from "../../cfg"
import type { StaticResources } from "../../util/resources"
import { FilePath, FullSlug } from "../../util/path"

function createCtx(outputDir: string): BuildCtx {
  return {
    buildId: "test-build",
    argv: {
      directory: "content",
      verbose: false,
      output: outputDir,
      serve: false,
      watch: false,
      port: 0,
      wsPort: 0,
    },
    cfg: {
      configuration: {
        baseUrl: "example.com",
        pageTitle: "Test Site",
      },
    } as unknown as QuartzConfig,
    allSlugs: [],
    allFiles: [],
    incremental: false,
    virtualPages: [],
  }
}

function createResources(): StaticResources {
  return { css: [], js: [], additionalHead: [] }
}

interface PageOpts {
  slug: string
  title?: string
  tags?: string[]
  description?: string
  date?: Date
  unlisted?: boolean
}

function createPage(opts: PageOpts): ProcessedContent {
  const tree: HastRoot = {
    type: "root",
    children: [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [{ type: "text", value: "content" }],
      } as Element,
    ],
  }
  const vfile = new VFile("")
  const frontmatter: Record<string, unknown> = {
    title: opts.title ?? opts.slug,
    tags: opts.tags ?? [],
  }
  if (opts.description) frontmatter.description = opts.description
  const data: Record<string, unknown> = {
    slug: opts.slug as FullSlug,
    relativePath: `${opts.slug}.md` as FilePath,
    frontmatter,
    description: opts.description ?? "",
  }
  if (opts.date) {
    data.dates = { created: opts.date }
    data.defaultDateType = "created"
  }
  if (opts.unlisted) data.unlisted = true
  vfile.data = data
  return [tree, vfile]
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8")
  return JSON.parse(raw) as T
}

describe("contentMetadata emitter", () => {
  let outputDir: string

  beforeEach(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "content-metadata-test-"))
  })

  afterEach(async () => {
    await fs.rm(outputDir, { recursive: true, force: true })
  })

  test("buildMetadataEntries maps required fields", () => {
    const content: ProcessedContent[] = [
      createPage({
        slug: "alpha",
        title: "Alpha",
        tags: ["t1"],
        description: "desc",
        date: new Date("2024-01-02T00:00:00.000Z"),
      }),
    ]
    const entries = buildMetadataEntries(content)
    assert.strictEqual(entries.length, 1)
    const e = entries[0]!
    assert.strictEqual(e.slug, "alpha")
    assert.strictEqual(e.title, "Alpha")
    assert.deepStrictEqual(e.tags, ["t1"])
    assert.strictEqual(e.date, "2024-01-02T00:00:00.000Z")
    assert.strictEqual(e.description, "desc")
  })

  test("excludes unlisted pages", () => {
    const content: ProcessedContent[] = [
      createPage({ slug: "public", title: "Public" }),
      createPage({ slug: "hidden", title: "Hidden", unlisted: true }),
    ]
    const entries = buildMetadataEntries(content)
    assert.strictEqual(entries.length, 1)
    assert.strictEqual(entries[0]!.slug, "public")
  })

  test("deterministic stable order sorted by slug", () => {
    const content: ProcessedContent[] = [
      createPage({ slug: "zebra", title: "Z" }),
      createPage({ slug: "apple", title: "A" }),
      createPage({ slug: "mango", title: "M" }),
    ]
    const entries = buildMetadataEntries(content)
    assert.deepStrictEqual(
      entries.map((e) => e.slug),
      ["apple", "mango", "zebra"],
    )
    const entries2 = buildMetadataEntries(content.slice().reverse())
    assert.deepStrictEqual(
      entries2.map((e) => e.slug),
      ["apple", "mango", "zebra"],
    )
  })

  test("handles missing date as null and empty tags/description", () => {
    const content: ProcessedContent[] = [createPage({ slug: "no-date", title: "No Date" })]
    const entries = buildMetadataEntries(content)
    assert.strictEqual(entries[0]!.date, null)
    assert.deepStrictEqual(entries[0]!.tags, [])
    assert.strictEqual(entries[0]!.description, "")
  })

  test("emits static/contentMetadata.json with correct shape", async () => {
    const emitter = ContentMetadata()
    const content: ProcessedContent[] = [
      createPage({
        slug: "b",
        title: "B",
        tags: ["beta"],
        description: "desc b",
        date: new Date("2023-01-01T00:00:00.000Z"),
      }),
      createPage({ slug: "a", title: "A", tags: ["alpha"], description: "desc a" }),
    ]
    const ctx = createCtx(outputDir)
    const result = await emitter.emit(ctx, content, createResources())
    // handle both Promise and AsyncGenerator cases
    if (
      result &&
      typeof (result as unknown as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
        "function"
    ) {
      for await (const _ of result as AsyncGenerator<string>) {
        // consume
      }
    }
    const json = await readJson<
      Array<{
        slug: string
        title: string
        tags: string[]
        date: string | null
        description: string
      }>
    >(path.join(outputDir, "static", "contentMetadata.json"))
    assert.strictEqual(json.length, 2)
    // sorted by slug
    assert.strictEqual(json[0]!.slug, "a")
    assert.strictEqual(json[1]!.slug, "b")
    assert.ok(
      "title" in json[0]! && "tags" in json[0]! && "date" in json[0]! && "description" in json[0]!,
    )
    // b has date
    assert.strictEqual(json[1]!.date, "2023-01-01T00:00:00.000Z")
    assert.strictEqual(json[0]!.date, null)
  })

  test("public-safe: only frontmatter-derived fields", () => {
    const content: ProcessedContent[] = [
      createPage({
        slug: "test",
        title: "Test",
        tags: ["t"],
        description: "ok",
        date: new Date("2024-01-01T00:00:00.000Z"),
      }),
    ]
    // add vault-specific field that should NOT appear in output
    const [, vfile] = content[0]!
    ;(vfile.data as Record<string, unknown>).filePath = "/vault/secret/path.md"
    ;(vfile.data as Record<string, unknown>).vaultSecret = "should not leak"
    const entries = buildMetadataEntries(content)
    const keys = Object.keys(entries[0]!)
    assert.deepStrictEqual(new Set(keys), new Set(["slug", "title", "tags", "date", "description"]))
  })

  test("empty content yields empty array", () => {
    const entries = buildMetadataEntries([])
    assert.deepStrictEqual(entries, [])
  })
})
