/**
 * Shared reader static contract (no build, no vault required).
 *
 * Guards the publication boundary at the source level:
 * - C1: the reader consumes only isolated staged content plus generated site
 *   identity; it declares no Knowledge Base, vault, or manifest input.
 * - C2: Fumadocs MDX/Core is the headless content source; no Fumadocs UI is
 *   used or depended on.
 * - C3: the Next.js config emits a serverless static export.
 *
 * Run with: node --test tests/shared-reader-contract.test.mjs
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { docTitle } from "../reader/lib/title.ts"

const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")
const READER_ROOT = path.join(PUBLISHER_ROOT, "reader")
const READER_SOURCES = ["source.config.ts", "next.config.mjs"]
  .map((file) => path.join(READER_ROOT, file))
  .concat(
    ["app", "lib", "components"].flatMap((dir) => {
      const abs = path.join(READER_ROOT, dir)
      if (!fs.existsSync(abs)) return []
      return fs
        .readdirSync(abs, { recursive: true })
        .filter((entry) => /\.(ts|tsx|mjs|css)$/.test(entry))
        .map((entry) => path.join(abs, entry))
    }),
  )

function readSources() {
  return READER_SOURCES.map((file) => ({
    file: path.relative(PUBLISHER_ROOT, file),
    text: fs.readFileSync(file, "utf8"),
  }))
}

test("the reader declares no Knowledge Base, vault, or manifest input (C1)", () => {
  const forbidden = [
    "--kb-root",
    "--vault",
    "--manifest",
    "publication.manifest.yaml",
    "/Sites/",
    "kb-root",
    "vault-root",
    "original-vault",
    "source-vault",
  ]
  for (const { file, text } of readSources()) {
    for (const token of forbidden) {
      assert.ok(
        !text.includes(token),
        `${file} must not reference vault discovery input (${token})`,
      )
    }
  }
})

test("the reader reads environment only for staged content and site identity (C1)", () => {
  const allowed = new Set(["SHARED_CONTENT_DIR", "SHARED_IDENTITY_FILE"])
  for (const { file, text } of readSources()) {
    for (const match of text.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) {
      assert.ok(allowed.has(match[1]), `${file} reads unexpected env var ${match[1]}`)
    }
  }
})

test("Fumadocs MDX/Core is the content source and no Fumadocs UI is used (C2)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(READER_ROOT, "package.json"), "utf8"))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  assert.ok(deps["fumadocs-core"], "reader depends on fumadocs-core")
  assert.ok(deps["fumadocs-mdx"], "reader depends on fumadocs-mdx")
  assert.ok(!deps["fumadocs-ui"], "reader must not depend on fumadocs-ui")

  const texts = readSources()
  const usesHeadlessSource =
    texts.some(({ text }) => text.includes("fumadocs-core/source")) &&
    texts.some(({ text }) => text.includes("fumadocs-mdx"))
  assert.ok(usesHeadlessSource, "reader sources use the headless Fumadocs content source")
  for (const { file, text } of texts) {
    assert.ok(!text.includes("fumadocs-ui"), `${file} must not use Fumadocs UI`)
  }
})

test("Next.js emits a serverless static export (C3)", () => {
  const config = fs.readFileSync(path.join(READER_ROOT, "next.config.mjs"), "utf8")
  assert.match(config, /output:\s*["']export["']/, "next config must set output: 'export'")
})

test("docTitle reads the pipeline title with a filename fallback", () => {
  assert.equal(docTitle({ title: "Terradets" }, ["travel", "x"]), "Terradets")
  assert.equal(docTitle({ title: "  Shared Vault  " }, ["index"]), "Shared Vault")
  assert.equal(docTitle({}, ["travel", "upcoming", "x"]), "x")
  assert.equal(docTitle({ title: "" }, ["inbox"]), "inbox")
  assert.equal(docTitle({ title: "   " }, ["inbox"]), "inbox")
  assert.equal(docTitle(null, ["pets", "otto"]), "otto")
  assert.equal(docTitle("Terradets", ["x"]), "x")
  assert.equal(docTitle({}, []), "index")
})
