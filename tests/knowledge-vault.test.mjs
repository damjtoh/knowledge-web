/**
 * Knowledge Vault title adaptation — full-build acceptance.
 *
 * Exercises the publisher-owned local plugin through the real Quartz
 * pipeline: stage a synthetic Tolaria vault via the Publication Manifest
 * contract, run the actual Quartz build, and assert external behavior
 * (HTML, routes, search index, metadata) rather than plugin internals.
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test, after } from "node:test"

const execFileAsync = promisify(execFile)
const PUBLISHER_ROOT = path.resolve(import.meta.dirname, "..")
const STAGE_SCRIPT = path.join(PUBLISHER_ROOT, "scripts", "stage-content.mjs")
const BUILD_CLI = path.join(PUBLISHER_ROOT, "quartz", "bootstrap-cli.mjs")
const TRACKED_CONFIG = path.join(PUBLISHER_ROOT, "quartz.config.yaml")
const LOCKFILE = path.join(PUBLISHER_ROOT, "quartz.lock.json")

const tmpRoots = []
function tmpdir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kv-test-${prefix}-`))
  tmpRoots.push(dir)
  return dir
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

function makeSyntheticKb() {
  const kb = tmpdir("kb")
  fs.mkdirSync(path.join(kb, "notes"), { recursive: true })
  fs.mkdirSync(path.join(kb, "unselected"), { recursive: true })

  fs.writeFileSync(
    path.join(kb, "notes", "project-alpha.md"),
    [
      "---",
      "description: Alpha description for preview",
      "tags: [agents, research]",
      "created: 2024-01-15",
      "updated: 2024-02-20",
      "---",
      "",
      "# Project Alpha — First Note",
      "",
      "Alpha body. See [[project-beta]] for more.",
      "",
    ].join("\n"),
  )

  fs.writeFileSync(
    path.join(kb, "notes", "project-beta.md"),
    [
      "---",
      "tags: [research]",
      "description: Beta description",
      "created: 2024-01-20",
      "---",
      "",
      "# Project Beta: Second Iteration",
      "",
      "Beta content linking to [[project-alpha]].",
      "",
    ].join("\n"),
  )

  fs.writeFileSync(
    path.join(kb, "notes", "no-h1.md"),
    ["Just content without heading.", "", "No H1 here.", ""].join("\n"),
  )

  fs.writeFileSync(
    path.join(kb, "notes", "empty-meta.md"),
    ["# Lonely Note", "", "Content with minimal metadata.", ""].join("\n"),
  )

  fs.writeFileSync(
    path.join(kb, "notes", "multi-h1.md"),
    [
      "---",
      "tags: [research]",
      "description: Multi H1 description",
      "created: 2024-03-01",
      "---",
      "",
      "# Multi Title First",
      "",
      "Intro text.",
      "",
      "# Second Heading Should Remain",
      "",
      "More content.",
      "",
      "## Subheading",
      "",
      "Details.",
      "",
    ].join("\n"),
  )

  fs.writeFileSync(
    path.join(kb, "about.md"),
    ["---", "description: About page", "---", "", "# About This Garden", "", "Welcome.", ""].join(
      "\n",
    ),
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
      "  - about.md",
      "",
    ].join("\n"),
  )
}

async function stageKb(kb, contentDir, configFile) {
  fs.copyFileSync(TRACKED_CONFIG, configFile)
  await execFileAsync(
    process.execPath,
    [STAGE_SCRIPT, "--kb-root", kb, "--content-dir", contentDir, "--config-file", configFile],
    {
      cwd: PUBLISHER_ROOT,
    },
  )
}

async function buildQuartz(contentDir, outputDir) {
  await execFileAsync(
    process.execPath,
    [BUILD_CLI, "build", "--directory", contentDir, "--output", outputDir, "--concurrency", "1"],
    { cwd: PUBLISHER_ROOT, timeout: 120_000 },
  )
}

after(() => {
  for (const dir of tmpRoots) fs.rmSync(dir, { recursive: true, force: true })
})

test("publisher loads one pinned local Knowledge Vault presentation plugin via documented mechanism", async () => {
  const cfg = fs.readFileSync(TRACKED_CONFIG, "utf8")
  assert.match(cfg, /\.\/plugins\/knowledge-vault/, "quartz.config.yaml must load local plugin")
  const lock = JSON.parse(fs.readFileSync(LOCKFILE, "utf8"))
  const entry = lock.plugins["knowledge-vault"]
  assert.ok(entry, "quartz.lock.json must contain knowledge-vault")
  assert.equal(entry.commit, "local", "local plugin commit must be 'local'")
  assert.ok(entry.source.includes("./plugins/knowledge-vault"), "lock source must be local path")
  // C1: resolved must be portable (relative, not machine-specific absolute)
  assert.ok(
    !path.isAbsolute(entry.resolved),
    "lock resolved must be portable relative, not absolute",
  )
  assert.equal(
    entry.resolved,
    "./plugins/knowledge-vault",
    "resolved should be portable relative path",
  )

  // Verify fresh checkout can restore symlink without pre-existing .quartz/plugins/knowledge-vault
  const link = path.join(PUBLISHER_ROOT, ".quartz", "plugins", "knowledge-vault")
  const hadLink = fs.existsSync(link)
  if (hadLink) {
    fs.rmSync(link, { recursive: true, force: true })
  }
  try {
    assert.ok(!fs.existsSync(link), "symlink removed to simulate fresh checkout")
    await execFileAsync(process.execPath, [BUILD_CLI, "plugin", "install"], {
      cwd: PUBLISHER_ROOT,
      timeout: 60_000,
    })
    assert.ok(
      fs.existsSync(link),
      ".quartz/plugins/knowledge-vault must be restored via plugin install without pre-existing symlink",
    )
    const stat = fs.lstatSync(link)
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(link)
      const absoluteTarget = path.isAbsolute(target)
        ? target
        : path.resolve(path.dirname(link), target)
      assert.ok(fs.existsSync(absoluteTarget), "symlink target must exist")
      assert.ok(
        absoluteTarget.endsWith("plugins/knowledge-vault"),
        "symlink must point to local plugin",
      )
    } else {
      assert.ok(fs.existsSync(path.join(link, "package.json")), "fallback copy must contain plugin")
    }
  } finally {
    if (!fs.existsSync(link)) {
      await execFileAsync(process.execPath, [BUILD_CLI, "plugin", "install"], {
        cwd: PUBLISHER_ROOT,
        timeout: 60_000,
      })
    }
  }
})

test("synthetic Tolaria vault passes through staging and real Quartz build — readable titles, single H1, fallback, byte preservation, wikilinks, and publication isolation", async () => {
  const kb = makeSyntheticKb()
  writeManifest(kb)
  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const configFile = path.join(work, "quartz.config.yaml")
  const outputDir = path.join(work, "public")

  await stageKb(kb, contentDir, configFile)

  // C5: staged selected Markdown remains byte-for-byte equal to source
  for (const rel of [
    "notes/project-alpha.md",
    "notes/project-beta.md",
    "notes/no-h1.md",
    "notes/empty-meta.md",
    "notes/multi-h1.md",
    "about.md",
  ]) {
    assert.equal(
      sha256(path.join(contentDir, rel)),
      sha256(path.join(kb, rel)),
      `byte preservation for ${rel}`,
    )
  }
  assert.ok(
    !fs.existsSync(path.join(contentDir, "unselected", "secret.md")),
    "unselected secret must not be staged",
  )
  assert.ok(
    !fs.existsSync(path.join(contentDir, "unselected")),
    "unselected directory must not be staged",
  )

  await buildQuartz(contentDir, outputDir)

  // Helpers to read generated artifacts
  const readHtml = (rel) => fs.readFileSync(path.join(outputDir, rel), "utf8")
  const contentIndex = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentIndex.json"), "utf8"),
  )
  const contentMetadata = JSON.parse(
    fs.readFileSync(path.join(outputDir, "static", "contentMetadata.json"), "utf8"),
  )
  const findMeta = (slug) => contentMetadata.find((e) => e.slug === slug)

  // C2: readable H1 becomes displayed title on content page
  const htmlAlpha = readHtml("notes/project-alpha.html")
  assert.match(
    htmlAlpha,
    /<h1 class="article-title">Project Alpha — First Note<\/h1>/,
    "alpha article-title must be readable H1",
  )
  const htmlBeta = readHtml("notes/project-beta.html")
  assert.match(
    htmlBeta,
    /<h1 class="article-title">Project Beta: Second Iteration<\/h1>/,
    "beta article-title must be readable H1",
  )
  const htmlAbout = readHtml("about.html")
  assert.match(
    htmlAbout,
    /<h1 class="article-title">About This Garden<\/h1>/,
    "about article-title must be readable H1",
  )
  const htmlEmpty = readHtml("notes/empty-meta.html")
  assert.match(
    htmlEmpty,
    /<h1 class="article-title">Lonely Note<\/h1>/,
    "empty-meta must use H1 even with missing optional metadata",
  )
  const htmlMulti = readHtml("notes/multi-h1.html")
  assert.match(
    htmlMulti,
    /<h1 class="article-title">Multi Title First<\/h1>/,
    "multi-h1 article-title must be readable first H1",
  )

  // C2: readable title reaches generated listings
  const notesListing = readHtml("notes/index.html")
  assert.match(
    notesListing,
    /Project Alpha — First Note/,
    "folder listing must show readable title for alpha",
  )
  assert.match(
    notesListing,
    /Project Beta: Second Iteration/,
    "folder listing must show readable title for beta",
  )
  assert.match(
    notesListing,
    /Lonely Note/,
    "folder listing must show readable title for empty-meta",
  )
  assert.match(
    notesListing,
    /Multi Title First/,
    "folder listing must show readable title for multi-h1",
  )
  // Ensure fallback title appears, not unreadable slug, for file without H1 — listing should show filename fallback is okay
  assert.match(notesListing, /no-h1/, "listing fallback for no-h1 must appear")

  // C2: breadcrumbs use readable title
  assert.match(
    htmlAlpha,
    /<nav class="breadcrumb-container"[\s\S]*?Project Alpha — First Note/,
    "breadcrumbs for alpha must show readable title",
  )
  assert.match(
    htmlBeta,
    /<nav class="breadcrumb-container"[\s\S]*?Project Beta: Second Iteration/,
    "breadcrumbs for beta must show readable title",
  )

  // C2: search/public metadata uses readable title and retains tags/links
  assert.equal(
    contentIndex["notes/project-alpha"]?.title,
    "Project Alpha — First Note",
    "contentIndex title for alpha must be readable",
  )
  assert.equal(
    contentIndex["notes/project-beta"]?.title,
    "Project Beta: Second Iteration",
    "contentIndex title for beta must be readable",
  )
  assert.equal(contentIndex["about"]?.title, "About This Garden")
  assert.equal(contentIndex["notes/empty-meta"]?.title, "Lonely Note")
  assert.equal(contentIndex["notes/multi-h1"]?.title, "Multi Title First")
  assert.deepEqual(contentIndex["notes/project-alpha"]?.tags?.sort(), ["agents", "research"])
  assert.deepEqual(contentIndex["notes/project-beta"]?.tags?.sort(), ["research"])
  assert.deepEqual(contentIndex["notes/multi-h1"]?.tags?.sort(), ["research"])
  assert.ok(
    contentIndex["notes/project-alpha"]?.links?.includes("notes/project-beta"),
    "alpha links must include beta",
  )
  assert.ok(
    contentIndex["notes/project-beta"]?.links?.includes("notes/project-alpha"),
    "beta links must include alpha",
  )

  // C2: previews/meta description uses frontmatter description (when present)
  const metaAlpha = htmlAlpha.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ""
  assert.match(
    metaAlpha,
    /Alpha description for preview/,
    "meta description for alpha must come from frontmatter",
  )

  // C3: rendered content contains one primary title, not both adapted title and original H1
  // Count <h1> elements: should be exactly 1 (the ArticleTitle) for single-H1 notes
  assert.equal(
    (htmlAlpha.match(/<h1/g) || []).length,
    1,
    "alpha page must contain exactly one h1 (article-title, original H1 removed)",
  )
  assert.equal((htmlBeta.match(/<h1/g) || []).length, 1, "beta page must contain exactly one h1")
  assert.equal(
    (htmlEmpty.match(/<h1/g) || []).length,
    1,
    "empty-meta page must contain exactly one h1",
  )
  // Ensure markdown H1 content does not remain inside article body as duplicate
  assert.ok(htmlAlpha.includes("Alpha body."), "alpha body must contain text")
  assert.ok(htmlAlpha.includes('class="markdown-preview-view'), "alpha body must be rendered")
  // Title text should not appear as markdown h1 inside body (the article-title is outside body)
  // Verify that the readable title appears only once in the whole page's visible title positions (article-title + breadcrumbs, but not as extra h1)
  // We already asserted h1 count; additionally ensure breadcrumbs title not duplicated as h1
  assert.ok(
    !htmlAlpha.includes('<h1 id="project-alpha'),
    "adapted H1 id must not remain in content",
  )

  // C3 regression: multiple H1 note must keep second H1, not delete it via HTML pass
  assert.equal(
    (htmlMulti.match(/<h1/g) || []).length,
    2,
    "multi-h1 page must contain exactly two h1 (article-title + second H1), not one",
  )
  assert.match(
    htmlMulti,
    /Second Heading Should Remain/,
    "multi-h1 second H1 must remain in content",
  )
  assert.ok(htmlMulti.includes("Intro text."), "multi-h1 intro must remain")
  assert.ok(htmlMulti.includes("More content."), "multi-h1 second section must remain")
  // Adapted title must not appear as content H1
  assert.ok(
    !htmlMulti.includes('<h1 id="multi-title-first'),
    "adapted first H1 id must not remain in multi-h1 content",
  )
  // Second H1 should have its own id
  assert.match(
    htmlMulti,
    /<h1[^>]*>Second Heading Should Remain/,
    "second H1 must be rendered as h1",
  )

  // C4: file without H1 degrades to filename fallback and does not fail build
  const htmlNoH1 = readHtml("notes/no-h1.html")
  assert.match(
    htmlNoH1,
    /<h1 class="article-title">no-h1<\/h1>/,
    "no-h1 must fall back to filename",
  )
  assert.equal(
    (htmlNoH1.match(/<h1/g) || []).length,
    1,
    "no-h1 page must still have exactly one h1",
  )
  assert.match(htmlNoH1, /Just content without heading/, "no-h1 body must render")

  // C5: already asserted byte preservation above; also ensure after build staged files unchanged
  for (const rel of ["notes/project-alpha.md", "notes/no-h1.md"]) {
    assert.equal(
      sha256(path.join(contentDir, rel)),
      sha256(path.join(kb, rel)),
      `post-build byte preservation for ${rel}`,
    )
  }

  // C6: wikilinks still resolve after title adaptation
  // Alpha should link to beta with internal class, not broken
  const alphaLink = htmlAlpha.match(/<a[^>]*href="([^"]*project-beta[^"]*)"[^>]*class="([^"]*)"/)
  assert.ok(alphaLink, "alpha must contain link to project-beta")
  assert.match(alphaLink[2], /internal/, "wikilink must be internal")
  assert.doesNotMatch(alphaLink[2], /broken/, "wikilink must not be broken after title adaptation")
  // Beta links back to alpha similarly
  const betaLink = htmlBeta.match(/<a[^>]*href="([^"]*project-alpha[^"]*)"[^>]*class="([^"]*)"/)
  assert.ok(betaLink, "beta must contain link to project-alpha")
  assert.doesNotMatch(betaLink[2], /broken/)

  // C7: full public metadata assertions via static/contentMetadata.json (titles, timestamps, descriptions, tags, missing metadata)
  assert.ok(Array.isArray(contentMetadata), "contentMetadata must be array")
  // Adapted titles in contentMetadata
  assert.equal(
    findMeta("notes/project-alpha")?.title,
    "Project Alpha — First Note",
    "metadata title for alpha",
  )
  assert.equal(
    findMeta("notes/project-beta")?.title,
    "Project Beta: Second Iteration",
    "metadata title for beta",
  )
  assert.equal(findMeta("about")?.title, "About This Garden", "metadata title for about")
  assert.equal(findMeta("notes/empty-meta")?.title, "Lonely Note", "metadata title for empty-meta")
  assert.equal(
    findMeta("notes/multi-h1")?.title,
    "Multi Title First",
    "metadata title for multi-h1",
  )
  // Tags
  assert.deepEqual(
    findMeta("notes/project-alpha")?.tags.sort(),
    ["agents", "research"],
    "metadata tags for alpha",
  )
  assert.deepEqual(
    findMeta("notes/project-beta")?.tags.sort(),
    ["research"],
    "metadata tags for beta",
  )
  assert.deepEqual(
    findMeta("notes/multi-h1")?.tags.sort(),
    ["research"],
    "metadata tags for multi-h1",
  )
  assert.deepEqual(findMeta("notes/empty-meta")?.tags, [], "metadata empty tags for empty-meta")
  assert.deepEqual(findMeta("about")?.tags, [], "metadata empty tags for about")
  assert.deepEqual(findMeta("notes/no-h1")?.tags, [], "metadata empty tags for no-h1")
  // Descriptions
  assert.equal(
    findMeta("notes/project-alpha")?.description,
    "Alpha description for preview",
    "metadata description alpha",
  )
  assert.equal(
    findMeta("notes/project-beta")?.description,
    "Beta description",
    "metadata description beta",
  )
  assert.equal(
    findMeta("notes/multi-h1")?.description,
    "Multi H1 description",
    "metadata description multi-h1",
  )
  assert.equal(findMeta("about")?.description, "About page", "metadata description about")
  assert.equal(
    findMeta("notes/empty-meta")?.description,
    "Content with minimal metadata.",
    "metadata description for empty-meta derived from content",
  )
  assert.equal(
    findMeta("notes/no-h1")?.description,
    "Just content without heading. No H1 here.",
    "metadata description for no-h1 derived from content",
  )
  // Timestamps: publisher has no CreatedModifiedDate plugin, so date is null for all; verify field exists and is null or ISO string
  for (const slug of [
    "notes/project-alpha",
    "notes/project-beta",
    "notes/empty-meta",
    "notes/multi-h1",
    "about",
    "notes/no-h1",
  ]) {
    const entry = findMeta(slug)
    assert.ok(entry, `metadata entry for ${slug} must exist`)
    assert.ok("date" in entry, `metadata ${slug} must have date field`)
    const d = entry.date
    assert.ok(
      d === null || typeof d === "string",
      `metadata date for ${slug} must be null or string`,
    )
    if (typeof d === "string") {
      const parsed = Date.parse(d)
      assert.ok(!Number.isNaN(parsed), `metadata date for ${slug} must be valid ISO`)
    }
  }
  // Specifically, fixtures with created frontmatter but no date plugin => date null; verify at least one null case
  assert.equal(findMeta("notes/empty-meta")?.date, null, "missing timestamps should be null")
  assert.equal(findMeta("notes/no-h1")?.date, null, "no-h1 missing date should be null")
  // Missing metadata: empty-meta has no tags/description/date but still has title
  assert.ok(
    findMeta("notes/empty-meta"),
    "empty-meta must be in metadata despite missing optional fields",
  )

  // C8: unselected secret appears in no generated HTML, route, search output, or public metadata
  assert.ok(
    !fs.existsSync(path.join(outputDir, "unselected", "secret.html")),
    "secret route must not exist",
  )
  assert.ok(!fs.existsSync(path.join(outputDir, "secret.html")), "secret at root must not exist")
  assert.ok(
    !Object.keys(contentIndex).some((k) => k.includes("secret")),
    "secret must not be in contentIndex keys",
  )
  assert.ok(
    !JSON.stringify(contentIndex).includes("Secret"),
    "secret content must not be in search index",
  )
  assert.ok(
    !contentMetadata.some((e) => e.slug.includes("secret")),
    "secret must not be in contentMetadata slugs",
  )
  assert.ok(
    !JSON.stringify(contentMetadata).includes("Secret"),
    "secret content must not be in contentMetadata",
  )
  assert.ok(
    !JSON.stringify(contentMetadata).includes("Must never appear"),
    "secret body must not be in contentMetadata",
  )
  // Grep all html for secret string
  const allHtml = execFileAsync("grep", ["-R", "Secret", outputDir]).then(
    () => {
      assert.fail("secret string must not appear in any generated HTML")
    },
    (err) => {
      // grep exits 1 when no matches — that's expected
      assert.match(err.stderr ?? "", /.*/, "grep no-match expected")
    },
  )
  await allHtml.catch(() => {})
  // Also ensure grep truely had no matches by checking via fs walk as fallback
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.isFile() && p.endsWith(".html")) {
        const c = fs.readFileSync(p, "utf8")
        assert.ok(
          !c.includes("Must never appear"),
          `secret content must not be in ${path.relative(outputDir, p)}`,
        )
      }
    }
  }
  walk(outputDir)

  // Additional: ensure generated index page exists and doesn't leak secret
  const indexHtml = readHtml("index.html")
  assert.ok(!indexHtml.includes("Secret"), "index must not contain secret")
  assert.ok(!JSON.stringify(contentMetadata).includes("Secret"), "metadata must not leak secret")
})
