/**
 * Knowledge reader browse journey.
 *
 * Production static export + nginx-style server + desktop browser:
 * home -> published folder (authored or virtual) -> nested group -> note ->
 * breadcrumb or browser Back. Direct extensionless routes for home, the
 * folder, and the nested note are also verified. The persistent sidebar
 * renders the folder-and-note tree: published roots in metadata order,
 * nested children in tree order, and current-page indication.
 *
 * The synthetic fixture always runs (no vault needed). Expected areas,
 * folder titles, and note routes derive from staged content and generated
 * metadata, never from fixed subject routes. When KNOWLEDGE_BASE_ROOT points
 * at a vault checkout, the same generic journey runs against the real corpus.
 *
 * The synthetic run also folds the retired static, home-card, breadcrumb,
 * projection, last-edited, and note suites onto this export: complete
 * page-set and output inspection, card order and kind cues, deep and hidden
 * trails, the projection switcher, last-edited lines, and direct-note
 * readability. Build-free offline revision checks and an env-gated
 * real-corpus export complete the folded static coverage.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-journey-browser.test.mjs
 *   KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-journey-browser.test.mjs
 */

import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { test } from "node:test"
import {
  PUBLISHER_ROOT,
  READER_ROOT,
  buildReader,
  cleanReaderArtifacts,
  closeServer,
  createDesktopContext,
  installReaderCleanup,
  launchBrowser,
  serveOut,
  stageKb,
  tmpdir,
} from "./helpers/reader-env.mjs"
import {
  HIDDEN_NOTE_PATH,
  LONG_SLUG,
  SYNTHETIC_DESTINATIONS,
  SYNTHETIC_TITLE,
  UNSELECTED_SENTINEL,
  writeSyntheticKb,
} from "./fixtures/synthetic-kb.mjs"

const execFileAsync = promisify(execFile)

installReaderCleanup()

function humanizeSegment(seg) {
  const spaced = seg.replace(/[-_]+/g, " ").trim()

  if (spaced === "") return seg

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function stagedFileTitle(absPath, fallback) {
  let text = ""

  try {
    text = fs.readFileSync(absPath, "utf8")
  } catch {
    return fallback
  }

  const lines = text.split("\n")

  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---")

    if (close !== -1) {
      const fm = lines.slice(1, close).join("\n")
      const m = fm.match(/^title:\s*(.+?)\s*$/m)

      if (m) {
        let v = m[1].trim()

        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1)

        if (v.trim() !== "") return v.trim()
      }
    }
  }

  let fenced = false

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }

    if (fenced) continue
    const m = line.match(/^#\s+(.+?)\s*$/)

    if (m) return m[1].trim()
  }

  return fallback
}

/** Count top-level Markdown H1 headings outside fenced code and frontmatter. */
function countTopLevelH1s(absPath) {
  let text = ""

  try {
    text = fs.readFileSync(absPath, "utf8")
  } catch {
    return 0
  }

  const lines = text.split("\n")
  let start = 0

  if (lines[0]?.trim() === "---") {
    const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---")

    if (close !== -1) start = close + 1
  }

  let fenced = false
  let count = 0

  for (let index = start; index < lines.length; index++) {
    const line = lines[index]

    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }

    if (fenced) continue

    if (/^\s*#\s+.+?\s*$/.test(line)) count++
  }

  return count
}

/**
 * Canonical synthetic Knowledge Base for the desktop journey.
 *
 * Written by the shared fixture; staging stays with the harness so the
 * journey derives every expectation from staged content and metadata.
 */
function makeJourneyKb() {
  const kb = tmpdir("kb-journey")

  return writeSyntheticKb(kb)
}

function routeForStagedMarkdown(rel) {
  const posix = rel.split(path.sep).join("/")

  if (/^index\.md$/i.test(posix)) return "/"
  let route = `/${posix.replace(/\.md$/i, "")}`

  if (route.endsWith("/index")) route = route.slice(0, -"/index".length)

  return route || "/"
}

function expectedRootTitle(navEntry, contentDir) {
  if (navEntry.kind === "markdown") {
    const abs = path.join(contentDir, navEntry.path)
    const fallback = path.posix.basename(navEntry.path).replace(/\.md$/i, "")

    return stagedFileTitle(abs, fallback)
  }

  const indexAbs = path.join(contentDir, navEntry.path, "index.md")

  if (fs.existsSync(indexAbs)) {
    return stagedFileTitle(indexAbs, humanizeSegment(path.posix.basename(navEntry.path)))
  }

  return humanizeSegment(path.posix.basename(navEntry.path))
}

function rootRoute(navEntry) {
  if (navEntry.kind === "markdown") return routeForStagedMarkdown(navEntry.path)

  return `/${navEntry.path}`
}

/**
 * Derive a folder journey from staged content: prefer a directory root with
 * both direct notes and nested subfolders, else the deepest directory root.
 * Returns areas in metadata order plus the chosen folder and its deepest
 * eligible leaf. The leaf prefers staged Markdown with exactly one top-level
 * H1 so the one-primary-heading landmark check stays meaningful; when no
 * single-H1 leaf exists the deepest leaf is kept so the check still fails
 * instead of weakening.
 */
function deriveJourney(contentDir, metadata) {
  const areas = metadata.navigation.map((entry) => expectedRootTitle(entry, contentDir))
  const dirRoots = metadata.navigation.filter((entry) => entry.kind === "directory")
  let folderEntry = null

  for (const entry of dirRoots) {
    const abs = path.join(contentDir, entry.path)
    let direct = 0
    let nested = 0

    try {
      for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
        if (child.isFile() && /\.md$/i.test(child.name) && !/^index\.md$/i.test(child.name))
          direct++

        if (child.isDirectory()) {
          const sub = path.join(abs, child.name)

          const walk = (dir) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
              if (e.isFile() && /\.md$/i.test(e.name)) return true

              if (e.isDirectory() && walk(path.join(dir, e.name))) return true
            }

            return false
          }

          if (walk(sub)) nested++
        }
      }
    } catch {}

    if (direct > 0 && nested > 0) {
      folderEntry = entry
      break
    }
  }

  if (!folderEntry) {
    let bestDepth = -1

    for (const entry of dirRoots) {
      const abs = path.join(contentDir, entry.path)
      let depth = 0

      const walk = (dir, d) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (e.isFile() && /\.md$/i.test(e.name)) depth = Math.max(depth, d)

          if (e.isDirectory()) walk(path.join(dir, e.name), d + 1)
        }
      }

      try {
        walk(abs, 1)
      } catch {}

      if (depth > bestDepth) {
        bestDepth = depth
        folderEntry = entry
      }
    }
  }

  if (!folderEntry) folderEntry = dirRoots[0] ?? metadata.navigation[0]
  const folderTitle = expectedRootTitle(folderEntry, contentDir)
  const folderRoute = rootRoute(folderEntry)
  const candidates = []

  const walkFiles = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name

      if (e.isDirectory()) walkFiles(path.join(dir, e.name), relPath)
      else if (e.isFile() && /\.md$/i.test(e.name) && !/^index\.md$/i.test(e.name)) {
        const folderPrefix = folderEntry.kind === "directory" ? folderEntry.path : null

        if (folderPrefix && !(relPath === folderPrefix || relPath.startsWith(`${folderPrefix}/`)))
          continue
        candidates.push(relPath)
      }
    }
  }

  walkFiles(contentDir, "")
  const depthOf = (relPath) => relPath.split("/").length
  candidates.sort((a, b) => depthOf(b) - depthOf(a) || (a < b ? -1 : a > b ? 1 : 0))

  const eligible = candidates.filter(
    (relPath) => countTopLevelH1s(path.join(contentDir, relPath)) === 1,
  )

  const leafRel = (eligible.length > 0 ? eligible : candidates)[0] ?? null
  const leafRoute = leafRel ? routeForStagedMarkdown(leafRel) : folderRoute

  const leafTitle = leafRel
    ? stagedFileTitle(
        path.join(contentDir, leafRel),
        path.posix.basename(leafRel).replace(/\.md$/i, ""),
      )
    : folderTitle

  return { areas, folderEntry, folderTitle, folderRoute, leafRel, leafTitle, leafRoute }
}

/** Generic desktop journey: home -> folder -> nested note -> breadcrumbs and Back. */
async function runJourney(page, baseUrl, expect) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

  const home = await page.evaluate((leafRoute) => {
    const links = Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => ({
      text: a.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
    }))

    // Top-level tree rows keep published root order (metadata order).
    const roots = Array.from(
      document.querySelectorAll('[data-slot="sidebar"] .reader-sidebar-nav > ul > li'),
    ).map((li) => {
      const row = li.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
      )

      const a = row ? row.querySelector("a") : null

      return a ? a.textContent?.trim() || "" : ""
    })

    const leaf = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav a[href="${leafRoute}"]`,
    )

    return {
      title: document.title,
      h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
      mainCount: document.querySelectorAll("main").length,
      navCount: document.querySelectorAll("nav").length,
      links,
      roots,
      leafText: leaf ? leaf.textContent?.trim() || "" : null,
      body: document.body.textContent || "",
    }
  }, expect.leafRoute)

  // Home cards keep published root order (metadata order) with one card
  // per root: each card links its root route and names its root title
  // alongside the approved folder/note kind and child-count meta.
  assert.deepEqual(
    home.links.map((l) => l.href),
    expect.areaRoutes,
    "home keeps generated metadata order",
  )

  for (const [index, title] of expect.areas.entries()) {
    assert.ok(
      home.links[index].text.includes(title),
      `home card names its published root: ${title}`,
    )
  }

  assert.deepEqual(home.roots, expect.areas, "tree keeps published root order")
  assert.equal(home.leafText, expect.leafTitle, "tree renders the nested leaf")
  assert.equal(home.mainCount, 1, "one main landmark on home")
  assert.ok(home.navCount >= 1, "semantic navigation present on home")
  assert.equal(home.h1s.length, 1, `home article has one H1 (got ${home.h1s.join("|")})`)

  const folderHref = home.links.find((l) => l.href === expect.folderRoute)?.href
  assert.ok(folderHref, "home folder link has an href from staged content")
  assert.equal(folderHref, expect.folderRoute, "home folder href matches the derived route")
  await Promise.all([
    page.waitForURL((url) => url.href.includes(folderHref), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.evaluate((href) => {
      document.querySelector(`.reader-area-list a[href="${href}"]`)?.click()
    }, folderHref),
  ])
  assert.ok(
    page.url().endsWith(expect.folderRoute) || page.url().includes(expect.folderRoute),
    "selecting the folder opens its route",
  )

  const folder = await page.evaluate(() => {
    const groupNodes = document.querySelectorAll("article .reader-group h2")

    return {
      h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
      groupHeadings: Array.from(groupNodes).map((h) => h.textContent?.trim()),
      sidebarCurrent:
        document
          .querySelector('[data-slot="sidebar"] .reader-sidebar-nav a[aria-current="page"]')
          ?.textContent?.trim() || null,
    }
  })

  assert.ok(folder.h1s.includes(expect.folderTitle), `folder H1 (got ${folder.h1s.join("|")})`)
  assert.ok(
    folder.groupHeadings.length > 0,
    `folder exposes generic groups (got ${folder.groupHeadings.join("|")})`,
  )

  for (const heading of folder.groupHeadings) {
    assert.ok(
      heading === "Notes" || heading === "Folders",
      `folder group heading is generic (got ${heading})`,
    )
  }

  assert.ok(
    folder.groupHeadings.includes("Notes") || folder.groupHeadings.includes("Folders"),
    "folder uses the generic Notes/Folders groups",
  )
  assert.equal(folder.sidebarCurrent, expect.folderTitle, "tree indicates the open folder")

  const noteLink = await page.evaluate((title) => {
    const a = Array.from(document.querySelectorAll(".reader-group-list a")).find(
      (el) => el.textContent?.trim() === title,
    )

    return a ? a.getAttribute("href") : null
  }, expect.leafTitle)

  // The deepest leaf may sit under a nested virtual folder, so fall back to
  // a direct article link when the folder page groups do not list it.
  let resolvedNoteHref = noteLink

  if (!resolvedNoteHref) {
    resolvedNoteHref = await page.evaluate((route) => {
      const a = Array.from(document.querySelectorAll("article a")).find(
        (el) => el.getAttribute("href") === route,
      )

      return a ? a.getAttribute("href") : null
    }, expect.leafRoute)
  }

  if (!resolvedNoteHref) resolvedNoteHref = expect.leafRoute
  await Promise.all([
    page.waitForURL((url) => url.href.includes(resolvedNoteHref), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.evaluate((href) => {
      const direct = Array.from(document.querySelectorAll(".reader-group-list a")).find(
        (el) => el.getAttribute("href") === href,
      )

      if (direct) direct.click()
      else window.location.assign(href)
    }, resolvedNoteHref),
  ])
  assert.ok(page.url().includes(expect.leafRoute), `nested note route ${expect.leafRoute}`)

  const note = await page.evaluate((folderRoute) => {
    const folderLi = document.querySelector(
      `.reader-sidebar-nav li[data-tree-url="${folderRoute}"]`,
    )

    const folderRow = folderLi
      ? folderLi.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
        )
      : null

    const folderLink = folderRow ? folderRow.querySelector("a") : null

    return {
      h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
      mainCount: document.querySelectorAll("main").length,
      crumbs: Array.from(
        document.querySelectorAll(".reader-breadcrumbs [data-slot='breadcrumb-item']"),
      ).map((li) => ({
        text: li.textContent?.trim() || "",
        href: li.querySelector("a")?.getAttribute("href") || null,
      })),
      sidebarCurrent:
        document
          .querySelector('[data-slot="sidebar"] .reader-sidebar-nav a[aria-current="page"]')
          ?.textContent?.trim() || null,
      folderMarked:
        !!folderLink &&
        (folderLink.getAttribute("aria-current") === "true" ||
          folderLink.classList.contains("is-active")),
    }
  }, expect.folderRoute)

  assert.equal(note.h1s.length, 1, `note has one primary heading (got ${note.h1s.join("|")})`)
  assert.ok(note.h1s.includes(expect.leafTitle), "nested note title")
  assert.equal(note.mainCount, 1, "one main landmark on the note")
  assert.ok(note.crumbs.length >= 3, "breadcrumbs expose folder ancestry")
  assert.ok(
    note.crumbs[note.crumbs.length - 1].text.includes(expect.leafTitle),
    "breadcrumbs end at the note",
  )
  assert.equal(note.sidebarCurrent, expect.leafTitle, "tree indicates the open note")
  assert.ok(note.folderMarked, "tree keeps the section indicated")

  // Breadcrumb return to the folder, then browser Back through the journey.
  // Each Back waits for the address to actually arrive: network idle can
  // resolve while an SPA Back is still committing, which would check the
  // previous page instead. The folder gate also requires leaving the leaf,
  // since the leaf route contains the folder route as a prefix.
  const crumbHref = note.crumbs.length > 1 ? note.crumbs[1].href : null
  assert.ok(crumbHref, "breadcrumbs link a parent")
  await Promise.all([
    page.waitForFunction(
      (href) => window.location.pathname === href || window.location.pathname === `${href}/`,
      crumbHref,
      { timeout: 15000 },
    ),
    page.evaluate((href) => {
      document.querySelector(`.reader-breadcrumbs a[href="${href}"]`)?.click()
    }, crumbHref),
  ])
  await page.waitForLoadState("networkidle", { timeout: 15000 })
  await Promise.all([
    page.waitForFunction((route) => window.location.href.includes(route), expect.leafRoute, {
      timeout: 15000,
    }),
    page.goBack(),
  ])
  assert.ok(page.url().includes(expect.leafRoute), "browser Back returns to the nested note")
  await Promise.all([
    page.waitForFunction(
      ([leaf, folder]) =>
        window.location.href.includes(folder) && !window.location.href.includes(leaf),
      [expect.leafRoute, expect.folderRoute],
      { timeout: 15000 },
    ),
    page.goBack(),
  ])
  assert.ok(page.url().includes(expect.folderRoute), "browser Back returns to the folder")
  await Promise.all([
    page.waitForFunction(() => window.location.pathname === "/", null, { timeout: 15000 }),
    page.goBack(),
  ])
  assert.match(page.url(), /\/$/, "browser Back returns home")
}

/** Direct children of one tree branch, in rendered order. */
async function directTreeChildren(page, folderRoute) {
  return await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    if (!li) return null
    const panel = li.querySelector(":scope > .reader-tree-collapsible > .reader-tree-panel")

    if (!panel) return []

    return Array.from(panel.querySelectorAll(":scope > ul > li")).map((child) => {
      const row = child.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
      )

      const a = row ? row.querySelector("a") : null

      return { text: a?.textContent?.trim() || "", href: a?.getAttribute("href") || "" }
    })
  }, folderRoute)
}

async function disclosureState(page, folderRoute) {
  return await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    const button = li
      ? li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
        )
      : null

    return button ? button.getAttribute("aria-expanded") : null
  }, folderRoute)
}

async function setDisclosure(page, folderRoute, open) {
  await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    li?.querySelector(
      ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
    )?.click()
  }, folderRoute)
  await page.waitForFunction(
    ([route, want]) => {
      const li = document.querySelector(
        `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
      )

      const button = li
        ? li.querySelector(
            ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
          )
        : null

      return button && button.getAttribute("aria-expanded") === want
    },
    [folderRoute, open ? "true" : "false"],
    { timeout: 5000 },
  )
}

async function treeLinkVisible(page, href) {
  return await page.evaluate((target) => {
    const a = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav a[href="${target}"]`,
    )

    if (!a) return false
    const rect = a.getBoundingClientRect()

    return rect.width > 0 && rect.height > 0
  }, href)
}

async function treeCurrent(page) {
  return await page.evaluate(
    () =>
      document
        .querySelector('[data-slot="sidebar"] .reader-sidebar-nav a[aria-current="page"]')
        ?.getAttribute("href") || null,
  )
}

/** Expected direct-child titles of a staged directory, in tree order. */
function expectedFolderChildren(contentDir, folderPath) {
  const abs = path.join(contentDir, folderPath)

  const hasMarkdown = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /\.md$/i.test(entry.name)) return true

      if (entry.isDirectory() && hasMarkdown(path.join(dir, entry.name))) return true
    }

    return false
  }

  const entries = []

  for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${folderPath}/${child.name}`

    if (child.isFile() && /\.md$/i.test(child.name) && !/^index\.md$/i.test(child.name)) {
      entries.push({
        title: stagedFileTitle(path.join(contentDir, rel), child.name.replace(/\.md$/i, "")),
        slug: child.name.replace(/\.md$/i, ""),
      })
    } else if (child.isDirectory() && hasMarkdown(path.join(abs, child.name))) {
      const indexAbs = path.join(contentDir, rel, "index.md")
      entries.push({
        title: fs.existsSync(indexAbs)
          ? stagedFileTitle(indexAbs, humanizeSegment(child.name))
          : humanizeSegment(child.name),
        slug: child.name,
      })
    }
  }

  entries.sort((a, b) => a.title.localeCompare(b.title) || (a.slug < b.slug ? -1 : 1))

  return entries.map((entry) => entry.title)
}

/**
 * Tree sidebar behavior on a fresh desktop page: nested rendering and
 * ordering, folder link versus disclosure, multiple expanded branches,
 * ancestor auto-expansion with current indication, deliberate close,
 * session survival across navigation and Back, and readability.
 */
async function runTreeBehavior(page, baseUrl, expect) {
  const { folderRoute, leafRoute, leafTitle, folderChildren } = expect
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

  const children = await directTreeChildren(page, folderRoute)
  assert.ok(children, "tree renders the folder branch")
  assert.deepEqual(
    children.map((c) => c.text),
    folderChildren,
    "folder children follow tree ordering",
  )

  // Folder link navigates; the disclosure only expands.
  const folderHref = await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    const row = li
      ? li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
        )
      : null

    return row ? row.querySelector("a")?.getAttribute("href") || null : null
  }, folderRoute)

  assert.equal(folderHref, folderRoute, "folder name links to its own page")
  assert.equal(await disclosureState(page, folderRoute), "false", "folder starts closed on home")
  const homeUrl = page.url()
  await setDisclosure(page, folderRoute, true)
  assert.equal(page.url(), homeUrl, "disclosure expands without navigating")
  assert.ok(await treeLinkVisible(page, children[0].href), "disclosure reveals the branch children")

  // A second branch stays open alongside the first.
  const otherRoot = await page.evaluate((route) => {
    const tops = Array.from(
      document.querySelectorAll('[data-slot="sidebar"] .reader-sidebar-nav > ul > li'),
    )

    for (const li of tops) {
      const url = li.getAttribute("data-tree-url") || ""

      if (url && url !== route) {
        const button = li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
        )

        if (button) return url
      }
    }

    return null
  }, folderRoute)

  assert.ok(otherRoot, "a second expandable root exists")
  await setDisclosure(page, otherRoot, true)
  assert.equal(await disclosureState(page, folderRoute), "true", "first branch stays expanded")
  assert.equal(await disclosureState(page, otherRoot), "true", "second branch stays expanded")

  // The folder name reaches its page through a normal static URL.
  await Promise.all([
    page.waitForURL((url) => url.href.includes(folderRoute), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.evaluate((route) => {
      document
        .querySelector(`[data-slot="sidebar"] .reader-sidebar-nav a[href="${route}"]`)
        ?.click()
    }, folderRoute),
  ])
  assert.ok(page.url().includes(folderRoute), "folder link opens its route")
  assert.equal(await treeCurrent(page), folderRoute, "tree indicates the open folder")

  // Arriving at a deep page expands its ancestors and indicates it.
  await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "networkidle", timeout: 15000 })
  const segments = leafRoute.split("/").filter(Boolean)
  const prefixes = segments.map((_, i) => `/${segments.slice(0, i + 1).join("/")}`)

  for (const prefix of prefixes.slice(0, -1)) {
    const state = await disclosureState(page, prefix)

    if (state !== null) assert.equal(state, "true", `ancestor branch ${prefix} expands`)
  }

  assert.equal(await treeCurrent(page), leafRoute, "tree indicates the open note")
  assert.ok(await treeLinkVisible(page, leafRoute), "current note stays readable in the tree")

  // A deliberately collapsed branch stays closed on the current page.
  await setDisclosure(page, folderRoute, false)
  assert.equal(page.url().includes(leafRoute), true, "deliberate close does not navigate")
  assert.equal(await treeLinkVisible(page, leafRoute), false, "deliberate close hides the branch")
  assert.equal(
    await disclosureState(page, folderRoute),
    "false",
    "automatic expansion does not override the deliberate close",
  )

  // Open branches survive navigation; the deliberate close holds where
  // the page did not change, then releases on the next navigation.
  await Promise.all([
    page.waitForURL((url) => url.href.includes(otherRoot), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.evaluate((route) => {
      document
        .querySelector(`[data-slot="sidebar"] .reader-sidebar-nav a[href="${route}"]`)
        ?.click()
    }, otherRoot),
  ])
  assert.ok(page.url().includes(otherRoot), "second branch link opens its route")
  assert.equal(await disclosureState(page, otherRoot), "true", "opened branch survives navigation")
  assert.equal(await disclosureState(page, folderRoute), "false", "closed branch stays closed away")
  await page.goBack({ waitUntil: "networkidle", timeout: 15000 })
  await page.waitForFunction((route) => window.location.href.includes(route), leafRoute, {
    timeout: 15000,
  })
  assert.equal(await disclosureState(page, otherRoot), "true", "opened branch survives Back")
  assert.equal(
    await disclosureState(page, folderRoute),
    "true",
    "navigation reopens the current page ancestors",
  )
  assert.equal(await treeCurrent(page), leafRoute, `tree still indicates ${leafTitle} after Back`)

  // Deep branches and long titles stay readable at desktop width.
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))

  assert.ok(
    overflow.doc <= overflow.inner + 1,
    `tree keeps document width ${overflow.doc} inside viewport ${overflow.inner}`,
  )

  const readability = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll('[data-slot="sidebar"] .reader-sidebar-nav a'),
    )

    const toggles = Array.from(
      document.querySelectorAll('[data-slot="sidebar"] .reader-tree-toggle'),
    )

    const widest = Math.max(0, ...links.map((a) => a.getBoundingClientRect().right))

    return {
      widest,
      inner: window.innerWidth,
      toggleHeights: toggles
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => b.getBoundingClientRect().height),
    }
  })

  assert.ok(
    readability.widest <= readability.inner + 1,
    "tree links stay inside the desktop viewport",
  )

  for (const height of readability.toggleHeights) {
    assert.ok(height >= 44, `tree disclosure is ${height}px (expected >= 44)`)
  }
}

/**
 * Registry sidebar-11 shell: header composition, full collapse (offcanvas,
 * not icon rail), restore with the same tree, readable article measure,
 * keyboard operation, and long titles.
 */
async function runSidebarCollapse(page, baseUrl, expect) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

  const header = await page.evaluate(() => {
    const sidebarHeader = document.querySelector('[data-slot="sidebar-header"]')
    const trigger = document.querySelector('[data-slot="sidebar-trigger"]')
    const sidebar = document.querySelector('[data-slot="sidebar"]')

    const style = trigger ? getComputedStyle(trigger) : null
    const rect = trigger ? trigger.getBoundingClientRect() : null

    return {
      brand: sidebarHeader?.textContent?.trim() || "",
      hasHome:
        !!sidebarHeader?.querySelector('a[href="/"]') &&
        (sidebarHeader?.querySelector('a[href="/"]')?.textContent?.trim() || "").includes("Home"),
      hasSearch:
        !!sidebarHeader?.querySelector(".reader-search-sidebar") &&
        (
          sidebarHeader?.querySelector(".reader-search-sidebar")?.textContent?.trim() || ""
        ).includes("Search"),
      triggerVisible: !!trigger && style.display !== "none" && rect.width > 0 && rect.height > 0,
      collapsible: sidebar?.getAttribute("data-collapsible") || "",
      state: sidebar?.getAttribute("data-state") || "",
    }
  })

  assert.ok(header.brand.includes(expect.projection), "sidebar header shows current projection")
  assert.ok(header.hasHome, "sidebar header shows Home")
  assert.ok(header.hasSearch, "sidebar header shows Search")
  assert.ok(header.triggerVisible, "reading header shows the sidebar trigger")
  assert.notEqual(header.collapsible, "icon", "sidebar never collapses to an icon rail")
  assert.equal(header.state, "expanded", "sidebar starts expanded on desktop")

  const before = await page.evaluate(() => ({
    roots: Array.from(
      document.querySelectorAll('[data-slot="sidebar"] .reader-sidebar-nav > ul > li'),
    ).map(
      (li) =>
        li
          .querySelector(
            ":scope > .reader-tree-collapsible > .reader-tree-row a, :scope > .reader-tree-row a",
          )
          ?.textContent?.trim() || "",
    ),
    insetWidth:
      document.querySelector('[data-slot="sidebar-inset"]')?.getBoundingClientRect().width || 0,
    articleMax: getComputedStyle(document.querySelector("article") || document.body).maxWidth,
  }))

  // Collapse fully via the registry trigger; the article gains room while
  // staying within its readable measure. The gap animates (200ms), so wait
  // for it to settle near zero before measuring.
  await page.evaluate(() => document.querySelector('[data-slot="sidebar-trigger"]')?.click())
  await page.waitForFunction(
    () =>
      document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "collapsed",
    null,
    { timeout: 5000 },
  )
  await page.waitForFunction(
    () =>
      (document.querySelector('[data-slot="sidebar-gap"]')?.getBoundingClientRect().width || 0) <=
      1,
    null,
    { timeout: 5000 },
  )

  const collapsed = await page.evaluate(() => ({
    state: document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") || "",
    collapsible:
      document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-collapsible") || "",
    gapWidth:
      document.querySelector('[data-slot="sidebar-gap"]')?.getBoundingClientRect().width || 0,
    insetWidth:
      document.querySelector('[data-slot="sidebar-inset"]')?.getBoundingClientRect().width || 0,
  }))

  assert.equal(collapsed.state, "collapsed", "trigger collapses the sidebar")
  assert.equal(collapsed.collapsible, "offcanvas", "collapse is offcanvas, not an icon rail")
  assert.ok(collapsed.gapWidth <= 1, `collapsed gap is ${collapsed.gapWidth}px (expected ~0)`)
  assert.ok(
    collapsed.insetWidth >= before.insetWidth - 1,
    "collapsed inset keeps at least the same reading room",
  )

  // Keyboard: focus the trigger and toggle with Enter, then restore.
  await page.evaluate(() => document.querySelector('[data-slot="sidebar-trigger"]')?.focus())
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute("data-slot") || ""),
    "sidebar-trigger",
    "keyboard reaches the sidebar trigger",
  )
  await page.keyboard.press("Enter")
  await page.waitForFunction(
    () =>
      document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded",
    null,
    { timeout: 5000 },
  )

  const after = await page.evaluate(() => ({
    roots: Array.from(
      document.querySelectorAll('[data-slot="sidebar"] .reader-sidebar-nav > ul > li'),
    ).map(
      (li) =>
        li
          .querySelector(
            ":scope > .reader-tree-collapsible > .reader-tree-row a, :scope > .reader-tree-row a",
          )
          ?.textContent?.trim() || "",
    ),
    articleMax: getComputedStyle(document.querySelector("article") || document.body).maxWidth,
  }))

  assert.deepEqual(after.roots, before.roots, "restoring exposes the same tree")
  assert.ok(after.articleMax.length > 0, "article keeps a readable measure after restore")

  // Long titles stay readable in the registry tree.
  const longReadable = await page.evaluate((route) => {
    const a = document.querySelector(`[data-slot="sidebar"] .reader-sidebar-nav a[href="${route}"]`)

    if (!a) return null
    const rect = a.getBoundingClientRect()

    return { text: a.textContent?.trim() || "", right: rect.right, inner: window.innerWidth }
  }, expect.longRoute)

  assert.ok(longReadable, "long title renders in the tree")
  assert.ok(
    longReadable.right <= longReadable.inner + 1,
    "long title stays inside the desktop viewport",
  )
}

/** Wait until the Search dialog is open with its input focused. */
async function dialogOpen(page, timeout = 5000) {
  await page.waitForSelector('[data-slot="dialog-content"]', { state: "visible", timeout })
  await page.waitForFunction(
    () => document.activeElement && document.activeElement.id === "reader-search-input",
    null,
    { timeout },
  )
}

async function dialogClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'), null, {
    timeout: 5000,
  })
}

/** Set the dialog query the way React observes it (controlled input). */
async function setSearchQuery(page, text) {
  await page.evaluate((value) => {
    const el = document.getElementById("reader-search-input")

    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    setter.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }, text)
}

async function pressShortcut(page, modifier) {
  await page.keyboard.down(modifier)
  await page.keyboard.press("k")
  await page.keyboard.up(modifier)
}

/**
 * Search dialog behavior on desktop: visible sidebar control, labelled
 * dialog with empty/no-results/results states, full keyboard journey to a
 * static route, shortcut open, Escape with focus return.
 */
async function runSearchDialog(page, baseUrl, expect) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

  const controls = await page.evaluate(() => {
    const each = (sel) => {
      const el = document.querySelector(sel)

      if (!el) return { present: false, visible: false, text: "" }
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()

      return {
        present: true,
        visible: style.display !== "none" && rect.width > 0 && rect.height > 0,
        text: el.textContent?.trim() || "",
      }
    }

    return {
      sidebar: each(".reader-search-sidebar"),
      header: each(".reader-search-header"),
    }
  })

  assert.ok(
    controls.sidebar.present && controls.sidebar.visible,
    "desktop sidebar shows a Search control",
  )
  assert.ok(controls.sidebar.text.includes("Search"), "sidebar Search control is labeled")
  assert.ok(!controls.header.visible, "phone header Search stays hidden on desktop")

  await page.evaluate(() => document.querySelector(".reader-search-sidebar")?.click())
  await dialogOpen(page)

  const dialogMeta = await page.evaluate(() => ({
    title:
      document
        .querySelector('[data-slot="dialog-content"] [data-slot="dialog-title"]')
        ?.textContent?.trim() || "",
    labelled: !!document.querySelector('label[for="reader-search-input"]'),
    live: document.querySelector(".reader-search-status")?.getAttribute("aria-live") || "",
    status: document.querySelector(".reader-search-status")?.textContent?.trim() || "",
    combobox: document.getElementById("reader-search-input")?.getAttribute("role") || "",
  }))

  assert.equal(dialogMeta.title, "Search", "dialog is labelled Search")
  assert.ok(dialogMeta.labelled, "search input is labeled")
  assert.equal(dialogMeta.live, "polite", "state changes announce politely")
  assert.ok(dialogMeta.status.includes("Type to find a note"), "empty state invites a query")
  assert.equal(dialogMeta.combobox, "combobox", "input exposes the combobox pattern")

  await setSearchQuery(page, "zzz-no-such-note-qqq9")
  await page.waitForFunction(
    () => document.querySelector(".reader-search-status")?.textContent?.includes("No results"),
    null,
    { timeout: 10000 },
  )

  await setSearchQuery(page, expect.leafTitle)
  await page.waitForSelector(".reader-search-result", { state: "visible", timeout: 10000 })

  const results = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-search-result")).map((a) => ({
      title: a.querySelector(".reader-search-result-title")?.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
      excerpt: a.querySelector(".reader-search-result-excerpt")?.textContent?.trim() || "",
    })),
  )

  assert.ok(results.length > 0, "typing shows ranked results")

  for (const hit of results) {
    assert.ok(hit.title.length > 0, "each result carries a title")
    assert.ok(hit.href.startsWith("/"), "each result carries a static location")
    assert.ok(hit.excerpt.length > 0, "each result carries an excerpt")
  }

  assert.ok(
    results.some((hit) => hit.href === expect.leafRoute),
    "results reach the nested note",
  )

  // Keyboard journey: arrows move the highlight, Enter follows the static URL.
  const firstHref = results[0].href

  const activeEndsWith = async (suffix) =>
    await page.evaluate(
      (end) =>
        document
          .getElementById("reader-search-input")
          ?.getAttribute("aria-activedescendant")
          ?.endsWith(end) || false,
      suffix,
    )

  assert.ok(await activeEndsWith("-option-0"), "first result starts highlighted")

  if (results.length > 1) {
    await page.keyboard.press("ArrowDown")
    assert.ok(await activeEndsWith("-option-1"), "ArrowDown moves the highlight")
    await page.keyboard.press("ArrowUp")
    assert.ok(await activeEndsWith("-option-0"), "ArrowUp returns the highlight")
  }

  const highlighted = await page.evaluate(
    () =>
      document
        .querySelector('.reader-search-option[data-active="true"] .reader-search-result')
        ?.getAttribute("href") || null,
  )

  assert.equal(highlighted, firstHref, "highlight tracks the first result")
  await Promise.all([
    page.waitForURL((url) => url.href.includes(firstHref), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.keyboard.press("Enter"),
  ])
  assert.ok(page.url().includes(firstHref), "Enter opens the highlighted static route")

  const landed = await page.evaluate(
    () => document.querySelector("article h1")?.textContent?.trim() || "",
  )

  assert.ok(landed.length > 0, "result navigation lands on a readable page")

  // Shortcut opens and focuses; repeating it keeps exactly one dialog.
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })
  await page.evaluate(() => document.querySelector(".reader-search-sidebar")?.focus())
  await pressShortcut(page, "Control")
  await dialogOpen(page)

  const countDialogs = async () =>
    await page.evaluate(() => document.querySelectorAll('[data-slot="dialog-content"]').length)

  assert.equal(await countDialogs(), 1, "Control+K opens exactly one dialog")
  await pressShortcut(page, "Control")
  assert.equal(await countDialogs(), 1, "shortcut while open keeps one dialog")
  assert.equal(
    await page.evaluate(() => document.activeElement?.id || ""),
    "reader-search-input",
    "shortcut focuses the dialog input",
  )

  // Escape closes and returns focus to the control that opened it.
  await page.keyboard.press("Escape")
  await dialogClosed(page)
  const returned = await page.evaluate(() => document.activeElement?.className || "")
  assert.ok(
    String(returned).includes("reader-search-sidebar"),
    "Escape returns focus to the opener",
  )

  // Meta+K opens the same dialog.
  await pressShortcut(page, "Meta")
  await dialogOpen(page)
  await page.keyboard.press("Escape")
  await dialogClosed(page)
}

/** Loading state: the dialog announces while the static index is in flight. */
async function runSearchIndexLoading(context, baseUrl) {
  const page = await context.newPage()

  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    let releaseIndex = () => {}

    const gate = new Promise((resolve) => {
      releaseIndex = resolve
    })

    await page.route("**/search-index.json", async (route) => {
      await gate
      await route.continue()
    })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })
    await pressShortcut(page, "Control")
    await dialogOpen(page)
    await setSearchQuery(page, "garden")
    await page.waitForFunction(
      () => document.querySelector(".reader-search-status")?.textContent?.includes("Searching"),
      null,
      { timeout: 10000 },
    )
    assert.equal(
      await page.evaluate(() => document.querySelectorAll(".reader-search-result").length),
      0,
      "no results render before the index arrives",
    )
    releaseIndex()
    await page.waitForSelector(".reader-search-result", { state: "visible", timeout: 15000 })
  } finally {
    await page.close()
  }
}

/** Failed index fetch: graceful feedback, no crash, dialog still closes. */
async function runSearchIndexFailure(context, baseUrl) {
  const page = await context.newPage()

  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.route("**/search-index.json", (route) => route.abort())
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })
    await pressShortcut(page, "Control")
    await dialogOpen(page)
    await setSearchQuery(page, "garden")
    await page.waitForFunction(
      () => document.querySelector(".reader-search-status")?.textContent?.includes("unavailable"),
      null,
      { timeout: 10000 },
    )
    assert.equal(
      await page.evaluate(() => document.querySelectorAll(".reader-search-result").length),
      0,
      "failed fetch shows feedback instead of results",
    )
    await page.keyboard.press("Escape")
    await dialogClosed(page)
  } finally {
    await page.close()
  }
}

/**
 * Offline probes derived from staged content: a published folder and a
 * published note the journey above never visits, so the offline run proves
 * an unvisited page and folder work after restart. Prefers a directory
 * root other than the journey folder; falls back to a standalone Markdown
 * root when no second directory exists.
 */
function deriveOfflineProbes(contentDir, metadata, journey) {
  const dirRoots = metadata.navigation.filter((entry) => entry && entry.kind === "directory")

  const folderEntry =
    dirRoots.find((entry) => `/${entry.path}` !== journey.folderRoute) || dirRoots[0] || null

  if (!folderEntry) {
    const markdownRoot = metadata.navigation.find((entry) => entry && entry.kind === "markdown")
    const route = markdownRoot ? rootRoute(markdownRoot) : journey.folderRoute
    const title = markdownRoot ? expectedRootTitle(markdownRoot, contentDir) : journey.folderTitle

    return {
      offlineFolderRoute: route,
      offlineFolderTitle: title,
      offlineLeafRoute: route,
      offlineLeafTitle: title,
    }
  }

  const folderRoute = `/${folderEntry.path}`
  const folderTitle = expectedRootTitle(folderEntry, contentDir)
  const candidates = []

  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath)
      else if (
        entry.isFile() &&
        /\.md$/i.test(entry.name) &&
        !/^index\.md$/i.test(entry.name) &&
        (relPath === folderEntry.path || relPath.startsWith(`${folderEntry.path}/`))
      ) {
        candidates.push(relPath)
      }
    }
  }

  walk(contentDir, "")
  candidates.sort()

  const leafRel =
    candidates.find((rel) => routeForStagedMarkdown(rel) !== journey.leafRoute) || candidates[0]

  if (!leafRel) {
    return {
      offlineFolderRoute: folderRoute,
      offlineFolderTitle: folderTitle,
      offlineLeafRoute: folderRoute,
      offlineLeafTitle: folderTitle,
    }
  }

  const leafRoute = routeForStagedMarkdown(leafRel)

  const leafTitle = stagedFileTitle(
    path.join(contentDir, leafRel),
    path.posix.basename(leafRel).replace(/\.md$/i, ""),
  )

  return {
    offlineFolderRoute: folderRoute,
    offlineFolderTitle: folderTitle,
    offlineLeafRoute: leafRoute,
    offlineLeafTitle: leafTitle,
  }
}

/**
 * Explicit offline save plus offline browsing and search on one origin.
 *
 * Reuses the synthetic build above (no second build): the Save action is
 * visible with its size and trusted-device note, starts no worker before
 * the reader chooses it, reports progress, then reports Ready offline only
 * after the whole export is cached. A fresh page with the network off then
 * launches home, opens an unvisited folder and note through extensionless
 * URLs, browses the same tree, and searches to the unvisited note.
 */
async function runOfflineSave(context, baseUrl, server, expect) {
  const page = await context.newPage()

  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

    const pre = await page.evaluate(async () => {
      const save = document.querySelector(".reader-offline-save")
      const size = document.querySelector(".reader-offline-size")?.textContent || ""
      const trust = document.querySelector(".reader-offline-trust")?.textContent || ""
      let hasReg = false
      let cacheCount = 0

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        cacheCount = (await caches.keys()).length
      } catch {}

      return { hasSave: !!save, size, trust, hasReg, cacheCount }
    })

    assert.ok(pre.hasSave, "Save for offline use is visible")
    assert.match(pre.size, /B/, "estimated download size is shown")
    assert.match(pre.trust, /trust/i, "trusted-device note is shown")
    assert.equal(pre.hasReg, false, "no worker starts before Save")
    assert.equal(pre.cacheCount, 0, "no offline cache starts before Save")

    // An online session that expires mid-save: one published file redirects
    // to a same-origin sign-in page. The integrity guard fails that fetch,
    // so the save stays incomplete with a retry and caches no login output.
    server.accessRedirectFor = expect.failureTarget
    await page.evaluate(() => document.querySelector(".reader-offline-save")?.click())
    await page.waitForSelector(".reader-offline-progress", { state: "visible", timeout: 15000 })
    await page.waitForSelector(".reader-offline-retry", { state: "visible", timeout: 90000 })

    const incompleteText = await page.evaluate(
      () => document.querySelector(".reader-offline section, .reader-offline")?.textContent || "",
    )

    assert.match(incompleteText, /incomplete/i, "redirected save reports an incomplete state")
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      false,
      "redirected save never claims Ready offline",
    )

    const loginCached = await page.evaluate(async (target) => {
      try {
        const hit = await caches.match(target, { ignoreSearch: true })

        if (!hit) return "miss"
        const text = await hit.clone().text()

        return text.includes("Sign in") ? "login-cached" : "other-cached"
      } catch {
        return "error"
      }
    }, expect.failureTarget)

    assert.equal(loginCached, "miss", "sign-in response is not cached as publication")
    // No destructive behavior: the reader still works online.
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

    const homeH1 = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.ok(homeH1.length > 0, "failed save leaves online reading intact")

    // Access restored: saving again completes with no rebuild. After the
    // reload the control offers the explicit Save action again (a failed
    // install keeps no worker); either control starts the same save.
    server.accessRedirectFor = null
    await page.waitForSelector(".reader-offline-retry, .reader-offline-save", {
      state: "visible",
      timeout: 15000,
    })
    await page.evaluate(() => {
      const retry = document.querySelector(".reader-offline-retry")

      if (retry) {
        retry.click()

        return
      }

      document.querySelector(".reader-offline-save")?.click()
    })
    await page.waitForSelector(".reader-offline-progress", { state: "visible", timeout: 15000 })
    await page.waitForSelector(".reader-offline-ready", { state: "visible", timeout: 90000 })

    const readyText = await page.evaluate(
      () => document.querySelector(".reader-offline-ready")?.textContent || "",
    )

    assert.match(readyText, /Ready offline/, "retry after access restores Ready offline")
  } finally {
    await page.close()
  }

  // Restart: a fresh page with the network off proves the saved copy
  // launches and serves unvisited routes without a connection.
  const offline = await context.newPage()

  try {
    await offline.setViewportSize({ width: 1280, height: 800 })
    await offline.context().setOffline(true)
    await offline.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 15000 })

    const homeH1 = await offline.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.ok(homeH1.length > 0, "saved site launches offline")

    await offline.goto(`${baseUrl}${expect.offlineFolderRoute}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    })

    const folderH1 = await offline.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(folderH1, expect.offlineFolderTitle, "unvisited folder opens offline")

    const treeHasLeaf = await offline.evaluate(
      (route) =>
        !!document.querySelector(`[data-slot="sidebar"] .reader-sidebar-nav a[href="${route}"]`),
      expect.offlineLeafRoute,
    )

    assert.ok(treeHasLeaf, "Browse tree works offline")

    await offline.goto(`${baseUrl}${expect.offlineLeafRoute}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    })

    const leafH1 = await offline.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(
      leafH1,
      expect.offlineLeafTitle,
      "unvisited page opens offline by extensionless URL",
    )

    // Focus stays in the page before the shortcut: the offline leaf loads
    // with domcontentloaded and hydration may still be attaching the
    // shortcut listener, so retry the shortcut until the dialog answers.
    await offline.evaluate(() => document.querySelector(".reader-search-header")?.focus())

    let searchReady = false

    for (let attempt = 0; attempt < 5 && !searchReady; attempt++) {
      await pressShortcut(offline, "Control")

      try {
        await dialogOpen(offline, 2000)
        searchReady = true
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }

    assert.ok(searchReady, "offline search opens through the shortcut")
    await setSearchQuery(offline, expect.offlineLeafTitle)
    await offline.waitForSelector(".reader-search-result", { state: "visible", timeout: 15000 })

    const hrefs = await offline.evaluate(() =>
      Array.from(document.querySelectorAll(".reader-search-result")).map(
        (a) => a.getAttribute("href") || "",
      ),
    )

    assert.ok(
      hrefs.some((href) => href === expect.offlineLeafRoute),
      "offline search reaches the unvisited page",
    )
    await Promise.all([
      offline.waitForURL((url) => url.href.includes(expect.offlineLeafRoute), {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      }),
      offline.keyboard.press("Enter"),
    ])
    assert.ok(
      offline.url().includes(expect.offlineLeafRoute),
      "offline result opens the saved page",
    )
  } finally {
    await offline
      .context()
      .setOffline(false)
      .catch(() => {})
    await offline.close()
  }
}

/**
 * Explicit publication update on the same export (no second Next.js build).
 *
 * Mutates the served export directly (changed page H1 plus the same title
 * inside the static search index, one removed page), regenerates only the
 * Workbox output, then proves the observable update behavior: no prompt
 * before the new publication, Update ready — Reload only after the complete
 * replacement downloads with no forced reload, and after Reload the updated
 * page and search come from the same new version while the removed page is
 * gone offline. Worker update checks use no-cache headers.
 */
async function runOfflineUpdate(context, baseUrl, outDir, expect) {
  const { leafRoute, leafTitle, removedRoute } = expect
  const newTitle = `${leafTitle} Updated`
  const leafRel = `${leafRoute.replace(/^\//, "")}.html`
  const leafAbs = path.join(outDir, leafRel)
  const removedRel = `${removedRoute.replace(/^\//, "")}.html`
  const removedAbs = path.join(outDir, removedRel)
  assert.ok(fs.existsSync(leafAbs), `update target exists: ${leafRel}`)
  assert.ok(fs.existsSync(removedAbs), `removal target exists: ${removedRel}`)
  const oldVersion = JSON.parse(fs.readFileSync(path.join(outDir, "offline.json"), "utf8")).version

  const page = await context.newPage()

  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "networkidle", timeout: 15000 })

    const beforeH1 = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(beforeH1, leafTitle, "update starts from the saved publication")

    // Ready settles asynchronously after load (cache inspection); wait for
    // it rather than racing first paint.
    await page.waitForFunction(() => !!document.querySelector(".reader-offline-ready"), null, {
      timeout: 20000,
    })
    assert.ok(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      "saved copy is Ready before the update",
    )
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-reload")),
      false,
      "no update prompt before the new publication",
    )

    // New publication from the finished export only: changed page plus the
    // same title in the static search index, with one page removed.
    const leafHtml = fs.readFileSync(leafAbs, "utf8")
    assert.ok(leafHtml.includes(leafTitle), "export holds the old title before the update")
    fs.writeFileSync(leafAbs, leafHtml.split(leafTitle).join(newTitle))
    const indexRaw = fs.readFileSync(path.join(outDir, "search-index.json"), "utf8")
    assert.ok(indexRaw.includes(leafTitle), "search index holds the old title before the update")
    fs.writeFileSync(
      path.join(outDir, "search-index.json"),
      indexRaw.split(leafTitle).join(newTitle),
    )
    fs.rmSync(removedAbs, { force: true })
    await execFileAsync(
      process.execPath,
      [path.join(READER_ROOT, "scripts", "build-offline.mjs"), "--dir", outDir],
      { cwd: PUBLISHER_ROOT, timeout: 120000 },
    )
    const afterManifest = JSON.parse(fs.readFileSync(path.join(outDir, "offline.json"), "utf8"))
    assert.notEqual(afterManifest.version, oldVersion, "new publication carries a new version")
    assert.ok(
      !fs.readFileSync(path.join(outDir, "sw.js"), "utf8").includes(removedRel),
      "removed page leaves the new precache",
    )

    // Deployed-style update check: worker inputs bypass the HTTP cache.
    const cacheHeaders = await page.evaluate(async (base) => {
      const sw = await fetch(`${base}/sw.js`, { cache: "no-store" }).then(
        (res) => res.headers.get("cache-control") || "",
      )

      const manifest = await fetch(`${base}/offline.json`, { cache: "no-store" }).then(
        (res) => res.headers.get("cache-control") || "",
      )

      return { sw, manifest }
    }, baseUrl)

    assert.match(cacheHeaders.sw, /no-cache/i, "worker update check bypasses the cache")
    assert.match(cacheHeaders.manifest, /no-cache/i, "manifest update check bypasses the cache")

    // A reader leaves this tab open while a new publication arrives. An
    // online/visibility check must find the update without a manual call to
    // ServiceWorkerRegistration.update() from the test.
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await page.waitForSelector(".reader-offline-reload", { state: "visible", timeout: 90000 })

    const prompt = await page.evaluate(
      () => document.querySelector(".reader-offline-reload")?.textContent?.trim() || "",
    )

    assert.equal(prompt, "Update ready — Reload", "complete replacement offers Reload")
    assert.ok(page.url().includes(leafRoute), "update never navigates the session away")

    const duringH1 = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(duringH1, leafTitle, "session keeps the old publication until Reload")

    await Promise.all([
      page.waitForEvent("load", { timeout: 30000 }),
      page.evaluate(() => document.querySelector(".reader-offline-reload")?.click()),
    ])

    const afterH1 = await page.evaluate(
      () => document.querySelector("article h1")?.textContent?.trim() || "",
    )

    assert.equal(afterH1, newTitle, "Reload serves the updated page")
    // Ready settles asynchronously after the reload (cache inspection);
    // wait for it rather than racing first paint.
    await page.waitForFunction(() => !!document.querySelector(".reader-offline-ready"), null, {
      timeout: 20000,
    })
    assert.ok(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      "updated copy stays Ready",
    )

    // Offline after Reload: updated page and search use the new version;
    // the removed page is no longer available offline.
    await page.context().setOffline(true)
    await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "domcontentloaded", timeout: 15000 })
    assert.equal(
      await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim() || ""),
      newTitle,
      "updated page serves offline",
    )

    const offlineIndexNew = await page.evaluate(async () => {
      try {
        const res = await fetch("/search-index.json")

        if (!res.ok) return false

        return (await res.text()).includes("Updated")
      } catch {
        return false
      }
    })

    assert.ok(offlineIndexNew, "offline search index is the new version")
    // Workbox precaches the `.html` export key (not the extensionless
    // route), so check the actual cache keys: a stale removed entry would
    // still match the `.html` lookup and fail this assertion.
    const removedUrl = `/${removedRel.split(path.sep).join("/")}`

    const removedHits = await page.evaluate(
      async ([htmlUrl, route]) => {
        const found = { htmlHit: true, routeHit: true }

        try {
          const htmlMatch = await caches.match(htmlUrl, { ignoreSearch: true })
          found.htmlHit = !!(htmlMatch && htmlMatch.ok)
        } catch {
          found.htmlHit = true
        }

        try {
          const routeMatch = await caches.match(route, { ignoreSearch: true })
          found.routeHit = !!(routeMatch && routeMatch.ok)
        } catch {
          found.routeHit = true
        }

        return found
      },
      [removedUrl, removedRoute],
    )

    assert.equal(removedHits.htmlHit, false, "removed .html is gone from the precache")
    assert.equal(removedHits.routeHit, false, "removed route leaves no offline entry")
    // Observable reader behavior in an isolated probe page (keeps this
    // page's JS context intact for the search check below): offline
    // navigation to the removed page must not serve the old publication.
    const probe = await context.newPage()

    try {
      await probe.setViewportSize({ width: 1280, height: 800 })
      await probe.context().setOffline(true)
      let removedServed = false

      try {
        await probe.goto(`${baseUrl}${removedRoute}`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        })

        const removedH1 = await probe.evaluate(
          () => document.querySelector("article h1")?.textContent?.trim() || "",
        )

        removedServed = removedH1.includes("Orchard Note 12")
      } catch {
        removedServed = false
      }

      assert.equal(removedServed, false, "removed page no longer opens offline")
    } finally {
      await probe
        .context()
        .setOffline(false)
        .catch(() => {})
      await probe.close()
    }

    await pressShortcut(page, "Control")
    await dialogOpen(page)
    await setSearchQuery(page, leafTitle)
    await page.waitForSelector(".reader-search-result", { state: "visible", timeout: 15000 })

    const updateHits = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".reader-search-result")).map((a) => ({
        title: a.querySelector(".reader-search-result-title")?.textContent?.trim() || "",
        href: a.getAttribute("href") || "",
      })),
    )

    assert.ok(
      updateHits.some((hit) => hit.href === leafRoute && hit.title === newTitle),
      "offline search reaches the updated page version",
    )
    await page.keyboard.press("Escape")
    await dialogClosed(page)
  } finally {
    await page
      .context()
      .setOffline(false)
      .catch(() => {})
    await page.close()
  }
}

/**
 * Explicit removal on the same export (no second Next.js build).
 *
 * From the updated Ready copy: Remove offline copy unregisters this
 * projection's worker and deletes only its Workbox precache caches, so an
 * unrelated same-origin cache stays. Ready clears to the explicit Save
 * action, a later online visit starts no silent download, and an explicit
 * Save restores Ready. A simulated storage eviction (precache deleted,
 * worker left) must also clear Ready on the next visit.
 */
async function runOfflineRemove(context, baseUrl, expect) {
  const { leafRoute } = expect
  const leafHtml = leafRoute === "/" ? "/index.html" : `${leafRoute}.html`
  const page = await context.newPage()

  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })
    await page.waitForSelector(".reader-offline-ready", { state: "visible", timeout: 15000 })
    await page.waitForSelector(".reader-offline-remove", { state: "visible", timeout: 15000 })

    await page.evaluate(async () => {
      try {
        const keep = await caches.open("sentinel-keep-v1")
        await keep.put(
          "/sentinel-keep",
          new Response("keep", { headers: { "Content-Type": "text/plain" } }),
        )
        await caches.open(`workbox-precache-v2-${location.origin}/other/`)
      } catch {}
    })

    const before = await page.evaluate(async () => {
      let hasReg = false
      let keys = []

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        keys = await caches.keys()
      } catch {}

      return {
        hasReg,
        precacheCount: keys.filter((name) => name === `workbox-precache-v2-${location.origin}/`)
          .length,
      }
    })

    assert.ok(before.hasReg, "saved worker present before removal")
    assert.ok(before.precacheCount > 0, "saved precache present before removal")

    // Failure to identify this worker's scope must not delete every Workbox
    // precache on the origin or claim that removal succeeded.
    await page.evaluate(() => {
      const container = navigator.serviceWorker
      window.__originalGetRegistration = container.getRegistration.bind(container)
      container.getRegistration = async () => {
        throw new Error("registration unavailable")
      }
    })
    await page.evaluate(() => document.querySelector(".reader-offline-remove")?.click())
    await page.waitForSelector(".reader-offline-remove-error", { state: "visible", timeout: 15000 })
    assert.ok(
      await page.evaluate(async () =>
        (await caches.keys()).some((name) => name.includes("-precache-")),
      ),
      "failed removal keeps the saved precache",
    )
    await page.evaluate(() => {
      navigator.serviceWorker.getRegistration = window.__originalGetRegistration
      delete window.__originalGetRegistration
    })

    // An unregister that succeeds before cache deletion fails must still
    // allow a scoped retry. Never display Save while saved bytes remain.
    await page.evaluate(() => {
      window.__originalCacheDelete = caches.delete.bind(caches)
      caches.delete = async () => false
    })
    await page.evaluate(() => document.querySelector(".reader-offline-remove")?.click())
    await page.waitForSelector(".reader-offline-remove-error", { state: "visible", timeout: 15000 })
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-save")),
      false,
      "failed cache deletion never claims that removal succeeded",
    )
    await page.evaluate(() => {
      caches.delete = window.__originalCacheDelete
      delete window.__originalCacheDelete
    })

    await page.evaluate(() => document.querySelector(".reader-offline-remove")?.click())
    await page.waitForSelector(".reader-offline-save", { state: "visible", timeout: 15000 })
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      false,
      "Ready offline clears after removal",
    )
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-remove")),
      false,
      "Remove action leaves with the saved copy",
    )
    // Give a later visit no chance to hide a silent re-download.
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const after = await page.evaluate(async () => {
      let hasReg = false
      let keys = []

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        keys = await caches.keys()
      } catch {}

      return {
        hasReg,
        precacheCount: keys.filter((name) => name === `workbox-precache-v2-${location.origin}/`)
          .length,
        kept: keys.includes("sentinel-keep-v1"),
        otherScopeKept: keys.includes(`workbox-precache-v2-${location.origin}/other/`),
      }
    })

    assert.equal(after.hasReg, false, "removal unregisters this projection's worker")
    assert.equal(after.precacheCount, 0, "removal deletes this projection's precache")
    assert.equal(after.kept, true, "unrelated same-origin cache stays")
    assert.equal(after.otherScopeKept, true, "another same-origin scope's precache stays")

    const stillCached = await page.evaluate(async (htmlUrl) => {
      try {
        const hit = await caches.match(htmlUrl, { ignoreSearch: true })

        return !!(hit && hit.ok)
      } catch {
        return true
      }
    }, leafHtml)

    assert.equal(stillCached, false, "removed page leaves no precache entry")

    // Later online visit: explicit Save stays, but no silent whole-site fetch.
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })
    await page.waitForSelector(".reader-offline-save", { state: "visible", timeout: 15000 })
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      false,
      "later visit does not claim Ready offline",
    )
    await new Promise((resolve) => setTimeout(resolve, 2000))

    const later = await page.evaluate(async () => {
      let hasReg = false
      let keys = []

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        keys = await caches.keys()
      } catch {}

      return {
        hasReg,
        precacheCount: keys.filter((name) => name === `workbox-precache-v2-${location.origin}/`)
          .length,
      }
    })

    assert.equal(later.hasReg, false, "later visit does not re-register")
    assert.equal(later.precacheCount, 0, "later visit does not re-download")

    // Explicit re-save restores the offline copy with no rebuild.
    await page.evaluate(() => document.querySelector(".reader-offline-save")?.click())
    await page.waitForSelector(".reader-offline-progress", { state: "visible", timeout: 15000 })
    await page.waitForSelector(".reader-offline-ready", { state: "visible", timeout: 90000 })
    await page.waitForSelector(".reader-offline-remove", { state: "visible", timeout: 15000 })

    const resaved = await page.evaluate(async () => {
      let hasReg = false
      let keys = []

      try {
        hasReg = !!(await navigator.serviceWorker.getRegistration())
      } catch {}

      try {
        keys = await caches.keys()
      } catch {}

      return {
        hasReg,
        precacheCount: keys.filter((name) => name.includes("-precache-")).length,
      }
    })

    assert.ok(resaved.hasReg, "explicit re-save registers the worker again")
    assert.ok(resaved.precacheCount > 0, "explicit re-save restores the precache")

    await page.context().setOffline(true)
    await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "domcontentloaded", timeout: 15000 })
    assert.ok(
      (await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim() || ""))
        .length > 0,
      "re-saved page opens offline",
    )
    await page.context().setOffline(false)

    // Simulated browser storage eviction: precache gone, worker left.
    // The next online visit must not keep a stale Ready label.
    await page.evaluate(async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(
          keys
            .filter((name) => name === `workbox-precache-v2-${location.origin}/`)
            .map((name) => caches.delete(name)),
        )
      } catch {}
    })
    await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })
    await page.waitForSelector(".reader-offline-save, .reader-offline-retry", {
      state: "visible",
      timeout: 15000,
    })
    assert.equal(
      await page.evaluate(() => !!document.querySelector(".reader-offline-ready")),
      false,
      "storage eviction clears Ready offline",
    )
    await page.evaluate(async () => {
      try {
        await caches.delete("sentinel-keep-v1")
        await caches.delete(`workbox-precache-v2-${location.origin}/other/`)
      } catch {}
    })
  } finally {
    await page
      .context()
      .setOffline(false)
      .catch(() => {})
    await page.close()
  }
}

/**
 * Offline and appearance placement in the new shell (desktop).
 *
 * SidebarFooter owns Light/Dark/System plus detailed offline
 * status/actions from one mounted state; the old page footer is gone;
 * the phone cue exists for the closed drawer but stays hidden on
 * desktop; choosing appearance or toggling the sidebar never starts a
 * save; the head bootstrap restores the explicit choice without a flash.
 */
async function runOfflineAppearancePlacement(page, baseUrl) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

  assert.equal(
    await page.evaluate(() => !!document.querySelector(".reader-footer")),
    false,
    "old page footer does not duplicate shell controls",
  )

  const footer = await page.evaluate(() => {
    const el = document.querySelector('[data-slot="sidebar-footer"].reader-sidebar-footer')

    if (!el) return { present: false, visible: false }
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()

    return {
      present: true,
      visible: style.display !== "none" && rect.width > 0 && rect.height > 0,
    }
  })

  assert.ok(footer.present && footer.visible, "desktop SidebarFooter is visible")

  const appearance = await page.evaluate(() => {
    const group = document.querySelector(
      '.reader-sidebar-footer [role="group"][aria-label="Appearance"]',
    )

    if (!group) return null

    return {
      options: Array.from(group.querySelectorAll("button")).map((button) => ({
        text: button.textContent?.trim() || "",
        pressed: button.getAttribute("aria-pressed") || "",
        height: button.getBoundingClientRect().height,
      })),
    }
  })

  assert.ok(appearance, "SidebarFooter shows appearance choices")
  assert.deepEqual(
    appearance.options.map((option) => option.text),
    ["Light", "Dark", "System"],
    "appearance offers Light/Dark/System",
  )

  for (const option of appearance.options) {
    assert.ok(option.height >= 44, `appearance ${option.text} is ${option.height}px`)
  }

  const offline = await page.evaluate(() => {
    const save = document.querySelector(".reader-sidebar-footer .reader-offline-save")
    const rect = save?.getBoundingClientRect()

    return {
      hasSave: !!save,
      visible: !!save && rect.width > 0 && rect.height > 0,
      size:
        document.querySelector(".reader-sidebar-footer .reader-offline-size")?.textContent || "",
      trust:
        document.querySelector(".reader-sidebar-footer .reader-offline-trust")?.textContent || "",
    }
  })

  assert.ok(offline.hasSave && offline.visible, "SidebarFooter shows Save for offline use")
  assert.match(offline.size, /B/, "estimated download size is shown")
  assert.match(offline.trust, /trust/i, "trusted-device note is shown")

  const cue = await page.evaluate(() => {
    const el = document.querySelector(".reader-offline-cue")

    if (!el) return null
    const style = getComputedStyle(el)
    const rect = el.getBoundingClientRect()

    return {
      text: el.textContent?.trim() || "",
      state: el.getAttribute("data-offline-state") || "",
      visible: style.display !== "none" && rect.width > 0 && rect.height > 0,
      tag: el.tagName,
    }
  })

  assert.ok(cue, "offline cue exists for the phone header")
  assert.equal(cue.tag, "P", "cue never initiates a save")
  assert.equal(cue.visible, false, "cue stays hidden on desktop")

  const hasBoot = await page.evaluate(() =>
    Array.from(document.querySelectorAll("head script")).some((script) =>
      (script.textContent || "").includes("knowledge-reader-appearance"),
    ),
  )

  assert.ok(hasBoot, "appearance bootstrap restores without a flash")

  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll(
        '.reader-sidebar-footer [role="group"][aria-label="Appearance"] button',
      ),
    )

    buttons.find((button) => (button.textContent || "").includes("Dark"))?.click()
  })
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"), null, {
    timeout: 5000,
  })
  assert.equal(
    await page.evaluate(() => window.localStorage.getItem("knowledge-reader-appearance")),
    "dark",
    "explicit Dark choice is stored",
  )

  const afterAppearance = await page.evaluate(async () => {
    let hasReg = false
    let count = 0

    try {
      hasReg = !!(await navigator.serviceWorker.getRegistration())
    } catch {}

    try {
      count = (await caches.keys()).length
    } catch {}

    return { hasReg, count }
  })

  assert.equal(afterAppearance.hasReg, false, "choosing appearance does not register a worker")
  assert.equal(afterAppearance.count, 0, "choosing appearance does not download")

  await page.reload({ waitUntil: "networkidle", timeout: 15000 })
  assert.ok(
    await page.evaluate(() => document.documentElement.classList.contains("dark")),
    "reload restores Dark without a flash",
  )
  assert.equal(
    await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll(
          '.reader-sidebar-footer [role="group"][aria-label="Appearance"] button',
        ),
      )

      return (
        buttons
          .find((button) => (button.textContent || "").includes("Dark"))
          ?.getAttribute("aria-pressed") || ""
      )
    }),
    "true",
    "restored Dark stays pressed",
  )

  await page.evaluate(() => document.querySelector('[data-slot="sidebar-trigger"]')?.click())
  await page.waitForFunction(
    () =>
      document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "collapsed",
    null,
    { timeout: 5000 },
  )
  await page.evaluate(() => document.querySelector('[data-slot="sidebar-trigger"]')?.click())
  await page.waitForFunction(
    () =>
      document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded",
    null,
    { timeout: 5000 },
  )

  const afterToggle = await page.evaluate(async () => {
    let hasReg = false
    let count = 0

    try {
      hasReg = !!(await navigator.serviceWorker.getRegistration())
    } catch {}

    try {
      count = (await caches.keys()).length
    } catch {}

    return { hasReg, count }
  })

  assert.equal(afterToggle.hasReg, false, "toggling the sidebar does not register a worker")
  assert.equal(afterToggle.count, 0, "toggling the sidebar does not download")

  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll(
        '.reader-sidebar-footer [role="group"][aria-label="Appearance"] button',
      ),
    )

    buttons.find((button) => (button.textContent || "").includes("System"))?.click()
  })
}

function listFilesRecursive(dir, relative = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name

    if (entry.isDirectory()) files.push(...listFilesRecursive(path.join(dir, entry.name), rel))
    else if (entry.isFile()) files.push(rel)
  }

  return files.sort()
}

/** Staged Markdown path -> expected static-export HTML path (posix). */
function expectedHtmlForStagedMarkdown(rel) {
  const posix = rel.split(path.sep).join("/")

  if (/^index\.md$/i.test(path.posix.basename(posix))) {
    const dir = path.posix.dirname(posix)

    return dir === "." ? "index.html" : `${dir}.html`
  }

  return `${posix.replace(/\.md$/i, "")}.html`
}

/**
 * Virtual folder HTML paths at or below generated directory navigation
 * roots (dirs with Markdown, no index). Ancestors above a configured nested
 * root never derive folders; Markdown roots create none.
 */
function deriveVirtualHtmls(contentDir, navigationRoots = []) {
  const dirRoots = navigationRoots
    .filter((entry) => entry && entry.kind === "directory" && String(entry.path) === entry.path)
    .map((entry) => entry.path.split(path.sep).join("/"))

  const isEligible = (dir) => dirRoots.some((root) => dir === root || dir.startsWith(`${root}/`))
  const staged = listFilesRecursive(contentDir)
  const markdown = staged.filter((rel) => /\.md$/i.test(rel))
  const dirs = new Set()

  for (const rel of markdown) {
    const posix = rel.split(path.sep).join("/")
    const parts = posix.split("/").slice(0, -1)

    for (let i = 1; i <= parts.length; i++) {
      const dir = parts.slice(0, i).join("/")

      if (isEligible(dir)) dirs.add(dir)
    }
  }

  const virtual = []

  for (const dir of dirs) {
    const abs = path.join(contentDir, ...dir.split("/"))
    let hasIndex = false

    try {
      for (const entry of fs.readdirSync(abs)) {
        if (/^index\.md$/i.test(entry)) {
          hasIndex = true
          break
        }
      }
    } catch {
      continue
    }

    if (!hasIndex) virtual.push(`${dir}.html`)
  }

  return virtual.sort()
}

function readOut(outDir, rel) {
  return fs.readFileSync(path.join(outDir, rel), "utf8")
}

/** Assert a private path or sentinel appears in no emitted file. */
function assertAbsentEverywhere(outDir, needle, label) {
  const hits = []

  for (const rel of listFilesRecursive(outDir)) {
    const abs = path.join(outDir, rel)
    const buffer = fs.readFileSync(abs)

    if (buffer.includes(needle)) hits.push(rel)
  }

  assert.deepEqual(
    hits,
    [],
    `${label} must appear in no emitted file (found in: ${hits.join(", ")})`,
  )
}

function lastEditedFromHtml(html) {
  const match = html.match(
    /<p class="reader-last-edited">Last edited <time date[Tt]ime="([^"]+)">([^<]+)<\/time><\/p>/,
  )

  if (!match) return null

  return { datetime: match[1], display: match[2] }
}

/** Search excerpts highlight matches with <mark>; strip it for text checks. */
function stripSearchMarks(value) {
  return String(value ?? "").replace(/<\/?mark>/g, "")
}

/** Card links inside the home area list, in rendered order. */
function areaListSection(home) {
  const start = home.indexOf("reader-area-list")

  if (start === -1) return ""

  return home.slice(start).split("</ul>")[0]
}

function areaListLinks(home) {
  const section = areaListSection(home)
  const links = []

  for (const tag of section.matchAll(/<a\b[^>]*>/g)) {
    const href = tag[0].match(/href="([^"]+)"/)?.[1]
    const kind = tag[0].match(/data-kind="(folder|note)"/)?.[1]

    if (href && kind) links.push({ href, kind })
  }

  return links
}

function countOccurrences(hay, needle) {
  return hay.split(needle).length - 1
}

/**
 * Complete static-export inspection, folded from the retired static suite
 * and the static halves of the home-card, breadcrumb, projection,
 * last-edited, and note suites. Runs on the finished export before it is
 * served: page-set equality, home cards, rich syntax, canonical metadata,
 * install manifest, output safety, runtime inspection, search coverage,
 * breadcrumb trails, last-edited lines, and the offline precache.
 */
async function runStaticExportChecks({
  outDir,
  contentDir,
  metadata,
  workDir,
  kbRoot,
  areaRoutes,
  machineryBefore,
}) {
  const stagedMarkdown = listFilesRecursive(contentDir).filter((rel) => /\.md$/i.test(rel))
  assert.ok(stagedMarkdown.length > 0, "staged tree holds Markdown pages")
  const stagedHtmls = stagedMarkdown.map(expectedHtmlForStagedMarkdown).sort()
  const virtualHtmls = deriveVirtualHtmls(contentDir, metadata.navigation)
  assert.ok(virtualHtmls.includes("notes.html"), "virtual folder notes.html is derived")
  assert.ok(virtualHtmls.includes("orchard.html"), "virtual folder orchard.html is derived")
  assert.ok(virtualHtmls.includes("notes/nest.html"), "nested virtual folder is derived")
  assert.ok(virtualHtmls.includes("notes/nest/inner.html"), "deep nested virtual folder is derived")
  const expectedPages = [...new Set([...stagedHtmls, ...virtualHtmls])].sort()

  for (const rel of expectedPages) {
    assert.ok(
      fs.existsSync(path.join(outDir, rel)),
      `staged or virtual page must be emitted: ${rel}`,
    )
  }

  const emittedContentPages = listFilesRecursive(outDir)
    .filter((rel) => rel.endsWith(".html") && !rel.startsWith("_next"))
    .filter((rel) => rel !== "404.html" && rel !== "_not-found.html")
    .sort()

  assert.deepEqual(
    emittedContentPages,
    expectedPages,
    "emitted pages match staged Markdown plus virtual folders exactly",
  )

  // Authored Home keeps its introduction above ordered registry cards; the
  // synthetic fallback never renders alongside authored content.
  const home = readOut(outDir, "index.html")
  assert.match(home, /Synthetic Garden Home/, "authored root introduction renders")
  assert.ok(
    !home.includes("Browse the published sections."),
    "synthetic fallback is not duplicated",
  )
  assert.ok(home.includes('data-slot="card"'), "cards use the registry Card surface")

  const positions = ["Lone Pine", "Orchard", "Notes", "Garden Plots"].map((text) =>
    home.indexOf(text),
  )

  assert.ok(
    positions.every((pos) => pos !== -1),
    "home cards cover every published root",
  )
  assert.ok(
    positions.every((pos, i, all) => i === 0 || all[i - 1] < pos),
    "home cards keep metadata order",
  )

  const links = areaListLinks(home)

  assert.deepEqual(
    links.map((l) => l.href),
    areaRoutes,
    "cards link only published routes in order",
  )
  assert.deepEqual(
    links.map((l) => l.kind),
    ["note", "folder", "folder", "folder"],
    "folder and note cards carry distinct cues",
  )
  assert.match(home, /Folder · 12 items/, "flat folder count is accurate")
  assert.match(home, /Folder · 2 items/, "authored folder count is accurate")

  const section = areaListSection(home)

  const metas = [...section.matchAll(/reader-home-card-meta[^>]*>([^<]*)</g)].map((m) =>
    m[1].trim(),
  )

  assert.ok(metas.length > 0, "folder/note cards carry a kind meta line")

  for (const meta of metas) {
    assert.match(
      meta,
      /^(Folder|Note)( · \d+ items?)?$/,
      `card meta stays kind plus count: ${meta}`,
    )
  }

  assert.ok(!home.includes("Hidden Draft"), "routes outside navigation never become cards")
  assert.ok(!/href="\/"/.test(section), "no Home self-link card")

  // Indexed folder owns its route and introduction; virtual folders supply titles.
  const garden = readOut(outDir, "garden.html")
  assert.match(garden, /Garden Plots/, "authored folder introduction renders")
  assert.ok(garden.includes('href="/garden/alpha"'), "folder body links to emitted note route")
  assert.ok(garden.includes("Alpha Bed"), "folder body names its notes")
  const orchard = readOut(outDir, "orchard.html")
  assert.match(orchard, /<h1[^>]*>Orchard<\/h1>/, "virtual flat folder supplies a humanized title")

  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, "0")
    assert.ok(orchard.includes(`Orchard Note ${n}`), `flat directory lists note ${n}`)
  }

  const nested = readOut(outDir, "notes/nest/inner.html")
  assert.match(nested, /<h1[^>]*>Inner<\/h1>/, "nested virtual folder supplies a humanized title")
  assert.match(nested, /Inner Leaf/, "nested virtual folder links its leaf")
  const standalone = readOut(outDir, "standalone.html")
  assert.match(standalone, /Lone Pine/, "standalone Markdown root renders")

  // Rich syntax renders through the maintained pipeline.
  const guide = readOut(outDir, "notes/guide.html")
  assert.match(
    guide,
    /<title>Field Guide \| Synthetic Garden<\/title>/,
    "explicit frontmatter title wins",
  )
  assert.match(guide, /<table[\s>]/, "tables render")
  assert.match(guide, /type="checkbox"/, "task lists render")
  assert.match(guide, /<a href="https:\/\/example\.com\/field-guide"/, "external links render")
  assert.match(
    guide,
    /<img[^>]+src="https:\/\/example\.com\/photos\/very-wide-panoramic-meadow-view\.jpg"/,
    "external images render",
  )
  assert.match(guide, /<pre[^>]*><code/, "fenced code blocks render")
  assert.match(
    guide,
    /<code[^>]*>[\s\S]*\[\[Field Guide\]\][\s\S]*<\/code>/,
    "wikilink-like text inside code blocks stays literal",
  )
  assert.match(
    guide,
    /<a href="\/notes\/plain" class="internal"[^>]*>Plain Meadow<\/a>/,
    "title-based wikilink resolves",
  )
  assert.match(
    guide,
    /<a href="Missing Page" class="internal new"[^>]*>Missing Page<\/a>/,
    "missing targets render unresolved without failing the build",
  )

  const plain = readOut(outDir, "notes/plain.html")
  assert.match(
    plain,
    /<title>Plain Meadow \| Synthetic Garden<\/title>/,
    "first H1 supplies the title",
  )

  const longPage = readOut(outDir, `notes/${LONG_SLUG}.html`)
  assert.ok(longPage.includes("An extremely long packing checklist title"), "long title renders")

  // Non-Markdown staged files never become pages.
  assert.ok(
    !fs.existsSync(path.join(outDir, "assets/photo.html")),
    "assets/photo.html is not emitted",
  )

  const strayBinaries = listFilesRecursive(outDir).filter((rel) => /\.(png|pdf)$/i.test(rel))
  assert.deepEqual(strayBinaries, [], "no staged binary is emitted as a page asset")

  // Generated canonical metadata.
  assert.match(
    home,
    /<title>Synthetic Garden Home \| Synthetic Garden<\/title>|<title>Synthetic Garden<\/title>/,
    "landing document title",
  )

  for (const [label, html] of [
    ["landing", home],
    ["guide", guide],
  ]) {
    assert.match(
      html,
      /synthetic\.example\.com/,
      `${label} metadata carries the canonical hostname`,
    )
  }

  assert.match(
    guide,
    /rel="canonical" href="https:\/\/synthetic\.example\.com\/notes\/guide"/,
    "note canonical URL",
  )

  // Per-projection install metadata: generated title, site-local start URL,
  // standalone display, and generic Publisher-owned icons.
  assert.ok(
    fs.existsSync(path.join(outDir, "manifest.webmanifest")),
    "static export carries a per-projection app manifest",
  )
  const webManifest = JSON.parse(readOut(outDir, "manifest.webmanifest"))
  assert.equal(webManifest.name, metadata.title, "manifest name uses the generated title")
  assert.equal(webManifest.start_url, "/", "manifest start URL stays site-local")
  assert.equal(webManifest.scope, "/", "manifest scope stays site-local")
  assert.equal(webManifest.display, "standalone", "manifest uses standalone display")
  assert.ok(
    Array.isArray(webManifest.icons) && webManifest.icons.length > 0,
    "manifest lists generic Publisher-owned icons",
  )

  for (const icon of webManifest.icons) {
    assert.ok(
      String(icon.src) === icon.src && icon.src.startsWith("/"),
      "manifest icon stays site-local",
    )
    const iconRel = icon.src.replace(/^\//, "")
    assert.ok(fs.existsSync(path.join(outDir, iconRel)), `manifest icon is emitted: ${iconRel}`)
  }

  const manifestLinks = [...home.matchAll(/<link\b[^>]*\brel="manifest"[^>]*>/g)]
  assert.equal(manifestLinks.length, 1, "landing links one per-projection app manifest")
  assert.match(
    manifestLinks[0][0],
    /\bcrossorigin="use-credentials"/,
    "protected manifest fetch sends the Access session cookie",
  )

  for (const rel of expectedPages) {
    assert.match(
      readOut(outDir, rel),
      /<link rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials"\/>/,
      `published page requests the protected manifest with credentials: ${rel}`,
    )
  }

  // Bounded output safety inspection.
  assertAbsentEverywhere(outDir, UNSELECTED_SENTINEL, "unselected sentinel")
  assertAbsentEverywhere(outDir, fs.realpathSync(kbRoot), "original vault path")
  assertAbsentEverywhere(outDir, fs.realpathSync(workDir), "private staging path")
  assertAbsentEverywhere(outDir, fs.realpathSync(PUBLISHER_ROOT), "private publisher checkout path")

  // Generated content stays untracked and ignored.
  const porcelain = (
    await execFileAsync("git", ["status", "--porcelain"], { cwd: PUBLISHER_ROOT })
  ).stdout
    .split("\n")
    .filter(Boolean)

  const generated = porcelain.filter((line) =>
    /^(?:\?\?|..) (content\/|site-identity\.json|reader\/\.source\/|reader\/\.next\/|reader\/out\/)/.test(
      line,
    ),
  )

  assert.deepEqual(
    generated,
    [],
    `generated content must stay untracked (got: ${generated.join("; ")})`,
  )

  for (const ignored of ["reader/.source", "reader/.next", "reader/out"]) {
    const check = await execFileAsync("git", ["check-ignore", ignored], { cwd: PUBLISHER_ROOT })
    assert.match(
      check.stdout,
      new RegExp(ignored.replace(/\./g, "\\.")),
      `${ignored} is git-ignored`,
    )
  }

  // Static and read-only runtime: fixed deps, static export, no API routes.
  const pkg = JSON.parse(fs.readFileSync(path.join(READER_ROOT, "package.json"), "utf8"))

  const allowedDeps = new Set([
    "@base-ui/react",
    "@flowershow/remark-wiki-link",
    "class-variance-authority",
    "cn",
    "fumadocs-core",
    "fumadocs-mdx",
    "lucide-react",
    "minisearch",
    "next",
    "react",
    "react-dom",
    "tw-animate-css",
  ])

  for (const name of Object.keys(pkg.dependencies || {})) {
    assert.ok(allowedDeps.has(name), `reader runtime dependency ${name} is expected`)
  }

  const config = fs.readFileSync(path.join(READER_ROOT, "next.config.mjs"), "utf8")
  assert.match(config, /output:\s*["']export["']/, "reader emits a serverless static export")

  const routeFiles = listFilesRecursive(path.join(READER_ROOT, "app")).filter((rel) =>
    /(^|\/)route\.ts$/.test(rel),
  )

  assert.deepEqual(routeFiles, [], "reader has no content API routes")
  const emitted = listFilesRecursive(outDir)
  assert.ok(
    !emitted.some((rel) => /pagefind/i.test(rel)),
    "static output carries no pagefind bundle",
  )

  // Offline generation from the finished export: a self-contained Workbox
  // worker plus a reader-facing manifest, both derived from emitted files
  // only (no Knowledge Base, staging tree, or content API input).
  assert.ok(fs.existsSync(path.join(outDir, "sw.js")), "static export carries an offline worker")
  assert.ok(
    fs.existsSync(path.join(outDir, "offline.json")),
    "static export carries an offline manifest",
  )
  const swText = readOut(outDir, "sw.js")
  assert.match(swText, /precache/, "offline worker uses a Workbox revisioned precache")
  assert.match(swText, /self\.location\.origin/, "offline worker stays on the projection origin")
  assert.match(
    swText,
    /uri\.html|index\.html/,
    "offline worker mirrors the nginx extensionless mapping",
  )
  assert.ok(
    !/https?:\/\/[^"'\s]*cloudflare/i.test(swText),
    "offline worker precaches no access host",
  )
  const offlineManifest = JSON.parse(readOut(outDir, "offline.json"))
  assert.ok(
    String(offlineManifest.version) === offlineManifest.version &&
      offlineManifest.version.length > 0,
    "offline manifest carries a version",
  )
  assert.ok(
    Object.prototype.toString.call(offlineManifest.totalBytes) === "[object Number]" &&
      offlineManifest.totalBytes > 0,
    "offline manifest carries an estimated size",
  )
  assert.ok(Array.isArray(offlineManifest.urls), "offline manifest lists urls")

  for (const url of offlineManifest.urls) {
    assert.ok(String(url) === url && url.startsWith("/"), `offline url stays site-local: ${url}`)
    assert.ok(!url.split("/").includes(".."), `offline url never traverses: ${url}`)
    assert.ok(!/^https?:/i.test(url), `offline url is never cross-origin: ${url}`)
  }

  // Every published page (authored plus virtual) is listed for the offline
  // save; the search index and the install manifest travel with them.
  for (const rel of expectedPages) {
    assert.ok(
      offlineManifest.urls.includes(`/${rel}`),
      `offline manifest covers published page: ${rel}`,
    )
  }

  for (const rel of ["search-index.json", "manifest.webmanifest"]) {
    assert.ok(
      offlineManifest.urls.includes(`/${rel}`),
      `offline manifest covers required file: ${rel}`,
    )
  }

  let manifestBytes = 0

  for (const url of offlineManifest.urls) {
    const rel = url.replace(/^\//, "")
    manifestBytes += fs.statSync(path.join(outDir, rel)).size
  }

  assert.equal(
    offlineManifest.totalBytes,
    manifestBytes,
    "offline estimated size matches the listed export files",
  )

  // Workbox precache entries revision every listed file by content hash,
  // reuse hashed `_next/static` URLs without a revision query, and guard
  // every fetch with the exact export bytes: a redirected sign-in page
  // fails integrity instead of being cached as publication.
  const precacheEntries = [
    ...swText.matchAll(/\{url:"([^"]+)",revision:("[^"]+"|null)(?:,integrity:"([^"]+)")?\}/g),
  ].map(([, url, revision, integrity]) => ({ url, revision, integrity }))

  assert.ok(precacheEntries.length > 0, "offline worker inlines precache entries")

  for (const url of offlineManifest.urls) {
    const entryUrl = url.replace(/^\//, "")
    assert.ok(
      precacheEntries.some((entry) => entry.url === entryUrl),
      `precache covers offline url: ${url}`,
    )
  }

  for (const entry of precacheEntries) {
    assert.match(
      entry.integrity ?? "",
      /^sha384-[A-Za-z0-9+/]+={0,2}$/,
      `precache entry guards exact bytes: ${entry.url}`,
    )

    if (entry.url.startsWith("_next/static/")) {
      assert.equal(entry.revision, "null", `hashed asset reuses its URL: ${entry.url}`)
    } else if (entry.url.endsWith(".html") || entry.url === "search-index.json") {
      assert.match(
        entry.revision ?? "",
        /^"[0-9a-f]{16,}"$/,
        `published file carries a content revision: ${entry.url}`,
      )
    }
  }

  // The integrity guard matches the real file: recompute it for the search
  // index and one published page.
  for (const rel of ["search-index.json", "standalone.html"]) {
    const entry = precacheEntries.find((candidate) => candidate.url === rel)
    assert.ok(entry, `precache lists ${rel}`)

    const digest = createHash("sha384")
      .update(fs.readFileSync(path.join(outDir, rel)))
      .digest("base64")

    assert.equal(entry.integrity, `sha384-${digest}`, `integrity matches ${rel} bytes`)
  }

  // Build-time full-text search index over staged content only: the export
  // carries one static JSON file, with no runtime service or dynamic route.
  const searchIndexRel = "search-index.json"
  assert.ok(
    fs.existsSync(path.join(outDir, searchIndexRel)),
    "static export carries a build-time search index",
  )
  const searchIndexRaw = readOut(outDir, searchIndexRel)
  JSON.parse(searchIndexRaw) // the static client must be able to parse it

  // Coverage: titles of staged pages, including the published page omitted
  // from navigation; plus heading and body samples.
  for (const title of [
    "Synthetic Garden Home",
    "Garden Plots",
    "Alpha Bed",
    "Beta Bed",
    "Field Guide",
    "Plain Meadow",
    "Inner Leaf",
    "Lone Pine",
    "Orchard Note 01",
    "Orchard Note 12",
    "Valid Zulu",
    "Valid Offset",
    "Hidden Draft",
    "An extremely long packing checklist title",
  ]) {
    assert.ok(searchIndexRaw.includes(title), `search index covers staged title: ${title}`)
  }

  for (const token of ["Details", "Cultivated beds", "Flat orchard note", "Deep nested note"]) {
    assert.ok(searchIndexRaw.includes(token), `search index covers heading/body text: ${token}`)
  }

  // Exclusions: the unselected sentinel and binary content never enter the index.
  for (const [label, token] of [
    ["unselected sentinel", UNSELECTED_SENTINEL],
    ["staged binary", "not-a-real-png"],
  ]) {
    assert.ok(!searchIndexRaw.includes(token), `search index excludes ${label}`)
  }

  // The published page omitted from navigation stays out of presentation
  // but stays searchable.
  assert.ok(!home.includes("Hidden Draft"), "hidden-navigation page stays out of the home listing")

  // Engine behavior through the reader's own search module against the
  // finished export: the same load+search path the Search dialog will use.
  const searchModule = await import(path.join(READER_ROOT, "lib", "search.mjs"))
  const index = searchModule.loadSearchIndex(JSON.parse(searchIndexRaw))

  // Title matches carry a title, a location, and an excerpt tied to the match.
  const titled = searchModule.searchNotes(index, "Field Guide")
  assert.ok(titled.length > 0, "title query returns")
  assert.equal(titled[0].url, "/notes/guide", "title match reaches the guide")

  for (const hit of titled) {
    assert.ok(String(hit.title) === hit.title && hit.title.length > 0, "result carries a title")
    assert.ok(String(hit.url) === hit.url && hit.url.startsWith("/"), "result carries a location")
    assert.ok(
      String(hit.excerpt) === hit.excerpt && hit.excerpt.length > 0,
      "result carries an excerpt",
    )
    assert.ok(
      stripSearchMarks(hit.excerpt).toLowerCase().includes("field") ||
        stripSearchMarks(hit.excerpt).toLowerCase().includes("guide"),
      "each result excerpt ties to the matching text",
    )
  }

  assert.ok(
    stripSearchMarks(titled[0].excerpt).includes("Field Guide"),
    "top result carries the page title",
  )

  // The published page omitted from navigation is searchable.
  const hidden = searchModule.searchNotes(index, "hidden")
  assert.ok(hidden.length > 0, "hidden-navigation page is searchable")
  assert.ok(
    hidden.some((hit) => String(hit.url).startsWith("/hidden/secret")),
    "hidden query reaches the staged route",
  )

  // Excluded text never surfaces in search output.
  assert.deepEqual(
    searchModule.searchNotes(index, UNSELECTED_SENTINEL),
    [],
    "excluded text has no search output",
  )

  // Reading-header breadcrumb trails in static HTML: one landmark in the
  // header, full ancestry on the deep page, the staged title on the hidden
  // route, and no unselected leaks.
  assert.ok(home.includes('data-slot="sidebar-trigger"'), "static home keeps the trigger")
  assert.ok(home.includes('data-slot="breadcrumb"'), "static home renders the registry breadcrumb")
  assert.ok(home.includes('aria-label="Breadcrumb"'), "breadcrumb landmark keeps its name")
  assert.equal(
    countOccurrences(home, 'aria-label="Breadcrumb"'),
    1,
    "one breadcrumb trail in the header, no second row above article",
  )
  assert.match(home, /Home/, "home trail shows Home current")

  const deep = readOut(outDir, "notes/nest/inner/leaf.html")
  assert.ok(deep.includes("Inner Leaf"), "deep static page shows its current title")
  assert.ok(deep.includes('href="/notes"'), "deep static trail links Notes parent")
  assert.ok(deep.includes('href="/notes/nest"'), "deep static trail links Nest parent")
  assert.ok(deep.includes('href="/notes/nest/inner"'), "deep static trail links Inner parent")
  assert.ok(deep.includes('href="/"'), "deep static trail links Home")
  assert.equal(countOccurrences(deep, 'aria-label="Breadcrumb"'), 1, "deep page keeps one trail")
  assert.ok(garden.includes('href="/"'), "folder trail links Home")
  assert.ok(standalone.includes("Lone Pine"), "root note shows its authored title")

  const hiddenPage = readOut(outDir, "hidden/secret.html")
  assert.ok(
    hiddenPage.includes("Hidden Draft"),
    "outside-navigation route shows its actual staged title",
  )
  assert.ok(hiddenPage.includes('href="/"'), "hidden trail still links Home")
  assert.ok(
    longPage.includes("An extremely long packing checklist title"),
    "long-title page keeps its title",
  )
  assert.ok(!home.includes("Unselected"), "unselected sentinel stays out of home")
  assert.ok(!deep.includes("Unselected"), "unselected sentinel stays out of deep pages")

  // Last edited lines in static HTML: valid authored timestamps render
  // date, hour, minute, zone, and machine time; missing, invalid, and
  // date-only values never create a label; virtual folders never guess one.
  const offset = lastEditedFromHtml(readOut(outDir, "notes/valid-offset.html"))
  assert.ok(offset, "valid offset note renders Last edited")
  assert.equal(offset.display, "2026-09-20 14:30 UTC+02:00")
  assert.equal(offset.datetime, "2026-09-20T12:30:00.000Z")

  const zulu = lastEditedFromHtml(readOut(outDir, "notes/valid-z.html"))
  assert.ok(zulu, "valid Zulu note renders Last edited")
  assert.equal(zulu.display, "2026-08-27 05:49 UTC")
  assert.equal(zulu.datetime, "2026-08-27T05:49:53.387Z")

  for (const rel of [
    "notes/plain.html",
    "notes/date-only.html",
    "notes/feb-thirty.html",
    "garden.html",
    "index.html",
  ]) {
    const html = readOut(outDir, rel)
    assert.equal(lastEditedFromHtml(html), null, `${rel} omits Last edited`)
    assert.ok(!html.includes("Last edited"), `${rel} shows no freshness claim`)
  }

  for (const rel of ["notes.html", "notes/nest.html", "notes/nest/inner.html"]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `virtual page emitted: ${rel}`)
    assert.equal(lastEditedFromHtml(readOut(outDir, rel)), null, `${rel} omits a guessed label`)
  }

  for (const rel of ["notes/valid-offset.html", "notes/valid-z.html"]) {
    const html = readOut(outDir, rel)
    assert.ok(!/synchron/i.test(html), `${rel} never implies sync`)
    assert.ok(!/drift/i.test(html), `${rel} never implies drift`)
    assert.ok(!/up to date/i.test(html), `${rel} never claims freshness`)
  }

  // The same source timestamp stays in the offline-saved static page: the
  // emitted HTML is what the Workbox precache stores, and it is listed.
  for (const rel of ["notes/valid-offset.html", "notes/valid-z.html"]) {
    assert.ok(offlineManifest.urls.includes(`/${rel}`), `offline manifest covers ${rel}`)
    assert.ok(
      readOut(outDir, rel).includes("2026-"),
      `offline-saved page keeps its source timestamp: ${rel}`,
    )
  }

  // Static export carries the projection switcher with the current projection.
  assert.ok(home.includes("reader-projection-trigger"), "static HTML carries the switcher")
  assert.ok(home.includes(SYNTHETIC_TITLE), "static HTML names the current projection")

  // Publisher machinery stays unchanged by the reader test run itself: the
  // run introduces no new touches beyond what the working tree already held
  // (the consolidation item itself deletes the spike script and prunes a
  // devDependency, so an absolute-emptiness check cannot hold here).
  const machineryAfter = porcelain.filter((line) =>
    /(^| )(nginx\.conf|package\.json|pnpm-lock\.yaml|scripts\/|tools\/)/.test(line.trim()),
  )

  assert.deepEqual(
    machineryAfter,
    machineryBefore,
    `reader test run must leave Publisher machinery unchanged (got: ${machineryAfter.join("; ")})`,
  )
}

/**
 * Home card slice on desktop, folded from the retired home-cards suite:
 * ordered links, distinct folder/note cues, accurate counts, kind-only
 * meta, hidden-route exclusion, Home self-link omission, containment,
 * and touch targets.
 */
async function runHomeCardsDetail(page, baseUrl, expect) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => ({
      text: a.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
      kind: a.getAttribute("data-kind") || "",
      card: !!a.querySelector('[data-slot="card"]'),
    })),
  )

  assert.deepEqual(
    cards.map((c) => c.href),
    expect.areaRoutes,
    "cards link published routes in order",
  )
  assert.deepEqual(
    cards.map((c) => c.kind),
    ["note", "folder", "folder", "folder"],
    "cards keep distinct folder/note cues",
  )

  for (const [index, title] of expect.areas.entries()) {
    assert.ok(cards[index].text.includes(title), `card keeps its published title: ${title}`)
  }

  for (const card of cards) {
    assert.ok(card.card, "card uses the registry Card surface")
    assert.ok(card.kind === "folder" || card.kind === "note", "distinct folder/note cue")
  }

  assert.ok(!cards.some((c) => c.href === "/"), "no Home self-link card")
  assert.ok(
    !cards.some((c) => c.text.includes("Hidden Draft")),
    "routes outside navigation never become cards",
  )

  const metas = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-area-list .reader-home-card-meta")).map(
      (el) => el.textContent?.trim() || "",
    ),
  )

  assert.ok(metas.length > 0, "cards carry a kind meta line")

  for (const meta of metas) {
    assert.match(
      meta,
      /^(Folder|Note)( · \d+ items?)?$/,
      `card meta stays kind plus count: ${meta}`,
    )
  }

  const cardText = cards.map((c) => c.text).join("\n")
  assert.match(cardText, /Folder · 12 items/, "flat folder count is accurate")
  assert.match(cardText, /Folder · 2 items/, "authored folder count is accurate")

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))

  assert.ok(
    overflow.doc <= overflow.inner + 1,
    `document width ${overflow.doc} inside viewport ${overflow.inner}`,
  )
  assert.ok(
    overflow.body <= overflow.inner + 1,
    `body width ${overflow.body} inside viewport ${overflow.inner}`,
  )

  const titlesFit = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-area-list .reader-home-card-title")).map(
      (el) => ({
        right: el.getBoundingClientRect().right,
        inner: window.innerWidth,
      }),
    ),
  )

  for (const title of titlesFit) {
    assert.ok(title.right <= title.inner + 1, "long card title stays inside the viewport")
  }

  const heights = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-area-list a")).map(
      (a) => a.getBoundingClientRect().height,
    ),
  )

  for (const height of heights) {
    assert.ok(height >= 44, `card link touch target is ${height}px (expected >= 44)`)
  }
}

/**
 * Breadcrumb slice on desktop, folded from the retired breadcrumbs suite:
 * deep ancestry by visible text, parent navigation plus Back, the
 * hidden-route staged title, registry composition, and keyboard reach.
 */
async function runBreadcrumbsDetail(page, baseUrl, expect) {
  await page.goto(`${baseUrl}${expect.deepRoute}`, { waitUntil: "networkidle", timeout: 15000 })

  const deep = await page.evaluate(() => ({
    crumbs: Array.from(
      document.querySelectorAll(".reader-breadcrumbs [data-slot='breadcrumb-item']"),
    ).map((li) => ({
      text: li.textContent?.trim() || "",
      href: li.querySelector("a")?.getAttribute("href") || null,
    })),
    h1: document.querySelector("article h1")?.textContent?.trim() || "",
    mainCount: document.querySelectorAll("main").length,
    trigger: !!document.querySelector('[data-slot="sidebar-trigger"]'),
    breadcrumbSlot: !!document.querySelector('[data-slot="breadcrumb"]'),
    breadcrumbList: !!document.querySelector('[data-slot="breadcrumb-list"]'),
  }))

  assert.ok(deep.trigger, "header keeps the registry trigger")
  assert.ok(deep.breadcrumbSlot, "header renders the registry breadcrumb")
  assert.ok(deep.breadcrumbList, "header renders the registry list")
  assert.ok(
    deep.crumbs.length >= 4,
    `deep trail keeps ancestry (got ${deep.crumbs.map((c) => c.text).join(" / ")})`,
  )
  assert.ok(
    deep.crumbs[deep.crumbs.length - 1].text.includes(expect.deepTitle),
    "trail ends at the deep note",
  )
  assert.equal(deep.h1, expect.deepTitle, "deep article title matches the trail")
  assert.equal(deep.mainCount, 1, "one main landmark on the deep note")

  const parentHref = deep.crumbs[1].href
  assert.ok(parentHref, "deep trail links a parent")
  await Promise.all([
    page.waitForFunction(
      (href) => window.location.pathname === href || window.location.pathname === `${href}/`,
      parentHref,
      { timeout: 15000 },
    ),
    page.evaluate((href) => {
      document.querySelector(`.reader-breadcrumbs a[href="${href}"]`)?.click()
    }, parentHref),
  ])
  await page.waitForLoadState("networkidle", { timeout: 15000 })
  assert.ok(page.url().includes(parentHref), "breadcrumb parent navigates")
  await page.goBack()
  await page.waitForFunction((route) => window.location.href.includes(route), expect.deepRoute, {
    timeout: 15000,
  })
  assert.ok(page.url().includes(expect.deepRoute), "browser Back returns to the deep note")

  await page.goto(`${baseUrl}${expect.hiddenRoute}`, { waitUntil: "networkidle", timeout: 15000 })
  await page.waitForFunction(
    (title) =>
      document.querySelector("[data-slot='breadcrumb-page']")?.textContent?.includes(title) ||
      false,
    expect.hiddenTitle,
    { timeout: 5000 },
  )

  const hidden = await page.evaluate(() => ({
    crumbs: Array.from(
      document.querySelectorAll(".reader-breadcrumbs [data-slot='breadcrumb-item']"),
    ).map((li) => ({
      text: li.textContent?.trim() || "",
      href: li.querySelector("a")?.getAttribute("href") || null,
    })),
    h1: document.querySelector("article h1")?.textContent?.trim() || "",
  }))

  assert.ok(
    hidden.crumbs[hidden.crumbs.length - 1].text.includes(expect.hiddenTitle),
    `hidden trail shows the staged title (got ${hidden.crumbs.map((c) => c.text).join(" / ")})`,
  )
  assert.ok(hidden.h1.includes(expect.hiddenTitle), "hidden article title")
  assert.ok(
    hidden.crumbs[0].href === "/" || hidden.crumbs[0].text.includes("Home"),
    "hidden trail links Home",
  )

  // Keyboard: Tab reaches a breadcrumb link with visible focus.
  await page.goto(`${baseUrl}${expect.deepRoute}`, { waitUntil: "networkidle", timeout: 15000 })
  await page.evaluate(() => document.querySelector('[data-slot="sidebar-trigger"]')?.focus())
  let focused = ""

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab")
    focused = await page.evaluate(() => document.activeElement?.textContent?.trim() || "")

    const tag = await page.evaluate(
      () => document.activeElement?.closest(".reader-breadcrumbs")?.textContent?.trim() || "",
    )

    if (tag) break
  }

  assert.ok(focused.length > 0, "keyboard reaches the header trail")

  const outline = await page.evaluate(() => {
    const el = document.activeElement

    if (!el) return null
    const s = getComputedStyle(el)

    return { style: s.outlineStyle, width: s.outlineWidth }
  })

  assert.equal(outline?.style, "solid", "header trail focus stays visible")
}

/**
 * Projection switcher on desktop, folded from the retired projection suite
 * minus its zero-destination variant (the canonical fixture declares two
 * destinations; emptiness is covered by stage-destinations validation):
 * the trigger always names the current Web Projection, the menu lists only
 * the declared destinations as ordinary anchors to distinct HTTPS origins,
 * and keyboard open/close returns focus. The real cross-origin probe runs
 * last because it leaves the export origin.
 */
async function runProjectionSwitcher(page, baseUrl, expect) {
  const failedUrls = []
  page.on("requestfailed", (request) => {
    failedUrls.push(request.url())
  })
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

  const trigger = await page.evaluate(() => {
    const el = document.querySelector(".reader-projection-trigger")

    if (!el) return null
    const rect = el.getBoundingClientRect()

    return { text: el.textContent?.trim() || "", visible: rect.width > 0 && rect.height > 0 }
  })

  assert.ok(trigger, "sidebar shows a projection switcher trigger")
  assert.ok(trigger.text.includes(expect.projection), "trigger names the current projection")
  assert.ok(trigger.visible, "switcher trigger is visible")

  await page.evaluate(() => document.querySelector(".reader-projection-trigger")?.click())
  await page.waitForSelector(".reader-projection-menu", { state: "visible", timeout: 5000 })

  const menu = await page.evaluate(() => {
    const root = document.querySelector(".reader-projection-menu")

    if (!root) return null

    const items = Array.from(root.querySelectorAll('[data-slot="dropdown-menu-item"]')).map(
      (el) => ({
        text: el.textContent?.trim() || "",
        tag: el.tagName,
        href: el.getAttribute("href"),
        target: el.getAttribute("target"),
        current: el.getAttribute("aria-current"),
      }),
    )

    return { text: root.textContent || "", items }
  })

  assert.ok(menu, "switcher opens a menu")
  assert.equal(
    menu.items.length,
    1 + expect.destinations.length,
    "menu holds the current projection plus its choices",
  )
  assert.ok(!menu.text.includes("Add"), "menu offers no add-projection action")

  const [current, ...choices] = menu.items
  assert.equal(current.current, "true", "first item marks the current projection")
  assert.ok(current.text.includes(expect.projection), "current item names this projection")
  assert.deepEqual(
    choices.map((choice) => ({ text: choice.text, href: choice.href })),
    expect.destinations.map((destination) => ({
      text: destination.name,
      href: destination.origin,
    })),
    "choices keep manifest order with absolute HTTPS origins",
  )

  for (const choice of choices) {
    assert.equal(choice.tag, "A", "each choice is an ordinary anchor")
    assert.ok(choice.href?.startsWith("https://"), "each choice targets a secure origin")
    assert.equal(choice.target, null, "choices stay a same-tab normal navigation")
  }

  // Keyboard: Escape closes and returns focus to the trigger.
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => !document.querySelector(".reader-projection-menu"), null, {
    timeout: 5000,
  })

  const returned = await page.evaluate(() => document.activeElement?.className || "")
  assert.ok(
    String(returned).includes("reader-projection-trigger"),
    "Escape returns focus to the switcher trigger",
  )

  // Keyboard: focusing the trigger and pressing Enter reopens the menu.
  await page.evaluate(() => document.querySelector(".reader-projection-trigger")?.focus())
  await page.keyboard.press("Enter")
  await page.waitForSelector(".reader-projection-menu", { state: "visible", timeout: 5000 })
  await page.keyboard.press("Escape")
  await page.waitForFunction(() => !document.querySelector(".reader-projection-menu"), null, {
    timeout: 5000,
  })

  // Real cross-origin navigation: both choice domains are reserved example
  // names, so the request fails at DNS and the browser leaves this origin
  // for its error page; the failed-request log carries the destination
  // origin as proof of where the anchor pointed.
  await page.evaluate(() => document.querySelector(".reader-projection-trigger")?.click())
  await page.waitForSelector(".reader-projection-menu", { state: "visible", timeout: 5000 })
  await page.locator(".reader-projection-choice").first().click()
  await page
    .waitForURL((url) => url.href.startsWith(expect.destinations[0].origin), { timeout: 30000 })
    .catch(() => null)

  assert.ok(
    failedUrls.some((url) => url.startsWith(expect.destinations[0].origin)),
    `choice navigates to its distinct origin (failed requests: ${failedUrls.join(", ")})`,
  )
  assert.ok(
    !page.url().startsWith(baseUrl),
    `navigation leaves the current origin (got ${page.url()})`,
  )
}

/**
 * Last edited line in the browser, folded from the retired last-edited
 * suite (its parseUpdatedAt unit test stays in place): valid authored
 * timestamps render with machine time, missing and virtual pages omit.
 */
async function runLastEditedBrowser(page, baseUrl) {
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto(`${baseUrl}/notes/valid-offset`, { waitUntil: "networkidle", timeout: 15000 })

  const rendered = await page.evaluate(() => {
    const line = document.querySelector("p.reader-last-edited")
    const time = line?.querySelector("time")

    return {
      text: line?.textContent?.trim() || null,
      datetime: time?.getAttribute("datetime") || null,
      display: time?.textContent?.trim() || null,
    }
  })

  assert.ok(rendered.text?.startsWith("Last edited"), "browser shows Last edited")
  assert.equal(rendered.datetime, "2026-09-20T12:30:00.000Z")
  assert.equal(rendered.display, "2026-09-20 14:30 UTC+02:00")

  await page.goto(`${baseUrl}/notes/plain`, { waitUntil: "networkidle", timeout: 15000 })
  assert.equal(
    await page.evaluate(() => document.querySelector("p.reader-last-edited")),
    null,
    "browser omits the label without a valid timestamp",
  )

  await page.goto(`${baseUrl}/notes`, { waitUntil: "networkidle", timeout: 15000 })
  assert.equal(
    await page.evaluate(() => document.querySelector("p.reader-last-edited")),
    null,
    "browser omits a guessed virtual-folder label",
  )

  assert.deepEqual(errors, [], "no hydration or page errors on timestamp routes")
}

/**
 * Direct-note readability, folded from the retired note suite: document
 * title, H1, article body, tables, canonical metadata, refresh, plus the
 * virtual folder groups.
 */
async function runDirectNoteDetail(page, baseUrl, expect) {
  await page.goto(`${baseUrl}${expect.route}`, { waitUntil: "networkidle", timeout: 15000 })

  const note = await page.evaluate(() => {
    const article = document.querySelector("article.reader-article")
    const h1s = Array.from(document.querySelectorAll("article.reader-article h1"))
    const canonical = document.querySelector('link[rel="canonical"]')

    return {
      title: document.title,
      mainCount: document.querySelectorAll("main").length,
      articleExists: !!article,
      h1Texts: h1s.map((h) => h.textContent?.trim() || ""),
      bodyLength: (article?.textContent || "").trim().length,
      tableCount: article ? article.querySelectorAll("table").length : 0,
      hasExternalLink: !!article?.querySelector('a[href^="https://"]'),
      canonicalHref: canonical?.getAttribute("href") || null,
    }
  })

  assert.ok(
    note.title.includes(expect.title),
    `document title carries the note title ${expect.title}`,
  )
  assert.ok(
    note.title.includes(expect.siteTitle),
    "document title carries the generated site title",
  )
  assert.equal(note.mainCount, 1, "one main landmark")
  assert.ok(note.articleExists, "readable article element")
  assert.ok(
    note.h1Texts.includes(expect.h1),
    `authored H1 rendered (got: ${note.h1Texts.join("|")})`,
  )
  assert.ok(note.bodyLength > 200, `article body is substantial (got ${note.bodyLength} chars)`)
  assert.ok(note.tableCount >= 1, `tables rendered (got ${note.tableCount})`)
  assert.ok(note.hasExternalLink, "external links rendered")
  assert.equal(
    note.canonicalHref,
    `https://${expect.hostname}${expect.route}`,
    "canonical hostname metadata",
  )
  await page.reload({ waitUntil: "networkidle", timeout: 15000 })

  const afterReload = await page.evaluate(
    () => document.querySelector("article h1")?.textContent?.trim() || "",
  )

  assert.equal(afterReload, expect.h1, "refresh keeps the direct note")

  if (expect.virtualRoute && expect.virtualRoute !== "/") {
    await page.goto(`${baseUrl}${expect.virtualRoute}`, {
      waitUntil: "networkidle",
      timeout: 15000,
    })

    const folder = await page.evaluate(() => ({
      h1: document.querySelector("article h1")?.textContent?.trim() || "",
      groups: Array.from(document.querySelectorAll("article h2")).map((h) => h.textContent?.trim()),
    }))

    assert.equal(folder.h1, expect.virtualTitle, `virtual folder title ${expect.virtualTitle}`)
    assert.ok(
      folder.groups.includes("Notes") || folder.groups.includes("Folders"),
      "virtual folder uses generic groups",
    )
  }
}

test("synthetic browse journey covers home → folder → nested note → Back", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const kb = makeJourneyKb()
  const work = tmpdir("synthetic")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(kb, contentDir, identityFile)
  const metadata = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  const journey = deriveJourney(contentDir, metadata)

  const machineryBefore = (
    await execFileAsync("git", ["status", "--porcelain"], { cwd: PUBLISHER_ROOT })
  ).stdout
    .split("\n")
    .filter(Boolean)
    .filter((line) =>
      /(^| )(nginx\.conf|package\.json|pnpm-lock\.yaml|scripts\/|tools\/)/.test(line.trim()),
    )

  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)
  const outDir = path.join(READER_ROOT, "out")

  for (const rel of [
    "index.html",
    `${journey.folderRoute.replace(/^\//, "")}.html`,
    `${journey.leafRoute.replace(/^\//, "")}.html`,
  ]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `static export emits ${rel}`)
  }

  const areaRoutes = metadata.navigation.map((entry) => rootRoute(entry))
  await runStaticExportChecks({
    outDir,
    contentDir,
    metadata,
    workDir: work,
    kbRoot: kb,
    areaRoutes,
    machineryBefore,
  })

  const hiddenRoute = `/${HIDDEN_NOTE_PATH.replace(/\.md$/i, "")}`
  const hiddenTitle = stagedFileTitle(path.join(contentDir, HIDDEN_NOTE_PATH), "Hidden Draft")
  const deepRoute = "/notes/nest/inner/leaf"
  const deepTitle = stagedFileTitle(path.join(contentDir, "notes/nest/inner/leaf.md"), "Inner Leaf")

  const { server, baseUrl } = await serveOut(outDir)
  const browser = await launchBrowser()
  const context = await createDesktopContext(browser)
  const folderChildren = expectedFolderChildren(contentDir, journey.folderEntry.path)

  try {
    const treePage = await context.newPage()
    await treePage.setViewportSize({ width: 1280, height: 800 })
    await runTreeBehavior(treePage, baseUrl, {
      folderTitle: journey.folderTitle,
      folderRoute: journey.folderRoute,
      leafTitle: journey.leafTitle,
      leafRoute: journey.leafRoute,
      folderChildren,
    })
    await runSidebarCollapse(treePage, baseUrl, {
      projection: metadata.title,
      longRoute: `/notes/${LONG_SLUG}`,
    })
    await treePage.close()
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    await runJourney(page, baseUrl, {
      areas: journey.areas,
      areaRoutes,
      folderTitle: journey.folderTitle,
      folderRoute: journey.folderRoute,
      leafTitle: journey.leafTitle,
      leafRoute: journey.leafRoute,
    })
    await runDirectNoteDetail(page, baseUrl, {
      route: "/notes/guide",
      title: "Field Guide",
      h1: "Ignored H1",
      siteTitle: metadata.title,
      hostname: metadata.canonicalHostname,
      virtualRoute: "/notes",
      virtualTitle: "Notes",
    })
    await page.goto(`${baseUrl}${journey.leafRoute}`, {
      waitUntil: "networkidle",
      timeout: 15000,
    })
    assert.equal(
      await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim() || ""),
      journey.leafTitle,
      "direct nested note renders its title",
    )
    await runHomeCardsDetail(page, baseUrl, {
      areas: journey.areas,
      areaRoutes,
    })
    await runBreadcrumbsDetail(page, baseUrl, {
      deepRoute,
      deepTitle,
      hiddenRoute,
      hiddenTitle,
    })
    await runLastEditedBrowser(page, baseUrl)
    await page.close()
    const projectionPage = await context.newPage()
    await projectionPage.setViewportSize({ width: 1280, height: 800 })
    await runProjectionSwitcher(projectionPage, baseUrl, {
      projection: metadata.title,
      destinations: SYNTHETIC_DESTINATIONS,
    })
    await projectionPage.close()
    const searchPage = await context.newPage()
    await searchPage.setViewportSize({ width: 1280, height: 800 })
    await runSearchDialog(searchPage, baseUrl, {
      leafTitle: journey.leafTitle,
      leafRoute: journey.leafRoute,
    })
    await searchPage.close()
    await runSearchIndexLoading(context, baseUrl)
    await runSearchIndexFailure(context, baseUrl)
    const placementPage = await context.newPage()
    await placementPage.setViewportSize({ width: 1280, height: 800 })
    await runOfflineAppearancePlacement(placementPage, baseUrl)
    await placementPage.close()
    const offlineProbes = deriveOfflineProbes(contentDir, metadata, journey)
    await runOfflineSave(context, baseUrl, server, {
      offlineFolderRoute: offlineProbes.offlineFolderRoute,
      offlineFolderTitle: offlineProbes.offlineFolderTitle,
      offlineLeafRoute: offlineProbes.offlineLeafRoute,
      offlineLeafTitle: offlineProbes.offlineLeafTitle,
      failureTarget:
        offlineProbes.offlineLeafRoute === "/"
          ? "/index.html"
          : `${offlineProbes.offlineLeafRoute}.html`,
    })
    await runOfflineUpdate(context, baseUrl, outDir, {
      leafRoute: journey.leafRoute,
      leafTitle: journey.leafTitle,
      removedRoute: "/orchard/note-12",
    })
    await runOfflineRemove(context, baseUrl, {
      leafRoute: journey.leafRoute,
    })
  } finally {
    await browser.close()
    await closeServer(server)
  }
})

test("offline precache revisions follow exported files without a reader build", async () => {
  const offlineScript = path.join(READER_ROOT, "scripts", "build-offline.mjs")
  const dir = tmpdir("offline-revisions")

  const write = (rel, content) => {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }

  write("index.html", '<link rel="manifest" href="/manifest.webmanifest"/><h1>Home</h1>')
  write("note.html", '<link rel="manifest" href="/manifest.webmanifest"/><h1>Note</h1>')
  write("manifest.webmanifest", "{}")
  write("search-index.json", JSON.stringify({ ok: true }))
  write("_next/static/chunks/app-abc123.js", "console.log(1)")

  const runOffline = () =>
    execFileAsync(process.execPath, [offlineScript, "--dir", dir], {
      cwd: PUBLISHER_ROOT,
      timeout: 120000,
    })

  const revisionsOf = () => {
    const sw = fs.readFileSync(path.join(dir, "sw.js"), "utf8")
    const entries = new Map()

    for (const [, url, revision] of sw.matchAll(
      /\{url:"([^"]+)",revision:("[^"]+"|null)(?:,integrity:"[^"]+")?\}/g,
    )) {
      entries.set(url, revision)
    }

    return entries
  }

  await runOffline()
  const before = revisionsOf()
  assert.ok(before.has("note.html"), "precache lists the page")
  assert.ok(before.has("search-index.json"), "precache lists the search index")
  assert.equal(
    before.get("_next/static/chunks/app-abc123.js"),
    "null",
    "hashed asset reuses its URL without a revision query",
  )
  assert.match(
    fs.readFileSync(path.join(dir, "sw.js"), "utf8"),
    /integrity:"sha384-[^"]+"/,
    "precache entries guard exact export bytes",
  )
  const homeBefore = before.get("index.html")
  const hashedBefore = before.get("_next/static/chunks/app-abc123.js")

  write("note.html", '<link rel="manifest" href="/manifest.webmanifest"/><h1>Note changed</h1>')
  write("search-index.json", JSON.stringify({ ok: true, v: 2 }))
  await runOffline()
  const after = revisionsOf()
  assert.notEqual(
    after.get("note.html"),
    before.get("note.html"),
    "changed page gets a new revision",
  )
  assert.notEqual(
    after.get("search-index.json"),
    before.get("search-index.json"),
    "changed search index gets a new revision",
  )
  assert.equal(after.get("index.html"), homeBefore, "unchanged page keeps its revision")
  assert.equal(
    after.get("_next/static/chunks/app-abc123.js"),
    hashedBefore,
    "unchanged hashed asset keeps reusing its URL",
  )

  fs.rmSync(path.join(dir, "note.html"))
  await runOffline()
  assert.equal(
    [
      ...fs
        .readFileSync(path.join(dir, "index.html"), "utf8")
        .matchAll(/crossorigin="use-credentials"/g),
    ].length,
    1,
    "generated manifest link gains credentials only once across repeated offline builds",
  )
  const removed = revisionsOf()
  assert.ok(!removed.has("note.html"), "removed page leaves the precache")
  assert.ok(removed.has("index.html"), "remaining pages stay precached")
  // Update lifecycle preserves the reading session: the generated worker
  // waits for an explicit reload instead of claiming clients, while still
  // cleaning outdated caches so removed pages disappear after activation.
  const offlineSource = fs.readFileSync(offlineScript, "utf8")
  assert.match(offlineSource, /skipWaiting:\s*false/, "updated worker waits for Reload")
  assert.match(offlineSource, /clientsClaim:\s*false/, "updated worker never claims the session")
  assert.match(
    offlineSource,
    /cleanupOutdatedCaches:\s*true/,
    "successful update clears removed pages",
  )
})

test("offline generation rejects an export file omitted from the precache", async () => {
  const dir = tmpdir("offline-oversize")
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>Home</h1>")
  fs.writeFileSync(path.join(dir, "search-index.json"), "{}")
  fs.writeFileSync(path.join(dir, "large.html"), "")
  fs.truncateSync(path.join(dir, "large.html"), 5 * 1024 * 1024 + 1)
  await assert.rejects(
    execFileAsync(
      process.execPath,
      [path.join(READER_ROOT, "scripts", "build-offline.mjs"), "--dir", dir],
      {
        cwd: PUBLISHER_ROOT,
        timeout: 120000,
      },
    ),
    /large\.html|omitted|precache/i,
    "publishing must fail instead of claiming an incomplete offline copy",
  )
})

test("generic real corpus builds a complete static export from staged content only", async (t) => {
  const kbRoot = process.env.KNOWLEDGE_BASE_ROOT

  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip("KNOWLEDGE_BASE_ROOT is not set to a vault checkout; skipping real-corpus build")

    return
  }

  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const work = tmpdir("corpus")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  const outDir = path.join(READER_ROOT, "out")
  await stageKb(path.resolve(kbRoot), contentDir, identityFile)

  const metadata = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  assert.ok(metadata.title && metadata.title.trim() !== "", "generated metadata carries a title")
  assert.ok(
    metadata.canonicalHostname && metadata.canonicalHostname.trim() !== "",
    "generated metadata carries a canonical hostname",
  )
  assert.ok(
    Array.isArray(metadata.navigation) && metadata.navigation.length > 0,
    "generated navigation is non-empty",
  )

  for (const entry of metadata.navigation) {
    assert.ok(!path.isAbsolute(entry.path), "navigation paths stay relative")
    assert.ok(!entry.path.includes(".."), "navigation paths never traverse")
  }

  const stagedMarkdown = listFilesRecursive(contentDir).filter((rel) => /\.md$/i.test(rel))
  assert.ok(stagedMarkdown.length > 0, "staged tree holds Markdown pages")

  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)

  const stagedHtmls = stagedMarkdown.map(expectedHtmlForStagedMarkdown).sort()
  const virtualHtmls = deriveVirtualHtmls(contentDir, metadata.navigation)
  const expectedPages = [...new Set([...stagedHtmls, ...virtualHtmls])].sort()

  for (const rel of expectedPages) {
    assert.ok(
      fs.existsSync(path.join(outDir, rel)),
      `staged or virtual page must be emitted: ${rel}`,
    )
  }

  const emittedContentPages = listFilesRecursive(outDir)
    .filter((rel) => rel.endsWith(".html") && !rel.startsWith("_next"))
    .filter((rel) => rel !== "404.html" && rel !== "_not-found.html")
    .sort()

  assert.deepEqual(
    emittedContentPages,
    expectedPages,
    "emitted pages match staged Markdown plus virtual folders exactly",
  )

  // The generic build path inherits the search index without new orchestration.
  assert.ok(
    fs.existsSync(path.join(outDir, "search-index.json")),
    "generic build also emits the search index",
  )

  // Canonical metadata derives from generated metadata, not fixed subjects.
  const home = readOut(outDir, "index.html")
  assert.ok(home.includes(metadata.title), "home carries the generated title")
  assert.ok(home.includes(metadata.canonicalHostname), "home carries the canonical hostname")
  const firstPageRel = expectedPages.find((rel) => rel !== "index.html")
  assert.ok(firstPageRel, "staged corpus has a non-home page")
  const firstPage = readOut(outDir, firstPageRel)
  const firstRoute = `/${firstPageRel.replace(/\.html$/, "")}`
  assert.match(
    firstPage,
    new RegExp(
      `rel="canonical" href="https://${metadata.canonicalHostname.replace(/\./g, "\\.")}${firstRoute.replace(/\//g, "\\/")}"`,
    ),
    "page canonical URL uses generated hostname",
  )

  // Output safety stays generic: no private checkout paths in output.
  assertAbsentEverywhere(outDir, fs.realpathSync(path.resolve(kbRoot)), "original vault path")
  assertAbsentEverywhere(outDir, fs.realpathSync(work), "private staging path")
  assertAbsentEverywhere(outDir, fs.realpathSync(PUBLISHER_ROOT), "private publisher checkout path")
})

test("generic real browse journey covers home → folder → nested note", async (t) => {
  const kbRoot = process.env.KNOWLEDGE_BASE_ROOT

  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip("KNOWLEDGE_BASE_ROOT is not set to a vault checkout; skipping real-corpus journey")

    return
  }

  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const work = tmpdir("real")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(path.resolve(kbRoot), contentDir, identityFile)
  const metadata = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  const journey = deriveJourney(contentDir, metadata)
  cleanReaderArtifacts()
  await buildReader(contentDir, identityFile)
  const outDir = path.join(READER_ROOT, "out")

  for (const rel of [
    "index.html",
    `${journey.folderRoute.replace(/^\//, "")}.html`,
    `${journey.leafRoute.replace(/^\//, "")}.html`,
  ]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `real static export emits ${rel}`)
  }

  const { server, baseUrl } = await serveOut(outDir)
  const browser = await launchBrowser()
  const context = await createDesktopContext(browser)

  try {
    const page = await context.newPage()
    await page.setViewportSize({ width: 1280, height: 800 })
    await runJourney(page, baseUrl, {
      areas: journey.areas,
      areaRoutes: metadata.navigation.map((entry) => rootRoute(entry)),
      folderTitle: journey.folderTitle,
      folderRoute: journey.folderRoute,
      leafTitle: journey.leafTitle,
      leafRoute: journey.leafRoute,
    })
    await page.close()
  } finally {
    await browser.close()
    await closeServer(server)
  }
})
