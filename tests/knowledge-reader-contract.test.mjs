/**
 * Knowledge reader static contract (no build, no vault required).
 *
 * Guards the publication boundary at the source level:
 * - C1: the reader consumes only isolated staged content plus generated site
 *   metadata; it declares no Knowledge Base, vault, or manifest input.
 * - C2: Fumadocs MDX/Core is the headless content source; no Fumadocs UI is
 *   used or depended on.
 * - C3: the Next.js config emits a serverless static export.
 *
 * Run with: npm test -- tests/knowledge-reader-contract.test.mjs
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

test("the reader reads environment only for staged content and site metadata (C1)", () => {
  const allowed = new Set(["READER_CONTENT_DIR", "READER_SITE_METADATA_FILE"])

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

test("nginx prevents edge rewrites of integrity-checked reader pages", () => {
  const config = fs.readFileSync(path.join(READER_ROOT, "..", "nginx.conf"), "utf8")
  const rootLocation = config.match(/location \/ \{([^}]*)\}/)?.[1] ?? ""
  assert.match(rootLocation, /try_files \$uri \$uri\.html/, "reader keeps extensionless routes")
  assert.match(
    rootLocation,
    /add_header Cache-Control "no-transform";/,
    "Cloudflare must not change exported HTML after Workbox hashes it",
  )
})

test("docTitle reads the pipeline title with a filename fallback", () => {
  assert.equal(docTitle({ title: "Field Guide" }, ["notes", "x"]), "Field Guide")
  assert.equal(docTitle({ title: "  Fixture Garden  " }, ["index"]), "Fixture Garden")
  assert.equal(docTitle({}, ["notes", "upcoming", "x"]), "x")
  assert.equal(docTitle({ title: "" }, ["standalone"]), "standalone")
  assert.equal(docTitle({ title: "   " }, ["standalone"]), "standalone")
  assert.equal(docTitle(null, ["orchard", "note-01"]), "note-01")
  assert.equal(docTitle("Field Guide", ["x"]), "x")
  assert.equal(docTitle({}, []), "index")
})
