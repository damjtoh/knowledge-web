import test, { describe, beforeEach, afterEach } from "node:test"
import assert from "node:assert"
import fs from "fs"
import path from "path"
import os from "os"
import { resolveLocalAbsolute } from "./plugin-git-handlers.js"

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "quartz-plugin-local-test-"))
}

describe("resolveLocalAbsolute", () => {
  let tmpRoot

  beforeEach(() => {
    tmpRoot = makeTmpDir()
  })

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  })

  test("resolves string relative local source without subdir", () => {
    const entry = { resolved: "./plugins/knowledge-vault" }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, path.resolve("./plugins/knowledge-vault"))
  })

  test("resolves object-form local source without subdir (regression: path.isAbsolute on object)", () => {
    const entry = { resolved: { repo: "./plugins/knowledge-vault" } }
    assert.doesNotThrow(() => resolveLocalAbsolute(entry))
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, path.resolve("./plugins/knowledge-vault"))
  })

  test("resolves object-form source via entry.source fallback", () => {
    const entry = { source: { repo: "./plugins/knowledge-vault" } }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, path.resolve("./plugins/knowledge-vault"))
  })

  test("appends entry.subdir for portable local lock entry (string source)", () => {
    const entry = { resolved: "./plugins/knowledge-vault", subdir: "packages/foo" }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, path.join(path.resolve("./plugins/knowledge-vault"), "packages/foo"))
  })

  test("appends subdir from object-form source when entry.subdir missing", () => {
    const entry = { resolved: { repo: "./plugins/knowledge-vault", subdir: "packages/foo" } }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, path.join(path.resolve("./plugins/knowledge-vault"), "packages/foo"))
  })

  test("appends subdir from entry.source object when resolved is string without subdir", () => {
    const entry = {
      resolved: "./plugins/knowledge-vault",
      source: { repo: "./plugins/knowledge-vault", subdir: "nested/dir" },
    }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, path.join(path.resolve("./plugins/knowledge-vault"), "nested/dir"))
  })

  test("appends entry.subdir even when resolved is absolute and target exists", () => {
    const base = path.join(tmpRoot, "my-plugin")
    const sub = path.join(base, "subdir")
    fs.mkdirSync(sub, { recursive: true })
    const entry = { resolved: base, subdir: "subdir" }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, sub)
  })

  test("appends subdir for absolute object-form source", () => {
    const base = path.join(tmpRoot, "obj-plugin")
    const sub = path.join(base, "pkg")
    fs.mkdirSync(sub, { recursive: true })
    const entry = { resolved: { repo: base, subdir: "pkg" } }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, sub)
  })

  test("resolves absolute object-form without throwing and appends subdir via entry.subdir", () => {
    const base = path.join(tmpRoot, "abs-obj")
    const sub = path.join(base, "extra")
    fs.mkdirSync(sub, { recursive: true })
    const entry = { resolved: { repo: base }, subdir: "extra" }
    assert.doesNotThrow(() => resolveLocalAbsolute(entry))
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, sub)
  })

  test("falls back to entry.source when absolute resolved missing but source exists (with subdir)", () => {
    const missingBase = path.join(tmpRoot, "missing")
    const existingBase = path.join(tmpRoot, "existing")
    const existingSub = path.join(existingBase, "sub")
    fs.mkdirSync(existingSub, { recursive: true })
    const entry = {
      resolved: missingBase,
      source: { repo: existingBase, subdir: "sub" },
      subdir: "sub",
    }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, existingSub)
  })

  test("returns null when no resolved or source", () => {
    const result = resolveLocalAbsolute({})
    assert.equal(result, null)
  })

  test("handles object with name override without throwing", () => {
    const entry = { resolved: { repo: "./plugins/knowledge-vault", name: "custom-name" } }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, path.resolve("./plugins/knowledge-vault"))
  })

  test("handles object with name and subdir together", () => {
    const entry = {
      resolved: { repo: "./plugins/knowledge-vault", name: "custom", subdir: "src" },
      subdir: "src",
    }
    const result = resolveLocalAbsolute(entry)
    assert.equal(result, path.join(path.resolve("./plugins/knowledge-vault"), "src"))
  })
})
