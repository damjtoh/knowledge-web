/**
 * Knowledge reader integrated browser suite.
 *
 * One file, one canonical synthetic build: production static export +
 * nginx-style server + desktop and phone browsers. Covers the desktop
 * browse journey (home -> published folder -> nested note -> Back, tree
 * sidebar, collapse, search, offline save/update/remove) and the phone
 * journey (Browse drawer, overflow probes, keyboard, search, offline
 * placement, refresh), plus build-free offline revision checks and
 * env-gated real-corpus coverage.
 *
 * The synthetic fixture always runs (no vault needed). Expected areas,
 * folder titles, and note routes derive from staged content and generated
 * metadata, never from fixed subject routes. When KNOWLEDGE_BASE_ROOT points
 * at a vault checkout, the same generic journeys run against the real corpus.
 *
 * Single-build sharing: stageKb + buildReader run exactly once for the
 * canonical synthetic export (cached in-file promise; node:test runs a
 * file's tests serially by default). Each test serves the shared outDir on
 * its own port (per-origin isolation) so service workers and caches never
 * leak between tests. Ordering keeps the guarantee: the phone synthetic
 * test runs first on the pristine export; the desktop synthetic test runs
 * next and its offline-update flow (which rewrites one exported file and
 * removes another) comes last among pristine-dependent tests — the same
 * guarantee the old two-file layout had with separate builds. Env-gated
 * real-corpus tests keep their own builds and run last.
 *
 * Run with:
 *   npm test -- tests/knowledge-reader-integrated.test.mjs
 *   KNOWLEDGE_BASE_ROOT=/path/to/vault npm test -- tests/knowledge-reader-integrated.test.mjs
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
  withDesktopPage,
  withPhonePage,
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
  // Deep leaves page behind the more-row: reach it through explicit paging
  // before asserting the same rendered leaf endpoint.
  await revealTreeRoute(page, expect.leafRoute)

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
  await revealTreeRoute(page, expect.leafRoute)

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

/** Direct children of one tree branch, in rendered order (paging rows excluded). */
async function directTreeChildren(page, folderRoute) {
  return await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    if (!li) return null
    const panel = li.querySelector(":scope > .reader-tree-collapsible > .reader-tree-panel")

    if (!panel) return []

    return Array.from(panel.querySelectorAll(":scope > ul > li, :scope > div > ul > li"))
      .map((child) => {
        const row = child.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
        )

        const a = row ? row.querySelector("a") : null

        return { text: a?.textContent?.trim() || "", href: a?.getAttribute("href") || "" }
      })
      .filter((child) => child.href !== "")
  }, folderRoute)
}

/** More-row label inside one desktop branch, or null when all children show. */
async function treeMoreRow(page, folderRoute) {
  return await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    if (!li) return null

    const more = li.querySelector(
      ":scope > .reader-tree-collapsible > .reader-tree-panel [data-tree-more]",
    )

    return more ? more.textContent?.trim() || "" : null
  }, folderRoute)
}

/** Click the desktop more-row until exhausted so full children are visible. */
async function expandAllTreeRows(page, folderRoute) {
  for (let i = 0; i < 10; i++) {
    const hasMore = await page.evaluate((route) => {
      const li = document.querySelector(
        `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
      )

      return !!li?.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-panel [data-tree-more]",
      )
    }, folderRoute)

    if (!hasMore) break
    const before = (await directTreeChildren(page, folderRoute))?.length || 0

    await page.evaluate((route) => {
      const li = document.querySelector(
        `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
      )

      li?.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-panel [data-tree-more]",
      )?.click()
    }, folderRoute)
    await page.waitForFunction(
      ([route, prev]) => {
        const li = document.querySelector(
          `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
        )

        if (!li) return true

        const panel = li.querySelector(":scope > .reader-tree-collapsible > .reader-tree-panel")

        if (!panel) return true

        const rows = Array.from(
          panel.querySelectorAll(":scope > ul > li, :scope > div > ul > li"),
        ).filter((child) => {
          const row = child.querySelector(
            ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
          )

          return !!row?.querySelector("a")
        })

        const more = panel.querySelector("[data-tree-more]")

        return rows.length > prev || !more
      },
      [folderRoute, before],
      { timeout: 5000 },
    )
  }
}

/** Open each ancestor disclosure and page through it so the target appears. */
async function revealTreeRoute(page, targetRoute) {
  const segments = targetRoute.split("/").filter(Boolean)
  const prefixes = segments.map((_, i) => `/${segments.slice(0, i + 1).join("/")}`)

  for (const prefix of prefixes.slice(0, -1)) {
    const state = await disclosureState(page, prefix)

    if (state === "false") await setDisclosure(page, prefix, true)
    await expandAllTreeRows(page, prefix)
  }
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
  // Long folders page behind the more-row: expand to exhaustion, then the
  // full ordered children match the tree.
  await expandAllTreeRows(page, folderRoute)
  const children = await directTreeChildren(page, folderRoute)
  assert.ok(children, "tree renders the folder branch")
  assert.deepEqual(
    children.map((c) => c.text),
    folderChildren,
    "folder children follow tree ordering",
  )
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
  // Ancestor folders still page: reach the leaf through explicit paging.
  await page.goto(`${baseUrl}${leafRoute}`, { waitUntil: "networkidle", timeout: 15000 })
  await revealTreeRoute(page, leafRoute)
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
  await revealTreeRoute(page, leafRoute)
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
 * Desktop sidebar pagination on a long folder: first 4 plus the more-row,
 * batch reveal of min(20, remaining), exhaustion removes the row, paging
 * never navigates, and the active ancestor still pages (C8).
 */
async function runTreePagination(page, baseUrl, expect) {
  const { paginationRoute, paginationTitle, paginationChildren, deepRoute } = expect
  assert.ok(
    paginationChildren.length > 4,
    `canonical fixture has a long folder (got ${paginationChildren.length})`,
  )
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 15000 })

  const publishedLabel = await page.evaluate(() => {
    const nav = document.querySelector('[data-slot="sidebar"] .reader-sidebar-nav')

    if (!nav) return null

    const label = Array.from(nav.querySelectorAll('[data-slot="sidebar-group-label"]')).find(
      (el) => (el.textContent?.trim() || "") === "Published",
    )

    return label ? label.className || "" : null
  })

  assert.ok(publishedLabel, "Published section label renders above the tree")

  const state = await disclosureState(page, paginationRoute)

  if (state === "false") await setDisclosure(page, paginationRoute, true)

  const initial = await directTreeChildren(page, paginationRoute)
  assert.equal(initial.length, 4, "expanded folder renders its first 4 children")
  assert.deepEqual(
    initial.map((c) => c.text),
    paginationChildren.slice(0, 4),
    "window keeps tree order",
  )

  const hiddenBefore = paginationChildren.length - 4
  const moreBefore = await treeMoreRow(page, paginationRoute)
  assert.ok(moreBefore, "trailing more-row renders when children remain")
  assert.ok(
    moreBefore.includes(`+ ${hiddenBefore} more in ${paginationTitle}`),
    `more-row counts hidden children (got ${moreBefore})`,
  )

  const moreClasses = await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    return (
      li?.querySelector(":scope > .reader-tree-collapsible > .reader-tree-panel [data-tree-more]")
        ?.className || ""
    )
  }, paginationRoute)

  for (const token of ["font-mono", "text-2xs", "text-muted-foreground", "px-1.5", "py-1"]) {
    assert.ok(moreClasses.includes(token), `more-row carries ${token}`)
  }

  const urlBefore = page.url()

  const sessionBefore = await page.evaluate(() =>
    window.sessionStorage.getItem("knowledge-reader-tree"),
  )

  await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    li?.querySelector(
      ":scope > .reader-tree-collapsible > .reader-tree-panel [data-tree-more]",
    )?.click()
  }, paginationRoute)

  const batch = Math.min(20, hiddenBefore)

  await page.waitForFunction(
    ([route, total]) => {
      const li = document.querySelector(
        `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
      )

      const panel = li?.querySelector(":scope > .reader-tree-collapsible > .reader-tree-panel")

      if (!panel) return false

      const rows = Array.from(
        panel.querySelectorAll(":scope > ul > li, :scope > div > ul > li"),
      ).filter((child) => {
        const row = child.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
        )

        return !!row?.querySelector("a")
      })

      return rows.length === total
    },
    [paginationRoute, 4 + batch],
    { timeout: 5000 },
  )

  const after = await directTreeChildren(page, paginationRoute)
  assert.equal(after.length, 4 + batch, "click reveals the next batch")
  assert.deepEqual(
    after.map((c) => c.text),
    paginationChildren.slice(0, 4 + batch),
    "revealed rows keep tree order and links",
  )

  const moreAfter = await treeMoreRow(page, paginationRoute)

  if (4 + batch < paginationChildren.length) {
    assert.ok(
      moreAfter?.includes(
        `+ ${paginationChildren.length - (4 + batch)} more in ${paginationTitle}`,
      ),
      "count label updates with remaining hidden",
    )
  } else {
    assert.equal(moreAfter, null, "row disappears once all children are visible")
  }

  await expandAllTreeRows(page, paginationRoute)
  const full = await directTreeChildren(page, paginationRoute)
  assert.deepEqual(
    full.map((c) => c.text),
    paginationChildren,
    "full children match after exhaustion",
  )
  assert.equal(await treeMoreRow(page, paginationRoute), null, "row is gone after exhaustion")
  assert.equal(page.url(), urlBefore, "paging reveals without navigating")

  const sessionAfter = await page.evaluate(() =>
    window.sessionStorage.getItem("knowledge-reader-tree"),
  )

  assert.equal(sessionAfter, sessionBefore, "paging keeps client session storage")

  // Keyboard: the more-row is reachable before exhaustion. Reopen a fresh
  // window by collapsing and re-expanding so the control returns.
  await setDisclosure(page, paginationRoute, false)
  await setDisclosure(page, paginationRoute, true)
  assert.ok(await treeMoreRow(page, paginationRoute), "more-row returns after reset")

  const keyboardReachable = await page.evaluate((route) => {
    const li = document.querySelector(
      `[data-slot="sidebar"] .reader-sidebar-nav li[data-tree-url="${route}"]`,
    )

    const more = li?.querySelector(
      ":scope > .reader-tree-collapsible > .reader-tree-panel [data-tree-more]",
    )

    if (!more) return { focusable: false, outline: null }
    more.focus()

    const active = document.activeElement === more

    const style = active ? getComputedStyle(more) : null

    return {
      focusable: active,
      outline: style ? { style: style.outlineStyle, width: style.outlineWidth } : null,
    }
  }, paginationRoute)

  assert.ok(keyboardReachable.focusable, "keyboard reaches the more-row")

  // Active-route ancestor still pages: the deep leaf needs explicit paging.
  await page.goto(`${baseUrl}${deepRoute}`, { waitUntil: "networkidle", timeout: 15000 })
  const ancestorMore = await treeMoreRow(page, "/notes")
  assert.ok(ancestorMore, "active ancestor still pages")
  await revealTreeRoute(page, deepRoute)
  assert.ok(await treeLinkVisible(page, deepRoute), "deep leaf reachable through paging")
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
  assert.ok(controls.header.visible, "desktop header shows the Search icon trigger")

  const headerMeta = await page.evaluate(() => {
    const el = document.querySelector(".reader-search-header")

    return {
      label: el?.getAttribute("aria-label") || "",
      text: el?.textContent?.trim() || "",
      hasIcon: !!el?.querySelector("svg"),
    }
  })

  assert.equal(headerMeta.label, "Search", "header Search keeps its accessible name")
  assert.equal(headerMeta.text, "", "header Search is icon-only")
  assert.ok(headerMeta.hasIcon, "header Search shows its icon")

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

  // Desktop header icon opens the same shared dialog.
  await page.evaluate(() => document.querySelector(".reader-search-header")?.click())
  await dialogOpen(page)
  await page.keyboard.press("Escape")
  await dialogClosed(page)
  const headerReturned = await page.evaluate(() => document.activeElement?.className || "")

  assert.ok(
    String(headerReturned).includes("reader-search-header"),
    "Escape returns focus to the header control",
  )
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

    assert.ok(treeHasLeaf, "sidebar tree works offline")

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
  assert.ok(cue.text.length > 0, "cue renders its label instead of disappearing")
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

/**
 * Shared article meta line (design HMIv8) in static HTML, scoped to the
 * article so shell 11px utilities (offline cue, more-row) never match.
 * Returns the first segment text, dot presence, and machine/visible date.
 */
function metaLineFromHtml(html) {
  const articleStart = html.indexOf("<article")

  if (articleStart === -1) return null
  const article = html.slice(articleStart, html.indexOf("</article>", articleStart))

  const divMatch = article.match(
    /<div[^>]*class="[^"]*text-2xs[^"]*text-muted-foreground[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  )

  if (!divMatch) return null
  const inner = divMatch[1]
  const first = inner.match(/<span>([^<]*)<\/span>/)?.[1].trim() ?? null
  const dot = /bg-border/.test(inner) && /rounded-full/.test(inner)
  const time = inner.match(/<time[^>]*date[Tt]ime="([^"]+)"[^>]*>([^<]*)<\/time>/)

  return {
    div: divMatch[0],
    first,
    dot,
    datetime: time ? time[1] : null,
    updated: time ? time[2].trim() : null,
  }
}

/** Article-scoped count of meta-line first segments (`min read`). */
function metaLineCount(html) {
  const articleStart = html.indexOf("<article")

  if (articleStart === -1) return 0
  const article = html.slice(articleStart, html.indexOf("</article>", articleStart))

  return article.split("min read").length - 1
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
 * meta-line, and note suites. Runs on the finished export before it is
 * served: page-set equality, home cards, rich syntax, canonical metadata,
 * install manifest, output safety, runtime inspection, search coverage,
 * breadcrumb trails, meta lines, and the offline precache.
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

  // Mobile port home-phone: a phone-only Home crumb plus a phone-only card
  // row (muted icon box, count-only meta, trailing chevron) render
  // alongside the unchanged desktop card structure.
  assert.match(
    home,
    /text-muted-foreground md:hidden">Home</,
    "phone-only Home crumb renders above the cards",
  )
  assert.equal(
    countOccurrences(section, "lucide-chevron-right"),
    links.length,
    "every home card carries a phone-only trailing chevron",
  )
  assert.match(section, />12 items</, "phone card meta is count-only for the flat folder")
  assert.match(section, />2 items</, "phone card meta is count-only for the authored folder")
  assert.ok(
    section.includes("size-9") && section.includes("bg-muted"),
    "phone card icons sit in a muted box",
  )

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
    // Publication URLs are browser-normalized (brackets percent-encoded), so
    // filesystem lookups decode them back to the emitted file names.
    const rel = decodeURIComponent(url.replace(/^\//, ""))
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
  // Mobile port note-phone: leaf notes carry a phone-only slash trail
  // (no second Breadcrumb landmark) plus the shared Other notes sibling
  // section with its count, initial six rows, and expander foot.
  const orchardNote = readOut(outDir, "orchard/note-01.html")

  assert.ok(orchardNote.includes("reader-note-crumbs"), "leaf note carries the phone trail hook")
  assert.ok(orchardNote.includes("md:hidden"), "phone trail stays hidden on desktop")
  assert.ok(orchardNote.includes(" / "), "phone trail is slash-separated")
  assert.ok(orchardNote.includes('href="/orchard"'), "phone trail links the parent")
  assert.equal(
    countOccurrences(orchardNote, 'aria-label="Breadcrumb"'),
    1,
    "phone trail adds no second breadcrumb landmark",
  )
  assert.ok(orchardNote.includes("Other notes in Orchard"), "leaf note heads its siblings")

  const orchardSection = orchardNote.slice(orchardNote.indexOf("Other notes in Orchard"))

  assert.match(orchardSection, />11</, "sibling count pill carries the total")
  assert.equal(
    countOccurrences(orchardSection.split("</section>")[0], "/orchard/note-"),
    6,
    "eleven siblings page to six rows before expanding",
  )
  assert.ok(orchardSection.includes("Show all 11 notes"), "expander foot offers the rest")

  const guideNote = readOut(outDir, "notes/guide.html")

  assert.ok(guideNote.includes("reader-note-crumbs"), "guide carries the phone trail")
  assert.ok(guideNote.includes("Other notes in Notes"), "guide heads its siblings")
  assert.ok(!guideNote.includes("Show all"), "six siblings need no expander foot")
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

  // Meta lines in static HTML (design HMIv8): one shared row above the
  // title with `{parent} • {N} min read`, a border-token dot, and a
  // relative `Updated …` date with machine time. Notes without a valid
  // timestamp keep the minutes segment but no date; root notes drop the
  // category; folders and home render no meta line at all.
  const offsetHtml = readOut(outDir, "notes/valid-offset.html")
  const offset = metaLineFromHtml(offsetHtml)
  assert.ok(offset, "valid offset note renders the meta line")
  assert.equal(offset.first, "Notes • 1 min read")
  assert.equal(offset.dot, true, "offset meta carries the dot separator")
  assert.equal(offset.datetime, "2026-09-20T12:30:00.000Z")
  assert.match(offset.updated ?? "", /^Updated .+ ago$/, "offset date is relative")
  assert.ok(offset.div.includes("text-2xs"), "offset meta is the 11px token")
  assert.equal(metaLineCount(offsetHtml), 1, "offset note renders exactly one meta line")
  assert.ok(
    offsetHtml.indexOf(offset.div) < offsetHtml.indexOf("<h1"),
    "offset meta sits above the title",
  )

  const zuluHtml = readOut(outDir, "notes/valid-z.html")
  const zulu = metaLineFromHtml(zuluHtml)
  assert.ok(zulu, "valid Zulu note renders the meta line")
  assert.equal(zulu.first, "Notes • 1 min read")
  assert.equal(zulu.dot, true, "zulu meta carries the dot separator")
  assert.equal(zulu.datetime, "2026-08-27T05:49:53.387Z")
  assert.match(zulu.updated ?? "", /^Updated .+ ago$/, "zulu date is relative")
  assert.equal(metaLineCount(zuluHtml), 1, "zulu note renders exactly one meta line")
  assert.ok(zuluHtml.indexOf(zulu.div) < zuluHtml.indexOf("<h1"), "zulu meta sits above the title")

  // Invalid or missing timestamps keep minutes but never a date segment.
  for (const rel of ["notes/plain.html", "notes/date-only.html", "notes/feb-thirty.html"]) {
    const html = readOut(outDir, rel)
    const meta = metaLineFromHtml(html)
    assert.ok(meta, `${rel} keeps the minutes segment`)
    assert.equal(meta.first, "Notes • 1 min read", `${rel} names its parent`)
    assert.equal(meta.dot, false, `${rel} renders no date dot`)
    assert.equal(meta.datetime, null, `${rel} renders no machine time`)
    assert.equal(meta.updated, null, `${rel} renders no Updated date`)
    assert.equal(metaLineCount(html), 1, `${rel} renders exactly one meta line`)
    assert.ok(!html.includes("Last edited"), `${rel} shows no retired label`)
  }

  // Root notes drop the category segment and its dot.
  const standaloneHtml = readOut(outDir, "standalone.html")
  const standaloneMeta = metaLineFromHtml(standaloneHtml)
  assert.ok(standaloneMeta, "root note renders the meta line")
  assert.equal(standaloneMeta.first, "1 min read", "root note drops the category")
  assert.equal(standaloneMeta.dot, false, "root note renders no category dot")
  assert.equal(metaLineCount(standaloneHtml), 1, "root note renders exactly one meta line")

  // Folder indexes and home render no meta line (design has no folder screen).
  for (const rel of ["garden.html", "index.html"]) {
    const html = readOut(outDir, rel)
    assert.equal(metaLineFromHtml(html), null, `${rel} renders no meta line`)
    assert.equal(metaLineCount(html), 0, `${rel} carries no minutes segment`)
    assert.ok(!html.includes("Last edited"), `${rel} shows no retired label`)
  }

  for (const rel of ["notes.html", "notes/nest.html", "notes/nest/inner.html"]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `virtual page emitted: ${rel}`)
    assert.equal(metaLineFromHtml(readOut(outDir, rel)), null, `${rel} omits a guessed label`)
  }

  // The retired responsive duplication is gone: no page carries two slots.
  for (const rel of ["notes/valid-offset.html", "orchard/note-01.html", "standalone.html"]) {
    assert.equal(metaLineCount(readOut(outDir, rel)), 1, `${rel} keeps a single meta slot`)
  }

  assertAbsentEverywhere(outDir, "Last edited", "retired Last edited label")

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

  // Mobile port home-phone: the phone-only Home crumb and phone-only card
  // row stay hidden on desktop, so the desktop meta keeps its kind prefix.
  const desktopCrumbDisplay = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll(".reader-article > span")).find(
      (node) => node.textContent?.trim() === "Home",
    )

    return el ? getComputedStyle(el).display : "missing"
  })

  assert.equal(desktopCrumbDisplay, "none", "phone-only Home crumb stays hidden on desktop")

  const desktopPhoneRowDisplays = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(".reader-area-list a span.hidden"),
      (el) => getComputedStyle(el).display,
    ),
  )

  assert.ok(desktopPhoneRowDisplays.length > 0, "desktop cards carry the phone chevron node")
  assert.ok(
    desktopPhoneRowDisplays.every((display) => display === "none"),
    "phone chevrons stay hidden on desktop",
  )

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
 * Meta line in the browser, folded from the retired last-edited suite
 * (its parseUpdatedAt unit test stays in place): valid authored notes
 * render one 11px row above the title with category, minutes, dot, and a
 * relative Updated date with machine time; dateless notes keep minutes
 * without a date; virtual folders render no meta line.
 */
async function runMetaLineBrowser(page, baseUrl) {
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.goto(`${baseUrl}/notes/valid-offset`, { waitUntil: "networkidle", timeout: 15000 })

  const rendered = await page.evaluate(() => {
    const article = document.querySelector("article.reader-article")

    const metas = Array.from(article?.querySelectorAll("div.text-2xs") ?? []).filter((el) =>
      (el.textContent ?? "").includes("min read"),
    )

    const line = metas[0] ?? null
    const time = line?.querySelector("time")
    const dot = line?.querySelector("span[aria-hidden='true']")
    const h1 = article?.querySelector("h1")
    const lineStyle = line ? getComputedStyle(line) : null
    const dotRect = dot?.getBoundingClientRect()

    return {
      count: metas.length,
      text: line?.textContent?.trim() || null,
      datetime: time?.getAttribute("datetime") || null,
      updated: time?.textContent?.trim() || null,
      size: lineStyle?.fontSize || "",
      dotWidth: dotRect?.width || 0,
      dotHeight: dotRect?.height || 0,
      dotClass: dot?.className || "",
      metaTop: line?.getBoundingClientRect().top || 0,
      h1Top: h1?.getBoundingClientRect().top || 0,
    }
  })

  assert.equal(rendered.count, 1, "browser renders exactly one meta line")
  assert.match(rendered.text ?? "", /Notes • 1 min read/, "browser shows category plus minutes")
  assert.match(rendered.updated ?? "", /^Updated .+ ago$/, "browser shows the relative date")
  assert.equal(rendered.datetime, "2026-09-20T12:30:00.000Z")
  assert.equal(rendered.size, "11px", "browser meta line is 11px")
  assert.ok(Math.abs(rendered.dotWidth - 3) <= 1, `dot is 3px wide (got ${rendered.dotWidth})`)
  assert.ok(Math.abs(rendered.dotHeight - 3) <= 1, `dot is 3px tall (got ${rendered.dotHeight})`)
  assert.ok(rendered.dotClass.includes("bg-border"), "dot uses the border token")
  assert.ok(rendered.metaTop <= rendered.h1Top, "desktop meta sits above the title")

  await page.goto(`${baseUrl}/notes/plain`, { waitUntil: "networkidle", timeout: 15000 })

  const plain = await page.evaluate(() => {
    const article = document.querySelector("article.reader-article")

    const metas = Array.from(article?.querySelectorAll("div.text-2xs") ?? []).filter((el) =>
      (el.textContent ?? "").includes("min read"),
    )

    return {
      count: metas.length,
      text: metas[0]?.textContent?.trim() || null,
      time: !!metas[0]?.querySelector("time"),
    }
  })

  assert.equal(plain.count, 1, "dateless note keeps one meta line")
  assert.match(plain.text ?? "", /Notes • 1 min read/, "dateless meta keeps minutes")
  assert.equal(plain.time, false, "dateless meta renders no Updated date")

  await page.goto(`${baseUrl}/notes`, { waitUntil: "networkidle", timeout: 15000 })
  assert.equal(
    await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("article.reader-article div.text-2xs") ?? []).filter(
          (el) => (el.textContent ?? "").includes("min read"),
        ).length,
    ),
    0,
    "browser omits a guessed virtual-folder meta line",
  )

  assert.deepEqual(errors, [], "no hydration or page errors on meta routes")
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
    const otherNotes = article?.querySelector('section[aria-label^="Other notes"]')

    const metas = Array.from(article?.querySelectorAll("div.text-2xs") ?? []).filter((el) =>
      (el.textContent ?? "").includes("min read"),
    )

    const meta = metas[0] ?? null
    const metaStyle = meta ? getComputedStyle(meta) : null

    return {
      title: document.title,
      mainCount: document.querySelectorAll("main").length,
      articleExists: !!article,
      h1Texts: h1s.map((h) => h.textContent?.trim() || ""),
      bodyLength: (article?.textContent || "").trim().length,
      tableCount: article ? article.querySelectorAll("table").length : 0,
      hasExternalLink: !!article?.querySelector('a[href^="https://"]'),
      canonicalHref: canonical?.getAttribute("href") || null,
      metaCount: metas.length,
      metaText: meta?.textContent?.trim() || null,
      metaSize: metaStyle?.fontSize || "",
      metaTop: meta?.getBoundingClientRect().top || 0,
      h1Top: article?.querySelector("h1")?.getBoundingClientRect().top || 0,
      otherNotesLabel: otherNotes?.getAttribute("aria-label") || null,
      otherNotesRows: Array.from(otherNotes?.querySelectorAll(":scope ul a") ?? []).map(
        (a) => a.getAttribute("href") || "",
      ),
      otherNotesFoot: !!otherNotes?.querySelector("button"),
      otherNotesRowHeight:
        otherNotes?.querySelector(":scope ul a")?.getBoundingClientRect().height || 0,
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
  // Shared meta line on desktop too: one 11px row above the title with
  // the parent category plus minutes (the guide carries no timestamp, so
  // no Updated date), and nothing below the body.
  assert.equal(note.metaCount, 1, "desktop renders exactly one meta line")
  assert.match(
    note.metaText ?? "",
    /Notes • \d+ min read/,
    "desktop meta names parent plus minutes",
  )
  assert.equal(note.metaSize, "11px", "desktop meta line is 11px")
  assert.ok(note.metaTop <= note.h1Top, "desktop meta sits above the title")
  // Mobile port note-phone: the shared Other notes sibling section
  // renders on desktop too. The guide keeps six siblings, so all rows
  // show at the 36px design read with no expander foot.
  assert.equal(note.otherNotesLabel, "Other notes in Notes", "desktop sibling section head")
  assert.equal(note.otherNotesRows.length, 6, "six siblings render without paging")
  assert.ok(
    note.otherNotesRows.every((href) => href.startsWith("/notes/")),
    "sibling rows link published note routes",
  )
  assert.equal(note.otherNotesFoot, false, "six siblings need no expander foot")
  assert.ok(
    Math.abs(note.otherNotesRowHeight - 36) <= 2,
    `desktop sibling rows are 36px-ish (got ${note.otherNotesRowHeight}px)`,
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

/**
 * Derive a folder journey from staged content: prefer a directory root with
 * both direct notes and nested subfolders. Returns areas in metadata order
 * plus the chosen folder and its deepest eligible leaf. The leaf prefers
 * staged Markdown with exactly one top-level H1 so the one-primary-heading
 * landmark check stays meaningful; when no single-H1 leaf exists the deepest
 * leaf is kept so the check still fails instead of weakening.
 */
function derivePhoneJourney(contentDir, metadata) {
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

  if (!folderEntry) folderEntry = dirRoots[0] ?? metadata.navigation[0]
  const folderTitle = expectedRootTitle(folderEntry, contentDir)
  const folderRoute = rootRoute(folderEntry)
  const candidates = []

  const walkFiles = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${e.name}` : e.name

      if (e.isDirectory()) walkFiles(path.join(dir, e.name), relPath)
      else if (e.isFile() && /\.md$/i.test(e.name) && !/^index\.md$/i.test(e.name)) {
        const prefix = folderEntry.kind === "directory" ? folderEntry.path : null

        if (prefix && !(relPath === prefix || relPath.startsWith(`${prefix}/`))) continue
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

async function goto(page, url) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 15000 })
}

async function isVisible(page, selector) {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel)

    if (!el) return false
    const style = getComputedStyle(el)

    if (style.display === "none" || style.visibility === "hidden") return false
    const rect = el.getBoundingClientRect()

    return rect.width > 0 && rect.height > 0
  }, selector)
}

async function visibleHeights(page, selector) {
  return await page.evaluate((sel) => {
    return Array.from(document.querySelectorAll(sel))
      .filter((el) => el.getBoundingClientRect().height > 0)
      .map((el) => el.getBoundingClientRect().height)
  }, selector)
}

async function assertTouchTargets(page, label) {
  for (const selector of [
    ".reader-search-trigger",
    ".reader-search-result",
    ".reader-home",
    ".reader-area-list a",
    ".reader-group-list a",
    ".reader-breadcrumbs a",
    ".reader-sidebar-nav a",
    ".reader-tree-toggle",
  ]) {
    for (const height of await visibleHeights(page, selector)) {
      assert.ok(height >= 44, `${label}: ${selector} touch target is ${height}px (expected >= 44)`)
    }
  }
}

async function assertNoPageOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    inner: window.innerWidth,
  }))

  assert.ok(
    overflow.doc <= overflow.inner + 1,
    `${label}: document width ${overflow.doc} exceeds viewport ${overflow.inner}`,
  )
  assert.ok(
    overflow.body <= overflow.inner + 1,
    `${label}: body width ${overflow.body} exceeds viewport ${overflow.inner}`,
  )
}

async function assertLandmarks(page, label, { breadcrumb = true, areasNav = true } = {}) {
  const landmarks = await page.evaluate(() => ({
    mainCount: document.querySelectorAll("main").length,
    h1s: Array.from(document.querySelectorAll("article h1")).map((h) => h.textContent?.trim()),
    areasNav: !!document.querySelector('nav[aria-label="Published sections"]'),
    breadcrumbNav: !!document.querySelector('nav[aria-label="Breadcrumb"]'),
  }))

  assert.equal(landmarks.mainCount, 1, `${label}: one main landmark`)
  assert.equal(landmarks.h1s.length, 1, `${label}: one primary heading`)

  // The Published sections tree lives in the registry sidebar: always
  // mounted on desktop, but on phones only while the mobile sheet is open.
  if (areasNav) assert.ok(landmarks.areasNav, `${label}: Published sections navigation landmark`)

  if (breadcrumb) assert.ok(landmarks.breadcrumbNav, `${label}: breadcrumb navigation landmark`)
}

/** Top-level tree roots in rendered order (published root order). */
async function browseRoots(page) {
  return await page.evaluate(() => {
    const scope =
      document.querySelector('[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav') ||
      document.querySelector(".reader-sidebar-nav")

    if (!scope) return []

    return Array.from(scope.querySelectorAll(":scope > ul > li")).map((li) => {
      const row = li.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
      )

      const a = row ? row.querySelector("a") : null

      return {
        text: a?.textContent?.trim() || "",
        href: a?.getAttribute("href") || "",
      }
    })
  })
}

async function treeDisclosure(page, route) {
  return await page.evaluate((target) => {
    const scope =
      document.querySelector('[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav') ||
      document

    const li = scope.querySelector(`li[data-tree-url="${target}"]`)

    const button = li
      ? li.querySelector(
          ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
        )
      : null

    return button ? button.getAttribute("aria-expanded") : null
  }, route)
}

async function ensureTreeOpen(page, route) {
  const state = await treeDisclosure(page, route)

  if (state !== "true") {
    assert.equal(state, "false", `tree branch ${route} has a disclosure control`)
    await page.evaluate((target) => {
      const scope =
        document.querySelector(
          '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav',
        ) || document

      const li = scope.querySelector(`li[data-tree-url="${target}"]`)
      li?.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
      )?.click()
    }, route)
    await page.waitForFunction(
      (target) => {
        const scope =
          document.querySelector(
            '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav',
          ) || document

        const li = scope.querySelector(`li[data-tree-url="${target}"]`)

        const button = li
          ? li.querySelector(
              ":scope > .reader-tree-collapsible > .reader-tree-row > .reader-tree-toggle",
            )
          : null

        return button && button.getAttribute("aria-expanded") === "true"
      },
      route,
      { timeout: 5000 },
    )
  }

  await expandAllPhoneRows(page, route)
}

/** Click the phone drawer more-row until exhausted. */
async function expandAllPhoneRows(page, route) {
  for (let i = 0; i < 10; i++) {
    const hasMore = await page.evaluate((target) => {
      const scope =
        document.querySelector(
          '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav',
        ) || document

      const li = scope.querySelector(`li[data-tree-url="${target}"]`)

      return !!li?.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-panel [data-tree-more]",
      )
    }, route)

    if (!hasMore) break

    const before = await page.evaluate((target) => {
      const scope =
        document.querySelector(
          '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav',
        ) || document

      const li = scope.querySelector(`li[data-tree-url="${target}"]`)

      const panel = li?.querySelector(":scope > .reader-tree-collapsible > .reader-tree-panel")

      if (!panel) return 0

      return Array.from(panel.querySelectorAll(":scope > ul > li, :scope > div > ul > li")).filter(
        (child) => {
          const row = child.querySelector(
            ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
          )

          return !!row?.querySelector("a")
        },
      ).length
    }, route)

    await page.evaluate((target) => {
      const scope =
        document.querySelector(
          '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav',
        ) || document

      const li = scope.querySelector(`li[data-tree-url="${target}"]`)

      li?.querySelector(
        ":scope > .reader-tree-collapsible > .reader-tree-panel [data-tree-more]",
      )?.click()
    }, route)
    await page.waitForFunction(
      ([target, prev]) => {
        const scope =
          document.querySelector(
            '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav',
          ) || document

        const li = scope.querySelector(`li[data-tree-url="${target}"]`)

        if (!li) return true

        const panel = li.querySelector(":scope > .reader-tree-collapsible > .reader-tree-panel")

        if (!panel) return true

        const rows = Array.from(
          panel.querySelectorAll(":scope > ul > li, :scope > div > ul > li"),
        ).filter((child) => {
          const row = child.querySelector(
            ":scope > .reader-tree-collapsible > .reader-tree-row, :scope > .reader-tree-row",
          )

          return !!row?.querySelector("a")
        })

        const more = panel.querySelector("[data-tree-more]")

        return rows.length > prev || !more
      },
      [route, before],
      { timeout: 5000 },
    )
  }
}

/** Open each phone ancestor and page through it so the target appears. */
async function revealPhoneRoute(page, targetRoute) {
  const segments = targetRoute.split("/").filter(Boolean)
  const prefixes = segments.map((_, i) => `/${segments.slice(0, i + 1).join("/")}`)

  for (const prefix of prefixes.slice(0, -1)) {
    const state = await treeDisclosure(page, prefix)

    if (state === "false") await ensureTreeOpen(page, prefix)
    else if (state === "true") await expandAllPhoneRows(page, prefix)
  }
}

async function openDrawer(page) {
  await page.evaluate(() => {
    // Focus-then-activate mirrors keyboard and assistive-tech use: the
    // registry sheet restores focus to whatever held it before opening.
    const trigger = document.querySelector('[data-sidebar="trigger"]')

    if (trigger instanceof HTMLElement) trigger.focus()
    trigger?.click()
  })
  await page.waitForFunction(
    () => !!document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]'),
    null,
    { timeout: 5000 },
  )
  await page.waitForSelector('[data-sidebar="sidebar"][data-mobile="true"]', {
    state: "visible",
    timeout: 5000,
  })
}

// The registry mobile sheet has no visible Close: Escape dismisses it
// and Radix returns focus to the trigger.
async function closeDrawer(page) {
  await page.keyboard.press("Escape")
  await page.waitForFunction(
    () => !document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]'),
    null,
    { timeout: 5000 },
  )
}

/** Phone drawer is the registry mobile sidebar sheet: the real AppSidebar slides in from the left over a dimmed overlay. */
async function assertPhoneDrawerViewport(page, label) {
  const drawer = await page.evaluate(() => {
    const el = document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]')

    if (!el) return null
    const rect = el.getBoundingClientRect()
    const content = el.querySelector('[data-sidebar="content"]')
    const contentStyle = content ? getComputedStyle(content) : null
    const overlay = document.querySelector('[data-slot="sheet-overlay"]')
    const overlayRect = overlay ? overlay.getBoundingClientRect() : null
    const close = el.querySelector('[data-slot="sheet-close"]')
    const closeRect = close ? close.getBoundingClientRect() : null
    const home = el.querySelector(".reader-sidebar-home")
    const homeRect = home ? home.getBoundingClientRect() : null
    const search = el.querySelector(".reader-search-sidebar")
    const searchRect = search ? search.getBoundingClientRect() : null
    const switcher = el.querySelector(".reader-projection-trigger")
    const switcherRect = switcher ? switcher.getBoundingClientRect() : null

    return {
      left: rect.left,
      width: rect.width,
      height: rect.height,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      overlayCovers:
        !!overlay &&
        !!overlayRect &&
        overlayRect.width >= window.innerWidth - 1 &&
        overlayRect.height >= window.innerHeight - 1,
      contentOverflowY: contentStyle ? contentStyle.overflowY : "",
      closeVisible: !!closeRect && closeRect.width > 0 && closeRect.height > 0,
      homeVisible: !!homeRect && homeRect.width > 0 && homeRect.height > 0,
      drawerSearchText: search?.textContent?.trim() || "",
      drawerSearchHeight: searchRect ? searchRect.height : 0,
      switcherVisible: !!switcherRect && switcherRect.width > 0 && switcherRect.height > 0,
      dialogRole: el.getAttribute("role") || "",
    }
  })

  assert.ok(drawer, `${label}: phone drawer is in the document`)
  assert.ok(drawer.left <= 1, `${label}: drawer slides in from the left (left ${drawer.left}px)`)
  assert.ok(
    drawer.width >= 200 && drawer.width <= drawer.innerWidth - 16,
    `${label}: drawer is a nav panel over a dimmed body (${drawer.width}px vs ${drawer.innerWidth}px)`,
  )
  assert.ok(
    drawer.height >= drawer.innerHeight - 2,
    `${label}: drawer fills viewport height (${drawer.height}px vs ${drawer.innerHeight}px)`,
  )
  assert.ok(drawer.overlayCovers, `${label}: overlay dims the body behind the drawer`)
  assert.ok(
    drawer.contentOverflowY === "auto" || drawer.contentOverflowY === "scroll",
    `${label}: tree scrolls independently (overflow-y ${drawer.contentOverflowY})`,
  )
  assert.equal(drawer.closeVisible, false, `${label}: drawer has no visible Close`)
  assert.ok(drawer.homeVisible, `${label}: drawer Home stays reachable`)
  assert.ok(drawer.drawerSearchText.includes("Search"), `${label}: drawer Search stays reachable`)
  assert.ok(
    drawer.drawerSearchHeight >= 44,
    `${label}: drawer Search is ${drawer.drawerSearchHeight}px (expected >= 44)`,
  )
  assert.ok(drawer.switcherVisible, `${label}: drawer switcher stays reachable`)
  assert.ok(
    drawer.dialogRole === "dialog" || drawer.dialogRole === "alertdialog",
    `${label}: drawer is a dialog (role ${drawer.dialogRole})`,
  )
}

/** Background stays locked while the drawer is open and releases on close. */
async function assertBackgroundScrollLock(page, label) {
  const locked = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflow,
    bodyStyle: document.body.style.overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
  }))

  assert.ok(
    locked.bodyOverflow === "hidden" ||
      locked.bodyStyle === "hidden" ||
      locked.htmlOverflow === "hidden" ||
      document.body.hasAttribute("data-scroll-locked"),
    `${label}: background scroll locks while the drawer is open (body ${locked.bodyOverflow}/${locked.bodyStyle})`,
  )
}

/**
 * Phone header composition (mobile port items 2+4): 64px header with
 * hamburger plus a truncated brand button on the left (opens the vault
 * bottom sheet) and the status cue plus search on the right. The desktop
 * separator and breadcrumb trail stay mounted for desktop parity but
 * hidden on phones.
 */
async function runPhoneHeaderComposition(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)

  const header = await page.evaluate(() => {
    const el = document.querySelector(".reader-header")

    if (!el) return null
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const brandSpan = document.querySelector(".reader-header-trail span.truncate")
    const brandRect = brandSpan?.getBoundingClientRect() || null
    const brandControl = brandSpan?.closest("button") || brandSpan?.closest("div") || null
    const icon = brandControl?.querySelector("svg") || null
    const iconRect = icon?.getBoundingClientRect() || null
    const crumbs = document.querySelector(".reader-header-trail .reader-breadcrumbs")
    const crumbsStyle = crumbs ? getComputedStyle(crumbs) : null
    const crumbsRect = crumbs?.getBoundingClientRect() || null
    const separator = document.querySelector('.reader-header-trail [data-slot="separator"]')
    const separatorStyle = separator ? getComputedStyle(separator) : null
    const separatorRect = separator?.getBoundingClientRect() || null
    const cue = document.querySelector(".reader-offline-cue")
    const cueRect = cue?.getBoundingClientRect() || null
    const cueStyle = cue ? getComputedStyle(cue) : null
    const search = document.querySelector(".reader-search-header")
    const searchRect = search?.getBoundingClientRect() || null
    const trigger = document.querySelector('[data-sidebar="trigger"]')
    const triggerRect = trigger?.getBoundingClientRect() || null

    return {
      height: rect.height,
      borderWidth: style.borderBottomWidth,
      borderStyle: style.borderBottomStyle,
      brandText: brandSpan?.textContent?.trim() || "",
      brandVisible:
        !!brandSpan &&
        !!brandRect &&
        brandRect.width > 0 &&
        brandRect.height > 0 &&
        getComputedStyle(brandSpan).display !== "none",
      brandTag: brandControl?.tagName || "",
      brandIsButton: (brandControl?.tagName || "") === "BUTTON",
      brandType: brandControl?.getAttribute("type") || "",
      brandHaspopup: brandControl?.getAttribute("aria-haspopup") || "",
      brandExpanded: brandControl?.getAttribute("aria-expanded") || "",
      brandWeight: brandSpan ? getComputedStyle(brandSpan).fontWeight : "",
      iconVisible: !!iconRect && iconRect.width > 0 && iconRect.height > 0,
      iconWidth: iconRect ? iconRect.width : 0,
      crumbsVisible:
        !!crumbs &&
        !!crumbsRect &&
        crumbsStyle.display !== "none" &&
        crumbsRect.width > 0 &&
        crumbsRect.height > 0,
      separatorVisible:
        !!separator &&
        !!separatorRect &&
        separatorStyle.display !== "none" &&
        separatorRect.width > 0 &&
        separatorRect.height > 0,
      cueVisible:
        !!cue &&
        !!cueRect &&
        cueStyle.display !== "none" &&
        cueRect.width > 0 &&
        cueRect.height > 0,
      searchVisible: !!searchRect && searchRect.width > 0 && searchRect.height > 0,
      triggerVisible: !!triggerRect && triggerRect.width > 0 && triggerRect.height > 0,
    }
  })

  assert.ok(header, `${label}: phone header is present`)
  assert.ok(
    Math.abs(header.height - 64) <= 1,
    `${label}: phone header is 64px tall (got ${header.height}px)`,
  )
  assert.ok(header.triggerVisible, `${label}: hamburger stays visible`)
  assert.ok(header.brandVisible, `${label}: brand row is visible`)
  assert.ok(
    header.brandText.includes(expect.projection),
    `${label}: brand text is the site title (got ${header.brandText})`,
  )
  assert.equal(header.brandTag, "BUTTON", `${label}: brand row is a button`)
  assert.equal(header.brandIsButton, true, `${label}: brand row opens the vault sheet`)
  assert.equal(header.brandType, "button", `${label}: brand row is a plain button`)
  assert.equal(header.brandHaspopup, "dialog", `${label}: brand row announces the vault dialog`)
  assert.equal(header.brandExpanded, "false", `${label}: vault sheet starts closed`)
  assert.ok(
    Number(header.brandWeight) >= 700 || header.brandWeight === "bold",
    `${label}: brand text is bold (got ${header.brandWeight})`,
  )
  assert.ok(header.iconVisible, `${label}: brand swap icon is visible`)
  assert.ok(
    Math.abs(header.iconWidth - 14) <= 1,
    `${label}: brand swap icon is 14px (got ${header.iconWidth}px)`,
  )
  assert.equal(header.crumbsVisible, false, `${label}: breadcrumbs leave the phone header`)
  assert.equal(header.separatorVisible, false, `${label}: separator leaves the phone header`)
  assert.ok(header.cueVisible, `${label}: status cue stays right`)
  assert.ok(header.searchVisible, `${label}: search stays right`)
  assert.ok(
    header.borderWidth !== "0px" && header.borderStyle !== "none",
    `${label}: phone header keeps its bottom border`,
  )
}

/** Phone assertions: drawer hidden until the trigger opens it, then home -> folder -> note. */
async function runPhoneJourney(page, baseUrl, expect, label) {
  await runPhoneHeaderComposition(page, baseUrl, expect, `${label} header`)
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    false,
    `${label}: phone drawer stays hidden until the trigger opens it`,
  )
  assert.ok(
    await isVisible(page, '[data-sidebar="trigger"]'),
    `${label}: sidebar trigger is visible`,
  )
  await assertNoPageOverflow(page, `${label} home`)
  await assertLandmarks(page, `${label} home`, { areasNav: false })

  await openDrawer(page)
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    true,
    `${label}: trigger opens the drawer`,
  )
  await assertPhoneDrawerViewport(page, `${label} drawer`)
  await assertBackgroundScrollLock(page, `${label} drawer`)
  await assertLandmarks(page, `${label} drawer`)

  // Focus moves into the drawer while it is open.
  const focusInDrawer = await page.evaluate(() => {
    const panel = document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]')
    const active = document.activeElement

    return !!panel && !!active && panel.contains(active)
  })

  assert.ok(focusInDrawer, `${label}: focus stays in the drawer while open`)

  // Drawer Search opens the one shared dialog; dismissing it returns
  // focus into the still-open drawer without a second dialog.
  await page.evaluate(() => {
    document
      .querySelector('[data-sidebar="sidebar"][data-mobile="true"] .reader-search-trigger')
      ?.click()
  })
  await searchDialogOpen(page)
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('[data-slot="dialog-content"]').length),
    1,
    `${label}: drawer Search opens the shared dialog`,
  )
  await page.keyboard.press("Escape")
  await searchDialogClosed(page)

  const focusBackInDrawer = await page.evaluate(() => {
    const panel = document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]')
    const active = document.activeElement

    return !!panel && !!active && panel.contains(active)
  })

  assert.ok(focusBackInDrawer, `${label}: Search close returns focus into the drawer`)
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    true,
    `${label}: drawer stays open after Search closes`,
  )

  const sheetOpen = await page.evaluate(
    () => !!document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]'),
  )

  assert.equal(sheetOpen, true, `${label}: sheet reports its open state`)
  const roots = await browseRoots(page)
  assert.deepEqual(
    roots.map((a) => a.text),
    expect.areas,
    `${label}: drawer shows the same tree roots in published order`,
  )

  await closeDrawer(page)
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    false,
    `${label}: Escape dismisses the drawer`,
  )

  const focusReturned = await page.evaluate(
    () => document.activeElement?.getAttribute("data-sidebar") || "",
  )

  assert.ok(
    String(focusReturned).includes("trigger"),
    `${label}: dismissing returns focus to the trigger`,
  )

  const folderHref = (
    await page.evaluate(() =>
      Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => ({
        text: a.textContent?.trim() || "",
        href: a.getAttribute("href") || "",
      })),
    )
  ).find((l) => l.href === expect.folderRoute)?.href

  assert.ok(folderHref, `${label}: home links the folder from staged content`)
  await Promise.all([
    page.waitForURL((url) => url.href.includes(folderHref), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.evaluate((href) => {
      document.querySelector(`.reader-area-list a[href="${href}"]`)?.click()
    }, folderHref),
  ])
  assert.ok(page.url().includes(expect.folderRoute), `${label}: folder opens its route`)
  await assertNoPageOverflow(page, `${label} folder`)
  await assertTouchTargets(page, `${label} folder`)

  await openDrawer(page)
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    true,
    `${label}: trigger opens the tree`,
  )

  // Long folders page behind the more-row: reach the leaf through paging.
  await revealPhoneRoute(page, expect.leafRoute)

  // The phone tree carries the nested note with its static route.
  const leafInTree = await page.evaluate((route) => {
    const scope =
      document.querySelector('[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav') ||
      document

    const a = scope.querySelector(`a[href="${route}"]`)

    return a ? a.textContent?.trim() || "" : null
  }, expect.leafRoute)

  assert.equal(leafInTree, expect.leafTitle, `${label}: drawer tree reaches the nested note`)

  // Deep branches and long titles stay readable while browsing.
  const panelReadable = await page.evaluate(() => {
    const scope =
      document.querySelector('[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav') ||
      document

    const links = Array.from(scope.querySelectorAll("a"))

    const toggles = Array.from(
      (
        document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]') || document
      ).querySelectorAll(".reader-tree-toggle"),
    )

    return {
      widest: Math.max(0, ...links.map((a) => a.getBoundingClientRect().right)),
      inner: window.innerWidth,
      toggleHeights: toggles
        .filter((b) => b.getBoundingClientRect().height > 0)
        .map((b) => b.getBoundingClientRect().height),
    }
  })

  assert.ok(
    panelReadable.widest <= panelReadable.inner + 1,
    `${label}: tree links stay inside the phone viewport`,
  )

  for (const height of panelReadable.toggleHeights) {
    assert.ok(height >= 44, `${label}: tree disclosure is ${height}px (expected >= 44)`)
  }

  // Open the nested branches, then select the note: the drawer closes and
  // reading starts on the note route.
  const segments = expect.leafRoute.split("/").filter(Boolean)

  for (let i = 1; i < segments.length; i++) {
    await ensureTreeOpen(page, `/${segments.slice(0, i).join("/")}`)
  }

  await Promise.all([
    page.waitForURL((url) => url.href.includes(expect.leafRoute), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.evaluate((route) => {
      const scope =
        document.querySelector(
          '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-nav',
        ) || document

      scope.querySelector(`a[href="${route}"]`)?.click()
    }, expect.leafRoute),
  ])
  assert.ok(
    page.url().includes(expect.leafRoute),
    `${label}: nested note route ${expect.leafRoute}`,
  )
  await page.waitForFunction(
    () => !document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]'),
    null,
    { timeout: 5000 },
  )
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    false,
    `${label}: selecting a tree page closes the drawer`,
  )

  const drawerUrlState = await page.evaluate(() => ({
    hash: window.location.hash,
    search: window.location.search,
  }))

  assert.equal(drawerUrlState.hash, "", `${label}: drawer adds no URL hash state`)
  assert.ok(!drawerUrlState.search.includes("browse"), `${label}: drawer adds no URL query state`)

  const note = await page.evaluate(() => {
    const crumbs = document.querySelector(".reader-header-trail .reader-breadcrumbs")
    const crumbsRect = crumbs?.getBoundingClientRect() || null
    const brandSpan = document.querySelector(".reader-header-trail span.truncate")

    return {
      h1: document.querySelector("article h1")?.textContent?.trim() || "",
      crumbsVisible:
        !!crumbs &&
        !!crumbsRect &&
        getComputedStyle(crumbs).display !== "none" &&
        crumbsRect.width > 0 &&
        crumbsRect.height > 0,
      brandText: brandSpan?.textContent?.trim() || "",
      h1Rect: document.querySelector("article h1")?.getBoundingClientRect().toJSON() || null,
      media: { viewport: window.innerWidth },
    }
  })

  assert.equal(note.h1, expect.leafTitle, `${label}: nested note title`)
  // Phone header item 2: the breadcrumb trail leaves the phone header
  // (it returns inside the body in item 6); the brand row stays instead.
  assert.equal(note.crumbsVisible, false, `${label}: phone header hides breadcrumbs on the note`)
  assert.ok(
    note.brandText.includes(expect.projection),
    `${label}: phone header keeps the site title on the note`,
  )
  assert.ok(
    note.h1Rect && note.h1Rect.width <= note.media.viewport + 1,
    `${label}: long title stays inside the viewport`,
  )
  await assertNoPageOverflow(page, `${label} note`)
  await assertTouchTargets(page, `${label} note`)
  await assertLandmarks(page, `${label} note`, { areasNav: false })

  // Timing-only stabilization: history traversals between static pages
  // can resolve while already idle, so each Back awaits its observable
  // route before the next traversal. No crumb click on phones: the header
  // trail is hidden, so Back alone walks the note -> folder -> home stack.
  await page.goBack({ waitUntil: "networkidle", timeout: 15000 })
  await page.waitForFunction(
    (route) => window.location.pathname === route || window.location.pathname === `${route}/`,
    expect.folderRoute,
    { timeout: 15000 },
  )
  assert.ok(page.url().includes(expect.folderRoute), `${label}: Back returns to the folder`)
  await page.goBack({ waitUntil: "networkidle", timeout: 15000 })
  await page.waitForFunction(() => window.location.href.endsWith("/"), null, { timeout: 15000 })
  assert.match(page.url(), /\/$/, `${label}: Back returns home without a parallel stack`)
}

function listStagedMarkdown(contentDir) {
  const out = []

  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name

      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath)
      else if (entry.isFile() && /\.mdx?$/.test(entry.name)) out.push(relPath)
    }
  }

  walk(contentDir, "")

  return out.sort()
}

function firstStagedH1(text) {
  let fenced = false

  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }

    if (fenced) continue
    const match = /^\s*#\s+(.+?)\s*$/.exec(line)

    if (match) return match[1].trim()
  }

  return ""
}

function frontmatterTitle(text) {
  const lines = text.split("\n")

  if (lines[0]?.trim() !== "---") return ""
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---")

  if (close === -1) return ""
  const fm = lines.slice(1, close).join("\n")
  const m = fm.match(/^title:\s*(.+?)\s*$/m)

  if (!m) return ""
  let v = m[1].trim()

  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1)

  return v.trim()
}

/**
 * Overflow probes derived from staged content: the deepest staged route
 * keeps breadcrumb ancestry; the longest H1 wraps; the first staged notes
 * carrying a table, code fence, or image keep those elements contained.
 * Every probed page also asserts no page-level overflow. The image probe is
 * required unless `requireImage` is false, so real-corpus runs survive
 * vaults with no Markdown image syntax while the synthetic fixture keeps
 * requiring it.
 */
function deriveProbes(contentDir, { requireImage = true } = {}) {
  const probes = { deep: null, longTitle: null, table: null, code: null, image: null }

  for (const rel of listStagedMarkdown(contentDir)) {
    const text = fs.readFileSync(path.join(contentDir, rel), "utf8")
    const route = routeForStagedMarkdown(rel)

    if (route === "/") continue
    const segments = route.split("/").filter(Boolean).length

    if (!probes.deep || segments > probes.deep.segments) probes.deep = { route, segments }
    const h1 = frontmatterTitle(text) || firstStagedH1(text)

    if (h1 && (!probes.longTitle || h1.length > probes.longTitle.title.length)) {
      probes.longTitle = { route, title: h1 }
    }

    if (!probes.table && /^\s*\|.*\|\s*$/m.test(text)) probes.table = { route }

    if (!probes.code && /^```/m.test(text)) probes.code = { route }

    if (!probes.image && /!\[[^\]]*\]\(/.test(text)) probes.image = { route }
  }

  assert.ok(probes.deep, "staged content has a nested note for breadcrumb probes")
  assert.ok(probes.longTitle, "staged content has a titled note for title probes")
  assert.ok(probes.table, "staged content has a table note for containment probes")

  if (requireImage) {
    assert.ok(probes.image, "staged content has an image note for containment probes")
  }

  return probes
}

async function runDerivedOverflowProbes(
  page,
  baseUrl,
  contentDir,
  label,
  { checkWiki = false, requireImage = true } = {},
) {
  const probes = deriveProbes(contentDir, { requireImage })

  await goto(page, `${baseUrl}${probes.deep.route}`)

  const crumbs = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-breadcrumbs [data-slot='breadcrumb-item']")).map(
      (li) => ({
        text: li.textContent?.trim() || "",
      }),
    ),
  )

  assert.ok(
    crumbs.length >= probes.deep.segments + 1,
    `${label}: deep note keeps full breadcrumb ancestry (${probes.deep.route})`,
  )

  const crumbWidths = await page.evaluate(() => ({
    list: document.querySelector(".reader-breadcrumbs ol")?.scrollWidth || 0,
    inner: window.innerWidth,
  }))

  assert.ok(
    crumbWidths.list <= crumbWidths.inner + 1,
    `${label}: breadcrumbs wrap inside the viewport`,
  )

  // Phone header item 2: the trail stays mounted for desktop parity but
  // hidden on phones (it returns inside the body in item 6).
  if (crumbWidths.inner < 768) {
    assert.equal(
      await isVisible(page, ".reader-header-trail .reader-breadcrumbs"),
      false,
      `${label}: phone header hides the trail on the deep note`,
    )
  }

  await assertNoPageOverflow(page, `${label} deep note`)

  await goto(page, `${baseUrl}${probes.longTitle.route}`)

  const longTitle = await page.evaluate(() => ({
    h1: document.querySelector("article h1")?.textContent?.trim() || "",
    width: document.querySelector("article h1")?.getBoundingClientRect().width || 0,
    inner: window.innerWidth,
  }))

  assert.ok(longTitle.h1.length > 40, `${label}: probe note carries a long title`)
  assert.ok(
    longTitle.width <= longTitle.inner + 1,
    `${label}: long title wraps without obscuring content`,
  )
  await assertNoPageOverflow(page, `${label} long title`)

  await goto(page, `${baseUrl}${probes.table.route}`)

  const table = await page.evaluate(() => {
    const el = document.querySelector("article table")

    return { present: !!el, client: el?.clientWidth || 0, inner: window.innerWidth }
  })

  assert.ok(table.present, `${label}: probe note renders a table (${probes.table.route})`)
  assert.ok(table.client <= table.inner + 1, `${label}: wide table is contained locally`)
  await assertNoPageOverflow(page, `${label} table note`)

  if (probes.image) {
    // External Markdown images can keep the network idle indefinitely, so the
    // image probe navigates on DOM content and still asserts presence,
    // containment, and page overflow below.
    await page.goto(`${baseUrl}${probes.image.route}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    })

    const image = await page.evaluate(() => ({
      present: !!document.querySelector("article img"),
      width: document.querySelector("article img")?.getBoundingClientRect().width || 0,
      inner: window.innerWidth,
    }))

    assert.ok(image.present, `${label}: probe note renders an image (${probes.image.route})`)
    assert.ok(image.width <= image.inner + 1, `${label}: wide image is contained locally`)
    await assertNoPageOverflow(page, `${label} image note`)
  }

  if (probes.code) {
    await goto(page, `${baseUrl}${probes.code.route}`)

    const code = await page.evaluate(() => {
      const el = document.querySelector("article pre")

      return { present: !!el, client: el?.clientWidth || 0, inner: window.innerWidth }
    })

    assert.ok(code.present, `${label}: probe note renders a code block (${probes.code.route})`)
    assert.ok(code.client <= code.inner + 1, `${label}: code block is contained locally`)
    await assertNoPageOverflow(page, `${label} code note`)
  }

  if (checkWiki) {
    await goto(page, `${baseUrl}${probes.table.route}`)

    const wiki = await page.evaluate(() => ({
      resolved: !!document.querySelector("article a.internal:not(.new)"),
      unresolved: !!document.querySelector("article a.internal.new"),
    }))

    assert.ok(wiki.resolved, `${label}: resolved wikilink renders`)
    assert.ok(wiki.unresolved, `${label}: unresolved wikilink stays visible`)
  }
}

/** Keyboard: Tab reaches the trigger, Enter opens it, Escape closes it. */
async function runKeyboardChecks(page, baseUrl, label) {
  await goto(page, `${baseUrl}/`)
  let focused = null

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Tab")
    focused = await page.evaluate(() => document.activeElement?.getAttribute("data-sidebar") || "")

    if (String(focused).includes("trigger")) break
  }

  assert.ok(
    String(focused).includes("trigger"),
    `${label}: keyboard Tab reaches the sidebar trigger`,
  )

  // The registry trigger transitions all properties: wait for the focus
  // outline to settle before asserting its ring.
  await page.waitForFunction(
    () => {
      const el = document.activeElement

      if (!el) return false

      return getComputedStyle(el).outlineWidth === "2px"
    },
    null,
    { timeout: 5000 },
  )

  const outline = await page.evaluate(() => {
    const el = document.activeElement

    if (!el) return null
    const style = getComputedStyle(el)

    return { width: style.outlineWidth, style: style.outlineStyle }
  })

  assert.equal(outline?.style, "solid", `${label}: keyboard focus is visible on the trigger`)

  assert.equal(outline?.style, "solid", `${label}: keyboard focus is visible on the trigger`)
  assert.equal(outline?.width, "2px", `${label}: keyboard focus ring is 2px on the trigger`)
  await page.keyboard.press("Enter")
  await page.waitForFunction(
    () => !!document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]'),
    null,
    { timeout: 5000 },
  )
  await page.waitForSelector('[data-sidebar="sidebar"][data-mobile="true"]', {
    state: "visible",
    timeout: 5000,
  })
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    true,
    `${label}: Enter opens the drawer`,
  )
  await page.keyboard.press("Escape")
  await page.waitForFunction(
    () => !document.querySelector('[data-sidebar="sidebar"][data-mobile="true"]'),
    null,
    { timeout: 5000 },
  )

  const returned = await page.evaluate(
    () => document.activeElement?.getAttribute("data-sidebar") || "",
  )

  assert.ok(
    String(returned).includes("trigger"),
    `${label}: Escape closes the drawer and returns focus`,
  )
}

/** Desktop keeps the persistent registry sidebar with its trigger. */
async function runDesktopChecks(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)
  assert.equal(
    await isVisible(page, '[data-slot="sidebar"]'),
    true,
    `${label}: registry sidebar stays visible`,
  )
  assert.equal(
    await isVisible(page, '[data-sidebar="trigger"]'),
    true,
    `${label}: sidebar trigger stays visible`,
  )
  assert.equal(
    await isVisible(page, '.reader-header-trail > button:not([data-sidebar="trigger"])'),
    false,
    `${label}: phone brand button stays off desktop`,
  )
  assert.deepEqual(
    (await browseRoots(page)).map((a) => a.text),
    expect.areas,
    `${label}: sidebar keeps published root order`,
  )
  await goto(page, `${baseUrl}${expect.leafRoute}`)
  await assertNoPageOverflow(page, `${label} note`)
  await assertTouchTargets(page, `${label} note`)
  await assertLandmarks(page, `${label} note`)
}

/* listFilesRecursive shared from the desktop backbone (identical). */

/* assertAbsentEverywhere shared from the desktop backbone (identical). */

/** Static output and repository boundary inspection. */
async function runOutputInspection(outDir, workDir, kbRoot, sentinel) {
  if (sentinel) assertAbsentEverywhere(outDir, sentinel, "unselected sentinel")
  assertAbsentEverywhere(outDir, fs.realpathSync(kbRoot), "original vault path")
  assertAbsentEverywhere(outDir, fs.realpathSync(workDir), "private staging path")
  assertAbsentEverywhere(outDir, fs.realpathSync(PUBLISHER_ROOT), "private publisher path")

  const readerSources = ["source.config.ts", "next.config.mjs"]
    .map((file) => path.join(READER_ROOT, file))
    .concat(
      ["app", "lib", "components"].flatMap((dir) => {
        const abs = path.join(READER_ROOT, dir)

        return fs
          .readdirSync(abs, { recursive: true })
          .filter((entry) => /\.(ts|tsx|mjs|css)$/.test(entry))
          .map((entry) => path.join(abs, entry))
      }),
    )

  // Offline support is the sanctioned service-worker use: the generated
  // worker and its registration may mention workbox and service workers.
  // Bundled search engines stay out; publication still has no content API.
  const forbidden = ["pagefind", "flexsearch", "lunr", "fumadocs-ui", "dockerfile"]

  for (const file of readerSources) {
    const text = fs.readFileSync(file, "utf8")

    for (const token of forbidden) {
      assert.ok(
        !text.toLowerCase().includes(token.toLowerCase()),
        `${path.relative(PUBLISHER_ROOT, file)} must not introduce ${token}`,
      )
    }
  }

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
  assert.ok(
    emitted.includes("sw.js") && emitted.includes("offline.json"),
    "static export carries the generated offline worker and manifest",
  )

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
    `generated content stays untracked (got: ${generated.join("; ")})`,
  )

  for (const ignored of ["reader/.source", "reader/.next", "reader/out"]) {
    const check = await execFileAsync("git", ["check-ignore", ignored], { cwd: PUBLISHER_ROOT })
    assert.match(check.stdout, new RegExp(ignored.replace(/\./g, "\\.")), `${ignored} is ignored`)
  }
}

/**
 * Real-corpus build helper (env-gated tests only): stage the given vault
 * checkout, build the reader, and serve the result on its own port.
 * Synthetic tests do not use this; they share getSharedSyntheticBuild().
 */
async function buildAndServe(kbRoot) {
  const work = tmpdir("work")
  const contentDir = path.join(work, "content")
  const identityFile = path.join(work, "site-identity.json")
  await stageKb(kbRoot, contentDir, identityFile)
  const metadata = JSON.parse(fs.readFileSync(identityFile, "utf8"))
  const journey = derivePhoneJourney(contentDir, metadata)
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

  const { server, baseUrl } = await serveOut(outDir)

  return { server, baseUrl, outDir, work, contentDir, metadata, journey }
}

/** Wait until the Search dialog is open with its input focused. */
async function searchDialogOpen(page) {
  await page.waitForSelector('[data-slot="dialog-content"]', { state: "visible", timeout: 5000 })
  await page.waitForFunction(
    () => document.activeElement && document.activeElement.id === "reader-search-input",
    null,
    { timeout: 5000 },
  )
}

async function searchDialogClosed(page) {
  await page.waitForFunction(() => !document.querySelector('[data-slot="dialog-content"]'), null, {
    timeout: 5000,
  })
}

/** Set the dialog query the way React observes it (controlled input). */
async function setPhoneSearchQuery(page, text) {
  await page.evaluate((value) => {
    const el = document.getElementById("reader-search-input")

    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set
    setter.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }, text)
}

/**
 * Search dialog at phone width: header control, states, touch targets,
 * keyboard journey to a static route, shortcut open, focus return.
 */
async function runPhoneSearchDialog(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)
  assert.ok(
    await isVisible(page, ".reader-search-header"),
    `${label}: header Search control is visible`,
  )
  assert.equal(
    await isVisible(page, ".reader-search-sidebar"),
    false,
    `${label}: sidebar Search stays hidden with the panel`,
  )

  const triggerHeight = await page.evaluate(
    () => document.querySelector(".reader-search-header")?.getBoundingClientRect().height,
  )

  assert.ok(triggerHeight >= 44, `${label}: header Search is ${triggerHeight}px (expected >= 44)`)

  await page.evaluate(() => document.querySelector(".reader-search-header")?.click())
  await searchDialogOpen(page)

  const dialogMeta = await page.evaluate(() => ({
    title:
      document
        .querySelector('[data-slot="dialog-content"] [data-slot="dialog-title"]')
        ?.textContent?.trim() || "",
    labelled: !!document.querySelector('label[for="reader-search-input"]'),
    live: document.querySelector(".reader-search-status")?.getAttribute("aria-live") || "",
    status: document.querySelector(".reader-search-status")?.textContent?.trim() || "",
  }))

  assert.equal(dialogMeta.title, "Search", `${label}: dialog is labelled Search`)
  assert.ok(dialogMeta.labelled, `${label}: search input is labeled`)
  assert.equal(dialogMeta.live, "polite", `${label}: state changes announce politely`)
  assert.ok(dialogMeta.status.includes("Type to find a note"), `${label}: empty state shows`)

  await setPhoneSearchQuery(page, "zzz-no-such-note-qqq9")
  await page.waitForFunction(
    () => document.querySelector(".reader-search-status")?.textContent?.includes("No results"),
    null,
    { timeout: 10000 },
  )

  await setPhoneSearchQuery(page, expect.leafTitle)
  await page.waitForSelector(".reader-search-result", { state: "visible", timeout: 10000 })

  const results = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-search-result")).map((a) => ({
      title: a.querySelector(".reader-search-result-title")?.textContent?.trim() || "",
      href: a.getAttribute("href") || "",
      excerpt: a.querySelector(".reader-search-result-excerpt")?.textContent?.trim() || "",
    })),
  )

  assert.ok(results.length > 0, `${label}: typing shows ranked results`)

  for (const hit of results) {
    assert.ok(hit.title.length > 0, `${label}: each result carries a title`)
    assert.ok(hit.href.startsWith("/"), `${label}: each result carries a static location`)
    assert.ok(hit.excerpt.length > 0, `${label}: each result carries an excerpt`)
  }

  assert.ok(
    results.some((hit) => hit.href === expect.leafRoute),
    `${label}: results reach the nested note`,
  )

  for (const height of await visibleHeights(page, ".reader-search-result")) {
    assert.ok(height >= 44, `${label}: result touch target is ${height}px (expected >= 44)`)
  }

  await assertNoPageOverflow(page, `${label} search dialog`)

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

  assert.ok(await activeEndsWith("-option-0"), `${label}: first result starts highlighted`)

  if (results.length > 1) {
    await page.keyboard.press("ArrowDown")
    assert.ok(await activeEndsWith("-option-1"), `${label}: ArrowDown moves the highlight`)
    await page.keyboard.press("ArrowUp")
    assert.ok(await activeEndsWith("-option-0"), `${label}: ArrowUp returns the highlight`)
  }

  await Promise.all([
    page.waitForURL((url) => url.href.includes(firstHref), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.keyboard.press("Enter"),
  ])
  assert.ok(page.url().includes(firstHref), `${label}: Enter opens the static route`)
  assert.equal(
    await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
    results[0].title,
    `${label}: result navigation lands on the right page`,
  )

  await goto(page, `${baseUrl}/`)
  await page.evaluate(() => document.querySelector(".reader-search-header")?.focus())
  await page.keyboard.down("Control")
  await page.keyboard.press("k")
  await page.keyboard.up("Control")
  await searchDialogOpen(page)
  assert.equal(
    await page.evaluate(() => document.querySelectorAll('[data-slot="dialog-content"]').length),
    1,
    `${label}: shortcut opens exactly one dialog`,
  )
  await page.keyboard.press("Escape")
  await searchDialogClosed(page)
  const returned = await page.evaluate(() => document.activeElement?.className || "")
  assert.ok(
    String(returned).includes("reader-search-header"),
    `${label}: Escape returns focus to the header control`,
  )
  await assertTouchTargets(page, `${label} search`)
}

/**
 * Offline and appearance placement on phones.
 *
 * The closed drawer leaves a compact display-only cue in the reading
 * header; opening the drawer reveals appearance plus detailed offline
 * actions in a fixed footer that stays reachable while the tree scrolls.
 * Both read one mounted state. Choosing appearance or opening the drawer
 * never starts a save; the old page footer is gone.
 */
async function runPhoneOfflinePlacement(page, baseUrl, label) {
  await goto(page, `${baseUrl}/`)
  assert.equal(
    await page.evaluate(() => !!document.querySelector(".reader-footer")),
    false,
    `${label}: old page footer does not duplicate shell controls`,
  )
  await page.waitForSelector(".reader-offline-cue", { state: "visible", timeout: 15000 })

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

  assert.ok(cue && cue.visible, `${label}: closed drawer leaves a compact offline cue`)
  assert.equal(cue.tag, "P", `${label}: cue never initiates a save`)
  await page.waitForFunction(
    () =>
      document.querySelector(".reader-offline-cue")?.getAttribute("data-offline-state") === "idle",
    null,
    { timeout: 20000 },
  )
  assert.match(
    await page.evaluate(
      () => document.querySelector(".reader-offline-cue")?.textContent?.trim() || "",
    ),
    /^Not saved$/,
    `${label}: idle chip reads Not saved`,
  )

  const chip = await page.evaluate(() => {
    const el = document.querySelector(".reader-offline-cue")

    if (!el) return null
    const style = getComputedStyle(el)
    const icon = el.querySelector("svg")
    const iconRect = icon?.getBoundingClientRect()
    const labelEl = el.querySelector("span")

    return {
      iconPresent: !!icon,
      iconWidth: iconRect ? Math.round(iconRect.width) : 0,
      iconSharesMutedColor: icon ? getComputedStyle(icon).color === style.color : false,
      labelSize: labelEl ? getComputedStyle(labelEl).fontSize : "",
      labelTruncates: labelEl ? getComputedStyle(labelEl).overflow === "hidden" : false,
      radius: style.borderRadius,
      background: style.backgroundColor,
      height: Math.round(el.getBoundingClientRect().height),
      textColor: style.color,
      role: el.getAttribute("role"),
      live: el.getAttribute("aria-live"),
      online: el.getAttribute("data-online"),
      update: el.getAttribute("data-update"),
    }
  })

  assert.ok(chip?.iconPresent, `${label}: idle chip carries the Not saved icon`)
  assert.equal(chip?.iconWidth, 12, `${label}: chip icon is 12px`)
  assert.ok(chip?.iconSharesMutedColor, `${label}: Not saved icon shares the muted label color`)
  assert.equal(chip?.labelSize, "11px", `${label}: chip label is 11px`)
  assert.ok(chip?.labelTruncates, `${label}: chip label truncates`)
  assert.ok(
    Number.parseFloat(chip?.radius ?? "") > 1000,
    `${label}: chip is a pill (got ${chip?.radius})`,
  )
  assert.match(
    chip?.background ?? "",
    /oklch\(0\.97 0 0\)|245,\s*245,\s*245/,
    `${label}: chip sits on the muted pill`,
  )
  assert.ok(
    (chip?.height ?? 0) >= 27 && (chip?.height ?? 0) <= 30,
    `${label}: chip is ~28px tall (got ${chip?.height}px)`,
  )
  assert.match(
    chip?.textColor ?? "",
    /oklch\(0\.556 0 0\)|115,\s*115,\s*115/,
    `${label}: Not saved chip is muted`,
  )
  assert.equal(chip?.role, "status", `${label}: idle chip announces politely`)
  assert.equal(chip?.live, "polite", `${label}: idle chip live region is polite`)
  assert.equal(chip?.online, null, `${label}: online chip carries no offline marker`)
  assert.equal(chip?.update, null, `${label}: chip carries no update marker without an update`)

  await page.evaluate(() => document.querySelector(".reader-offline-cue")?.click())
  await new Promise((resolve) => setTimeout(resolve, 500))

  const afterCue = await page.evaluate(async () => {
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

  assert.equal(afterCue.hasReg, false, `${label}: cue does not start a save`)
  assert.equal(afterCue.count, 0, `${label}: cue downloads nothing`)

  await openDrawer(page)

  const afterOpen = await page.evaluate(async () => {
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

  assert.equal(afterOpen.hasReg, false, `${label}: opening the drawer does not start a save`)
  assert.equal(afterOpen.count, 0, `${label}: opening the drawer downloads nothing`)

  const footer = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-footer',
    )

    if (!el) return null
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)

    return {
      visible: style.display !== "none" && rect.width > 0 && rect.height > 0,
      bottom: rect.bottom,
      inner: window.innerHeight,
    }
  })

  assert.ok(footer && footer.visible, `${label}: drawer footer shows actions`)
  assert.ok(
    footer.bottom <= footer.inner + 1,
    `${label}: drawer footer stays reachable while the tree scrolls`,
  )

  const drawer = await page.evaluate(() => {
    const scope = '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-footer'
    const group = document.querySelector(`${scope} [role="group"][aria-label="Appearance"]`)

    return {
      hasAppearance: !!group,
      appearanceText: group?.textContent?.trim() || "",
      hasSave: !!document.querySelector(`${scope} .reader-offline-save`),
      size: document.querySelector(`${scope} .reader-offline-size`)?.textContent || "",
      trust: document.querySelector(`${scope} .reader-offline-trust`)?.textContent || "",
    }
  })

  assert.ok(
    drawer.hasAppearance &&
      drawer.appearanceText.includes("Light") &&
      drawer.appearanceText.includes("Dark") &&
      drawer.appearanceText.includes("System"),
    `${label}: drawer footer shows appearance`,
  )
  assert.ok(drawer.hasSave, `${label}: drawer footer shows Save for offline use`)
  assert.match(drawer.size, /B/, `${label}: estimated size stays clear`)
  assert.match(drawer.trust, /trust/i, `${label}: trusted-device reminder stays clear`)

  const shared = await page.evaluate(() => ({
    cue: document.querySelector(".reader-offline-cue")?.getAttribute("data-offline-state") || "",
    detail:
      document
        .querySelector('[data-sidebar="sidebar"][data-mobile="true"] .reader-offline')
        ?.getAttribute("data-offline-state") || "",
  }))

  assert.equal(shared.cue, "idle", `${label}: cue shares the mounted offline state`)
  assert.equal(shared.detail, "idle", `${label}: drawer details share the mounted offline state`)

  const scroll = await page.evaluate(() => {
    const tree = document.querySelector(
      '[data-sidebar="sidebar"][data-mobile="true"] [data-sidebar="content"]',
    )

    const style = tree ? getComputedStyle(tree) : null

    return {
      overflowY: style ? style.overflowY : "",
      height: tree ? tree.getBoundingClientRect().height : 0,
    }
  })

  assert.ok(
    scroll.overflowY === "auto" || scroll.overflowY === "scroll",
    `${label}: drawer tree scrolls independently`,
  )

  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll(
        '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-footer [role="group"][aria-label="Appearance"] button',
      ),
    )

    buttons.find((button) => (button.textContent || "").includes("Dark"))?.click()
  })
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"), null, {
    timeout: 5000,
  })

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

  assert.equal(afterAppearance.hasReg, false, `${label}: choosing appearance does not save`)
  assert.equal(afterAppearance.count, 0, `${label}: choosing appearance downloads nothing`)

  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll(
        '[data-sidebar="sidebar"][data-mobile="true"] .reader-sidebar-footer [role="group"][aria-label="Appearance"] button',
      ),
    )

    buttons.find((button) => (button.textContent || "").includes("System"))?.click()
  })
  await closeDrawer(page)
  assert.equal(
    await isVisible(page, ".reader-offline-cue"),
    true,
    `${label}: cue remains after the drawer closes`,
  )
}

/**
 * Home card slice at phone width, folded from the retired home-cards
 * suite: ordered links, distinct folder/note cues, kind-prefixed desktop
 * meta with accurate counts, count-only phone meta, hidden-route
 * exclusion, no Home self-link, containment, touch targets, phone body
 * measurements from design screen I1z3qM, and real card navigation with
 * Back.
 */
async function runPhoneCardsDetail(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)

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
    `${label}: cards link published routes in order`,
  )
  assert.deepEqual(
    cards.map((c) => c.kind),
    expect.kinds,
    `${label}: cards keep distinct folder/note cues`,
  )

  for (const [index, title] of expect.areas.entries()) {
    assert.ok(
      cards[index].text.includes(title),
      `${label}: card keeps its published title: ${title}`,
    )
  }

  for (const card of cards) {
    assert.ok(card.card, `${label}: card uses the registry Card surface`)
    assert.ok(card.kind === "folder" || card.kind === "note", `${label}: distinct folder/note cue`)
  }

  assert.ok(!cards.some((c) => c.href === "/"), `${label}: no Home self-link card`)
  assert.ok(
    !cards.some((c) => c.text.includes("Hidden Draft")),
    `${label}: routes outside navigation never become cards`,
  )

  const metas = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-area-list .reader-home-card-meta")).map(
      (el) => el.textContent?.trim() || "",
    ),
  )

  assert.ok(metas.length > 0, `${label}: cards carry a kind meta line`)

  for (const meta of metas) {
    assert.match(
      meta,
      /^(Folder|Note)( · \d+ items?)?$/,
      `${label}: card meta stays kind plus count`,
    )
  }

  const cardText = cards.map((c) => c.text).join("\n")
  assert.match(cardText, /Folder · 12 items/, `${label}: flat folder count is accurate`)
  assert.match(cardText, /Folder · 2 items/, `${label}: authored folder count is accurate`)

  // Mobile port home-phone: the phone body matches design screen I1z3qM —
  // 12px muted Home crumb, 26px h1, [20, 16, 32, 16] body padding, and
  // 60px-ish bordered rows with a 36px muted icon box, semibold 14px
  // title, count-only 12px meta, trailing chevron, and 12px card gaps.
  const phoneBody = await page.evaluate(() => {
    const article = document.querySelector(".reader-article")

    const crumb = Array.from(article?.querySelectorAll(":scope > span") ?? []).find(
      (node) => node.textContent?.trim() === "Home",
    )

    const h1 = article?.querySelector("h1")

    const shell = document.querySelector(".reader-shell")

    const shellStyle = shell ? getComputedStyle(shell) : null

    const items = Array.from(document.querySelectorAll(".reader-area-list > li")).map((li) =>
      li.getBoundingClientRect().toJSON(),
    )

    return {
      crumb: crumb
        ? { display: getComputedStyle(crumb).display, fontSize: getComputedStyle(crumb).fontSize }
        : null,
      h1Size: h1 ? getComputedStyle(h1).fontSize : "",
      shell: shellStyle
        ? {
            top: shellStyle.paddingTop,
            right: shellStyle.paddingRight,
            bottom: shellStyle.paddingBottom,
            left: shellStyle.paddingLeft,
          }
        : null,
      items,
      cards: Array.from(document.querySelectorAll(".reader-area-list a")).map((a) => {
        const visible = (selector) =>
          Array.from(a.querySelectorAll(selector)).filter(
            (el) => el.getBoundingClientRect().height > 0,
          )

        const [title] = visible('[data-slot="card-title"]')

        const [meta] = visible('[data-slot="card-description"]')

        const [box] = visible("span.size-9")

        const [chevron] = visible("svg.lucide-chevron-right")

        const titleStyle = title ? getComputedStyle(title) : null

        const metaStyle = meta ? getComputedStyle(meta) : null

        const boxRect = box?.getBoundingClientRect()

        return {
          title: title?.textContent?.trim() ?? "",
          titleSize: titleStyle?.fontSize ?? "",
          titleWeight: titleStyle?.fontWeight ?? "",
          meta: meta?.textContent?.trim() ?? "",
          metaSize: metaStyle?.fontSize ?? "",
          box: boxRect ? { width: boxRect.width, height: boxRect.height } : null,
          chevron: !!chevron,
          height: a.getBoundingClientRect().height,
        }
      }),
    }
  })

  assert.ok(phoneBody.crumb, `${label}: phone Home crumb renders`)
  assert.notEqual(phoneBody.crumb.display, "none", `${label}: phone Home crumb is visible`)
  assert.equal(phoneBody.crumb.fontSize, "12px", `${label}: phone Home crumb is 12px`)
  assert.equal(phoneBody.h1Size, "26px", `${label}: phone h1 is 26px`)
  assert.deepEqual(
    phoneBody.shell,
    { top: "20px", right: "16px", bottom: "32px", left: "16px" },
    `${label}: phone body padding matches the design`,
  )

  for (const [index, card] of phoneBody.cards.entries()) {
    assert.ok(card.chevron, `${label}: card keeps its trailing chevron: ${card.title}`)
    assert.deepEqual(
      card.box,
      { width: 36, height: 36 },
      `${label}: card icon sits in a 36px muted box: ${card.title}`,
    )
    assert.equal(card.titleSize, "14px", `${label}: card title is 14px: ${card.title}`)
    assert.equal(card.titleWeight, "600", `${label}: card title is semibold: ${card.title}`)
    assert.equal(card.metaSize, "12px", `${label}: card meta is 12px: ${card.title}`)

    if (expect.kinds[index] === "folder") {
      assert.match(
        card.meta,
        /^\d+ items?$/,
        `${label}: phone card meta is count-only: ${card.title}`,
      )
    } else {
      assert.equal(card.meta, "Note", `${label}: phone note card keeps kind meta: ${card.title}`)
    }

    assert.ok(
      card.height >= 56 && card.height <= 72,
      `${label}: card row is 60px-ish (got ${card.height}px): ${card.title}`,
    )
  }

  if (phoneBody.items.length >= 2) {
    const gap = phoneBody.items[1].top - phoneBody.items[0].bottom

    assert.equal(gap, 12, `${label}: phone card gap is 12px (got ${gap}px)`)
  }

  const titlesFit = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".reader-area-list .reader-home-card-title")).map(
      (el) => ({
        right: el.getBoundingClientRect().right,
        inner: window.innerWidth,
      }),
    ),
  )

  for (const title of titlesFit) {
    assert.ok(title.right <= title.inner + 1, `${label}: long card title stays inside the viewport`)
  }

  for (const height of await visibleHeights(page, ".reader-area-list a")) {
    assert.ok(height >= 44, `${label}: card link touch target is ${height}px (expected >= 44)`)
  }

  await assertNoPageOverflow(page, `${label} home cards`)

  // Real navigation at phone width: a card opens its published route, and
  // Back returns home without a parallel stack.
  await Promise.all([
    page.waitForURL((url) => url.href.includes(expect.folderRoute), {
      waitUntil: "networkidle",
      timeout: 15000,
    }),
    page.evaluate((href) => {
      document.querySelector(`.reader-area-list a[href="${href}"]`)?.click()
    }, expect.folderRoute),
  ])
  assert.ok(page.url().includes(expect.folderRoute), `${label}: card opens its published route`)
  await page.goBack({ waitUntil: "networkidle", timeout: 15000 })
  await page.waitForFunction(() => window.location.href.endsWith("/"), null, { timeout: 15000 })
  assert.match(page.url(), /\/$/, `${label}: Back returns home`)
}

/**
 * Phone header trail (mobile port item 2): the desktop breadcrumb trail
 * leaves the phone header — deep and long routes keep a 64px header with
 * the brand row visible while the trail and separator stay hidden. The
 * trail returns inside the body in item 6; desktop assertions stay in
 * runBreadcrumbsDetail.
 */
async function runPhoneBreadcrumbsDetail(page, baseUrl, contentDir, label) {
  const probes = deriveProbes(contentDir, { requireImage: true })

  for (const [route, tag] of [
    [probes.deep.route, "deep"],
    [probes.longTitle.route, "long"],
  ]) {
    await goto(page, `${baseUrl}${route}`)

    const header = await page.evaluate(() => {
      const headerEl = document.querySelector(".reader-header")
      const crumbs = document.querySelector(".reader-header-trail .reader-breadcrumbs")
      const crumbsRect = crumbs?.getBoundingClientRect() || null
      const separator = document.querySelector('.reader-header-trail [data-slot="separator"]')
      const separatorRect = separator?.getBoundingClientRect() || null
      const brandSpan = document.querySelector(".reader-header-trail span.truncate")
      const brandRect = brandSpan?.getBoundingClientRect() || null

      return {
        height: headerEl?.getBoundingClientRect().height || 0,
        brandText: brandSpan?.textContent?.trim() || "",
        brandVisible:
          !!brandSpan &&
          !!brandRect &&
          brandRect.width > 0 &&
          brandRect.height > 0 &&
          getComputedStyle(brandSpan).display !== "none",
        crumbsVisible:
          !!crumbs &&
          !!crumbsRect &&
          getComputedStyle(crumbs).display !== "none" &&
          crumbsRect.width > 0 &&
          crumbsRect.height > 0,
        separatorVisible:
          !!separator &&
          !!separatorRect &&
          getComputedStyle(separator).display !== "none" &&
          separatorRect.width > 0 &&
          separatorRect.height > 0,
      }
    })

    assert.ok(
      Math.abs(header.height - 64) <= 1,
      `${label}: ${tag} header is 64px tall (got ${header.height}px)`,
    )
    assert.ok(header.brandVisible, `${label}: ${tag} header shows the brand row`)
    assert.ok(header.brandText.length > 0, `${label}: ${tag} brand row keeps its title`)
    assert.equal(header.crumbsVisible, false, `${label}: ${tag} trail leaves the phone header`)
    assert.equal(
      header.separatorVisible,
      false,
      `${label}: ${tag} separator leaves the phone header`,
    )
    await assertNoPageOverflow(page, `${label} ${tag} header`)
  }

  // Phone keyboard: the hidden trail is not focusable, so Tab never lands
  // inside it. Trigger reachability stays covered by runKeyboardChecks.
  await goto(page, `${baseUrl}${probes.deep.route}`)
  await page.evaluate(() => document.querySelector('[data-sidebar="trigger"]')?.blur())
  let foundCrumb = false

  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab")

    const inTrail = await page.evaluate(
      () => !!document.activeElement?.closest(".reader-breadcrumbs"),
    )

    if (inTrail) {
      foundCrumb = true
      break
    }
  }

  assert.equal(foundCrumb, false, `${label}: hidden trail stays out of the tab order`)
}

/**
 * Phone note page (mobile port item 6, design screen pWNyV): the body
 * carries a 12px muted slash trail, then the shared 11px muted meta line
 * (`{parent} • {N} min read` plus dot plus relative Updated date), then
 * the 24px/700 title, with the 14px body / 16px h2 / 12px code phone
 * scale; the shared Other notes section shows its 13px/600 head with a
 * count pill, file-icon rows, and a "Show all N notes" foot that expands
 * client-side when more than six siblings exist.
 */
async function runPhoneNoteDetail(page, baseUrl, label) {
  // Timestamped note with siblings: trail -> meta -> title order plus type scale.
  await goto(page, `${baseUrl}/notes/valid-offset`)

  const note = await page.evaluate(() => {
    const article = document.querySelector(".reader-article")
    const trail = article?.querySelector(".reader-note-crumbs")

    const metas = Array.from(article?.querySelectorAll("div.text-2xs") ?? []).filter((el) =>
      (el.textContent ?? "").includes("min read"),
    )

    const visibleMeta = metas.find((el) => el.getBoundingClientRect().height > 0)
    const dot = visibleMeta?.querySelector("span[aria-hidden='true']")
    const time = visibleMeta?.querySelector("time")
    const h1 = article?.querySelector("h1")
    const h1Style = h1 ? getComputedStyle(h1) : null
    const trailStyle = trail ? getComputedStyle(trail) : null
    const metaStyle = visibleMeta ? getComputedStyle(visibleMeta) : null
    const firstPara = article?.querySelector("p:not(.reader-note-crumbs)")
    const pre = article?.querySelector("pre")
    const dotRect = dot?.getBoundingClientRect()

    return {
      trailVisible:
        !!trail && trailStyle.display !== "none" && trail.getBoundingClientRect().height > 0,
      trailText: trail?.textContent?.trim() || "",
      trailSize: trailStyle?.fontSize || "",
      trailColor: trailStyle?.color || "",
      trailPadding: trailStyle?.paddingBottom || "",
      trailTop: trail?.getBoundingClientRect().top || 0,
      metaText: visibleMeta?.textContent?.trim() || null,
      metaSize: metaStyle?.fontSize || "",
      metaColor: metaStyle?.color || "",
      metaTop: visibleMeta?.getBoundingClientRect().top || 0,
      metaCount: metas.length,
      metaDot: !!dot,
      metaDotClass: dot?.className || "",
      metaDotWidth: dotRect?.width || 0,
      metaDotHeight: dotRect?.height || 0,
      metaDatetime: time?.getAttribute("datetime") || null,
      metaUpdated: time?.textContent?.trim() || null,
      h1Size: h1Style?.fontSize || "",
      h1Weight: h1Style?.fontWeight || "",
      h1Top: h1?.getBoundingClientRect().top || 0,
      bodySize: firstPara ? getComputedStyle(firstPara).fontSize : "",
      preSize: pre ? getComputedStyle(pre).fontSize : "",
    }
  })

  assert.ok(note.trailVisible, `${label}: phone body shows the slash crumb trail`)
  assert.ok(note.trailText.includes(" / "), `${label}: trail is slash-separated`)
  assert.ok(note.trailText.includes("Home"), `${label}: trail starts at Home`)
  assert.equal(note.trailSize, "12px", `${label}: trail is 12px`)
  assert.match(note.trailColor, /115,\s*115,\s*115|oklch\(0\.556 0 0\)/, `${label}: trail is muted`)
  assert.equal(note.trailPadding, "4px", `${label}: trail keeps 4px bottom padding`)
  assert.match(
    note.metaText ?? "",
    /Notes • 1 min read/,
    `${label}: meta names parent plus minutes`,
  )
  assert.match(note.metaUpdated ?? "", /^Updated .+ ago$/, `${label}: meta date is relative`)
  assert.equal(note.metaDatetime, "2026-09-20T12:30:00.000Z", `${label}: meta keeps machine time`)
  assert.equal(note.metaSize, "11px", `${label}: meta line is 11px`)
  assert.match(note.metaColor, /115,\s*115,\s*115|oklch\(0\.556 0 0\)/, `${label}: meta is muted`)
  assert.equal(note.metaCount, 1, `${label}: exactly one meta line renders`)
  assert.ok(note.metaDot, `${label}: meta carries the dot separator`)
  assert.ok(note.metaDotClass.includes("bg-border"), `${label}: dot uses the border token`)
  assert.ok(
    Math.abs(note.metaDotWidth - 3) <= 1,
    `${label}: dot is 3px wide (got ${note.metaDotWidth})`,
  )
  assert.ok(
    Math.abs(note.metaDotHeight - 3) <= 1,
    `${label}: dot is 3px tall (got ${note.metaDotHeight})`,
  )
  assert.ok(
    note.trailTop <= note.metaTop && note.metaTop <= note.h1Top,
    `${label}: trail -> meta -> title order`,
  )
  assert.equal(note.h1Size, "24px", `${label}: phone note title is 24px`)
  assert.equal(note.h1Weight, "700", `${label}: phone note title is bold`)
  assert.equal(note.bodySize, "14px", `${label}: phone body copy is 14px`)
  await assertNoPageOverflow(page, `${label} note type scale`)

  // Body scale probes on notes carrying those elements.
  await goto(page, `${baseUrl}/notes/plain`)

  const plainScale = await page.evaluate(() => {
    const article = document.querySelector(".reader-article")
    const h2 = article?.querySelector("h2")

    const items = Array.from(article?.querySelectorAll("ul li") ?? []).map(
      (li) => getComputedStyle(li).marginTop,
    )

    return {
      h2Size: h2 ? getComputedStyle(h2).fontSize : "",
      bulletGaps: items.slice(1),
    }
  })

  assert.equal(plainScale.h2Size, "16px", `${label}: phone h2 is 16px`)

  await goto(page, `${baseUrl}/notes/guide`)

  const codeSize = await page.evaluate(() => {
    const pre = document.querySelector("article.reader-article pre")

    return pre ? getComputedStyle(pre).fontSize : ""
  })

  assert.equal(codeSize, "12px", `${label}: phone code block is 12px`)

  // Orchard note with eleven siblings: head, badge, six rows, expander.
  await goto(page, `${baseUrl}/orchard/note-01`)

  const siblings = await page.evaluate(() => {
    const section = document.querySelector('article section[aria-label^="Other notes"]')
    const head = section?.querySelector(":scope > div")
    const title = head?.querySelector("span")
    const badge = head?.querySelectorAll("span")[1]
    const rows = Array.from(section?.querySelectorAll(":scope ul a") ?? [])
    const foot = section?.querySelector("button")

    return {
      present: !!section,
      label: section?.getAttribute("aria-label") || "",
      headSize: title ? getComputedStyle(title).fontSize : "",
      headWeight: title ? getComputedStyle(title).fontWeight : "",
      badge: badge?.textContent?.trim() || "",
      badgePadding: badge
        ? {
            top: getComputedStyle(badge).paddingTop,
            right: getComputedStyle(badge).paddingRight,
          }
        : null,
      rows: rows.map((a) => ({
        href: a.getAttribute("href") || "",
        icon: !!a.querySelector("svg"),
        iconSize: a.querySelector("svg")?.getBoundingClientRect().width || 0,
        height: a.getBoundingClientRect().height,
      })),
      footText: foot?.textContent?.trim() || null,
      footSize: foot ? getComputedStyle(foot).fontSize : "",
      footWeight: foot ? getComputedStyle(foot).fontWeight : "",
      footChevron:
        foot?.parentElement?.querySelector("button svg")?.getBoundingClientRect().width || 0,
    }
  })

  assert.ok(siblings.present, `${label}: phone note carries the Other notes section`)
  assert.equal(siblings.label, "Other notes in Orchard", `${label}: head names the parent`)
  assert.equal(siblings.headSize, "13px", `${label}: head is 13px`)
  assert.equal(siblings.headWeight, "600", `${label}: head is semibold`)
  assert.equal(siblings.badge, "11", `${label}: count pill carries the sibling total`)
  assert.deepEqual(siblings.badgePadding, { top: "2px", right: "8px" }, `${label}: pill pads 2/8`)
  assert.equal(siblings.rows.length, 6, `${label}: six rows show before expanding`)

  for (const row of siblings.rows) {
    assert.ok(row.href.startsWith("/orchard/note-"), `${label}: row links a sibling`)
    assert.ok(row.icon, `${label}: row carries a file icon`)
    assert.equal(row.iconSize, 14, `${label}: file icon is 14px`)
    assert.ok(row.height >= 44, `${label}: phone row touch height is ${row.height}px`)
  }

  assert.equal(siblings.footText, "Show all 11 notes", `${label}: foot offers the rest`)
  assert.equal(siblings.footSize, "13px", `${label}: foot is 13px`)
  assert.equal(siblings.footWeight, "600", `${label}: foot is semibold`)
  assert.equal(siblings.footChevron, 14, `${label}: foot chevron is 14px`)

  await page.evaluate(() => {
    document.querySelector('article section[aria-label^="Other notes"] button')?.click()
  })
  await page.waitForFunction(
    () =>
      document.querySelectorAll('article section[aria-label^="Other notes"] ul a').length === 11,
    null,
    { timeout: 5000 },
  )

  const expanded = await page.evaluate(() => ({
    rows: document.querySelectorAll('article section[aria-label^="Other notes"] ul a').length,
    foot: !!document.querySelector('article section[aria-label^="Other notes"] button'),
  }))

  assert.equal(expanded.rows, 11, `${label}: expander reveals every sibling`)
  assert.equal(expanded.foot, false, `${label}: foot leaves once all siblings show`)
  await assertNoPageOverflow(page, `${label} sibling section`)
  await assertTouchTargets(page, `${label} sibling section`)
}

/**
 * Reads the open vault bottom sheet: frame geometry plus the current
 * row and ordered destination anchors. Null when no vault sheet is open
 * (the drawer sidebar renders its own sheet content without the
 * "Switch vault" list, so the two are never confused).
 */
async function readVaultSheet(page) {
  return await page.evaluate(() => {
    const root = Array.from(document.querySelectorAll('[data-slot="sheet-content"]')).find((el) =>
      el.querySelector('[aria-label="Switch vault"]'),
    )

    if (!root) return null
    const rect = root.getBoundingClientRect()
    const handle = root.querySelector('div[aria-hidden="true"]')
    const handleRect = handle?.getBoundingClientRect() || null
    const title = root.querySelector('[data-slot="sheet-title"]')
    const close = root.querySelector('[data-slot="sheet-close"]')
    const closeRect = close?.getBoundingClientRect() || null
    const list = root.querySelector('[aria-label="Switch vault"]')
    const current = list?.querySelector(':scope > li[aria-current="true"]') || null
    const anchors = list ? Array.from(list.querySelectorAll(":scope > li > a")) : []

    return {
      bottom: rect.bottom,
      width: rect.width,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      handleWidth: handleRect ? handleRect.width : 0,
      handleHeight: handleRect ? handleRect.height : 0,
      title: title?.textContent?.trim() || "",
      closeVisible: !!closeRect && closeRect.width > 0 && closeRect.height > 0,
      closeLabel: close?.getAttribute("aria-label") || "",
      text: root.textContent || "",
      current: current
        ? {
            text: current.textContent?.trim() || "",
            marked: current.getAttribute("aria-current"),
            hasCheck: !!current.querySelector("svg"),
            isAnchor: !!current.querySelector("a"),
          }
        : null,
      choices: anchors.map((anchor) => {
        const inner = Array.from(anchor.querySelectorAll(":scope > span > span")).map(
          (span) => span.textContent?.trim() || "",
        )

        return {
          name: inner.length > 0 ? inner[0] : "",
          meta: inner.length > 0 ? inner[inner.length - 1] : "",
          href: anchor.getAttribute("href"),
          tag: anchor.tagName,
          target: anchor.getAttribute("target"),
        }
      }),
    }
  })
}

/** Vault sheet row assertions shared by the drawer and header journeys. */
function assertVaultSheetRows(sheet, expect, label) {
  assert.ok(sheet, `${label}: vault sheet opens`)
  assert.ok(
    Math.abs(sheet.bottom - sheet.innerHeight) <= 2,
    `${label}: sheet anchors to the viewport bottom (got ${sheet.bottom}px of ${sheet.innerHeight}px)`,
  )
  assert.ok(
    Math.abs(sheet.width - sheet.innerWidth) <= 1,
    `${label}: sheet spans the full width (got ${sheet.width}px of ${sheet.innerWidth}px)`,
  )
  assert.ok(
    Math.abs(sheet.handleWidth - 40) <= 1 && Math.abs(sheet.handleHeight - 4) <= 1,
    `${label}: sheet shows the 40x4 handle bar`,
  )
  assert.equal(sheet.title, "Switch vault", `${label}: sheet titles the vault switch`)
  assert.ok(sheet.closeVisible, `${label}: sheet shows its close control`)
  assert.ok(sheet.closeLabel !== "", `${label}: close control is labelled`)
  assert.ok(sheet.current, `${label}: sheet names the current vault`)
  assert.ok(
    sheet.current.text.includes(expect.projection),
    `${label}: current row names this vault`,
  )
  assert.equal(sheet.current.marked, "true", `${label}: current row is marked current`)
  assert.ok(sheet.current.hasCheck, `${label}: current row carries the check`)
  assert.equal(sheet.current.isAnchor, false, `${label}: current row is information, not a link`)
  assert.deepEqual(
    sheet.choices.map((choice) => ({ name: choice.name, href: choice.href })),
    expect.destinations.map((destination) => ({
      name: destination.name,
      href: destination.origin,
    })),
    `${label}: destination rows keep manifest order with absolute HTTPS origins`,
  )

  for (const [index, choice] of sheet.choices.entries()) {
    assert.equal(choice.tag, "A", `${label}: destination row ${index} is an ordinary anchor`)
    assert.ok(choice.href?.startsWith("https://"), `${label}: destination row ${index} is secure`)
    assert.equal(choice.target, null, `${label}: destination row ${index} stays same-tab`)
    assert.equal(
      choice.meta,
      new URL(choice.href).hostname,
      `${label}: destination row ${index} metas its origin host`,
    )
  }

  assert.ok(!sheet.text.includes("Add"), `${label}: sheet offers no add-vault row`)
}

async function vaultSheetOpen(page) {
  await page.waitForSelector('[data-slot="sheet-content"] [aria-label="Switch vault"]', {
    state: "visible",
    timeout: 5000,
  })
  // The bottom sheet slides up on entry: wait until it settles at the
  // viewport bottom before reading geometry.
  await page.waitForFunction(
    () => {
      const root = Array.from(document.querySelectorAll('[data-slot="sheet-content"]')).find((el) =>
        el.querySelector('[aria-label="Switch vault"]'),
      )

      if (!root) return false

      return Math.abs(root.getBoundingClientRect().bottom - window.innerHeight) <= 2
    },
    null,
    { timeout: 5000 },
  )
}

async function vaultSheetClosed(page) {
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll('[data-slot="sheet-content"]')).some((el) =>
        el.querySelector('[aria-label="Switch vault"]'),
      ),
    null,
    { timeout: 5000 },
  )
}

/**
 * Phone drawer carries the projection switcher, folded from the retired
 * projection suite (mobile port item 4): the same trigger that shows the
 * desktop dropdown opens the vault bottom sheet on phones. Escape
 * dismisses the sheet and returns focus to the drawer trigger.
 */
async function runPhoneDrawerSwitcher(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)
  await openDrawer(page)

  const drawerSwitcher = await page.evaluate(() => {
    const el = document.querySelector(
      '[data-sidebar="sidebar"][data-mobile="true"] .reader-projection-trigger',
    )

    if (!el) return null
    const rect = el.getBoundingClientRect()

    return { text: el.textContent?.trim() || "", visible: rect.width > 0 && rect.height > 0 }
  })

  assert.ok(drawerSwitcher, `${label}: phone drawer shows the projection switcher`)
  assert.ok(
    drawerSwitcher.text.includes(expect.projection),
    `${label}: drawer switcher names the current projection`,
  )
  assert.ok(drawerSwitcher.visible, `${label}: drawer switcher is visible`)
  await page.evaluate(() =>
    document
      .querySelector('[data-sidebar="sidebar"][data-mobile="true"] .reader-projection-trigger')
      ?.click(),
  )
  await vaultSheetOpen(page)
  assertVaultSheetRows(await readVaultSheet(page), expect, label)

  await page.keyboard.press("Escape")
  await vaultSheetClosed(page)

  const returned = await page.evaluate(
    () => document.activeElement?.closest(".reader-projection-trigger")?.className || "",
  )

  assert.ok(
    String(returned).includes("reader-projection-trigger"),
    `${label}: Escape returns focus to the drawer switcher trigger`,
  )
  await closeDrawer(page)
}

/**
 * Phone header brand opens the vault sheet without the drawer (mobile
 * port item 4): a phone reader switches projections straight from the
 * header. The close control and the overlay both dismiss it.
 */
async function runPhoneHeaderVaultSheet(page, baseUrl, expect, label) {
  await goto(page, `${baseUrl}/`)

  const openFromHeader = () =>
    page.evaluate(() => {
      const span = document.querySelector(".reader-header-trail span.truncate")
      const button = span?.closest("button")

      if (button instanceof HTMLElement) button.click()
    })

  await openFromHeader()
  await vaultSheetOpen(page)
  assertVaultSheetRows(await readVaultSheet(page), expect, label)
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    false,
    `${label}: header vault switch needs no drawer`,
  )

  await page.evaluate(() => {
    const root = Array.from(document.querySelectorAll('[data-slot="sheet-content"]')).find((el) =>
      el.querySelector('[aria-label="Switch vault"]'),
    )

    root?.querySelector('[data-slot="sheet-close"]')?.click()
  })
  await vaultSheetClosed(page)

  await openFromHeader()
  await vaultSheetOpen(page)
  await page.locator('[data-slot="sheet-overlay"]').click()
  await vaultSheetClosed(page)
  assert.equal(
    await isVisible(page, '[data-sidebar="sidebar"][data-mobile="true"]'),
    false,
    `${label}: overlay dismissal leaves the drawer closed`,
  )
}

/**
 * Shared canonical synthetic build: stageKb + buildReader run exactly once
 * for the whole file (cached in-file promise). Each test serves the shared
 * outDir on its own port so service workers and caches never leak between
 * tests (per-origin isolation). The phone synthetic test runs first on the
 * pristine export; the desktop synthetic test's offline-update flow rewrites
 * an exported file and is ordered after it, so no test observes another
 * test's mutations of the shared outDir.
 */
let sharedSyntheticPromise = null

function makeSyntheticKb() {
  const kb = tmpdir("kb-integrated")

  return writeSyntheticKb(kb)
}

function getSharedSyntheticBuild() {
  if (!sharedSyntheticPromise) {
    sharedSyntheticPromise = (async () => {
      const kb = makeSyntheticKb()
      const work = tmpdir("synthetic-shared")
      const contentDir = path.join(work, "content")
      const identityFile = path.join(work, "site-identity.json")

      const machineryBefore = (
        await execFileAsync("git", ["status", "--porcelain"], { cwd: PUBLISHER_ROOT })
      ).stdout
        .split("\n")
        .filter(Boolean)
        .filter((line) =>
          /(^| )(nginx\.conf|package\.json|pnpm-lock\.yaml|scripts\/|tools\/)/.test(line.trim()),
        )

      await stageKb(kb, contentDir, identityFile)
      const metadata = JSON.parse(fs.readFileSync(identityFile, "utf8"))
      cleanReaderArtifacts()
      await buildReader(contentDir, identityFile)
      const outDir = path.join(READER_ROOT, "out")

      return { kb, work, contentDir, identityFile, metadata, outDir, machineryBefore }
    })()
  }

  return sharedSyntheticPromise
}

/**
 * Device status chip variant table (mobile port item 3): the phone
 * header cue renders every offline state as a pill — including
 * unsupported, which shows Not saved instead of disappearing. Static
 * source assertions cover the states a live browser journey cannot
 * reach (ready, saving, update, failures); the live phone journey
 * covers the idle chip geometry, icon, and muted colors.
 */
test("device status chip renders every offline state without starting a save", async () => {
  const source = fs.readFileSync(path.join(READER_ROOT, "components", "offline-save.tsx"), "utf8")
  const cueStart = source.indexOf("export function OfflineCue")
  const cueEnd = source.indexOf("export function OfflineProvider")
  const cue = source.slice(cueStart, cueEnd)

  assert.ok(!/status === "unsupported"\) return null/.test(cue), "unsupported renders the chip")
  assert.match(cue, /Database/, "idle and unsupported share the database icon")
  assert.match(cue, /Not saved/, "no local copy reads Not saved")
  assert.match(cue, /Checking…/, "checking stays concise and muted")
  assert.match(cue, /Saving…/, "saving reports progress")
  assert.match(cue, /Update ready/, "an available update reads Update ready")
  assert.match(cue, /Offline · /, "browser offline reads Offline with the saved count")
  assert.match(cue, /saved`/, "the saved count comes from the manifest URL list")
  assert.match(cue, /Save incomplete/, "an incomplete save keeps its alert")
  assert.match(cue, /Couldn't remove offline copy/, "a failed removal keeps its alert")
  assert.match(cue, /data-online/, "the chip marks the browser offline state")

  for (const token of [
    "rounded-full",
    "bg-muted",
    "h-7",
    "text-2xs",
    "size-3",
    "truncate",
    "reader-offline-cue",
  ]) {
    assert.ok(cue.includes(token), `chip carries ${token}`)
  }

  assert.match(cue, /window\.addEventListener\("online"/, "chip tracks browser online state")
  assert.match(cue, /window\.addEventListener\("offline"/, "chip tracks browser offline state")
  assert.match(cue, /removeEventListener\("online"/, "chip listeners clean up")
  assert.match(cue, /removeEventListener\("offline"/, "chip listeners clean up")
  assert.ok(!/save\(\)|removeCopy\(\)|reloadUpdate\(\)/.test(cue), "chip never starts a save")

  const css = fs.readFileSync(path.join(READER_ROOT, "app", "globals.css"), "utf8")

  assert.ok(!css.includes(".reader-offline-cue"), "chip styling lives in utilities, not CSS")
})

/**
 * Vault bottom sheet static tokens (mobile port item 4): the phone vault
 * switcher renders the registry Sheet side="bottom" with the xPZVw rows
 * (washed current row with check, bordered destination anchors keyed by
 * origin host, no add-vault row) in utilities only, while the desktop
 * dropdown path and the two phone triggers stay wired.
 */
test("vault sheet matches the xPZVw bottom-sheet design tokens", async () => {
  const sheet = fs.readFileSync(path.join(READER_ROOT, "components", "vault-sheet.tsx"), "utf8")

  assert.match(sheet, /side="bottom"/, "sheet docks to the bottom")
  assert.match(sheet, /Switch vault/, "sheet titles the vault switch")
  assert.match(sheet, /aria-label="Switch vault"/, "sheet list is labelled")
  assert.match(sheet, /showCloseButton=\{false\}/, "title row owns the close control")
  assert.match(sheet, /aria-label="Close vault switcher"/, "close control is labelled")
  assert.match(sheet, /aria-current="true"/, "current row is marked current")
  assert.match(sheet, /bg-muted/, "current row carries the washed fill")
  assert.match(sheet, /bg-primary/, "current icon box is inverted")
  assert.match(sheet, /text-card/, "inverted icon reads on the primary fill")
  assert.match(sheet, /border-border/, "destination rows carry the bordered read")
  assert.match(sheet, /new URL\(/, "destination meta derives from the origin")
  assert.match(sheet, /min-h-15/, "rows hold the 60px geometry without arbitrary values")
  assert.ok(!/rounded-\[|min-h-\[|text-\[|w-\[|h-\[|p[xy]?-\[/.test(sheet), "no arbitrary values")
  assert.ok(!sheet.includes("reader-"), "sheet adds no custom hook classes")
  assert.ok(!/Add new vault/.test(sheet), "no add-vault row")

  const config = fs.readFileSync(path.join(PUBLISHER_ROOT, "oxlint.config.ts"), "utf8")

  for (const part of ["^SheetContent$", "^SheetTitle$", "^SheetClose$"]) {
    assert.ok(config.includes(part), `lint contracts the ${part} restyle`)
  }

  const switcher = fs.readFileSync(
    path.join(READER_ROOT, "components", "projection-switcher.tsx"),
    "utf8",
  )

  assert.match(switcher, /isMobile/, "switcher branches on the phone viewport")
  assert.match(switcher, /VaultSheet/, "drawer trigger opens the sheet on phones")
  assert.match(switcher, /DropdownMenu/, "desktop dropdown stays mounted")

  const chrome = fs.readFileSync(path.join(READER_ROOT, "components", "reader-chrome.tsx"), "utf8")

  assert.match(chrome, /aria-haspopup="dialog"/, "brand button announces the sheet")
  assert.match(chrome, /aria-expanded=\{vaultOpen\}/, "brand button tracks the sheet")
  assert.match(chrome, /<VaultSheet/, "header mounts its own sheet instance")
})

test("synthetic phone journey covers drawer, overflow, keyboard, and refresh", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const shared = await getSharedSyntheticBuild()
  const kb = shared.kb
  const journey = derivePhoneJourney(shared.contentDir, shared.metadata)
  const outDir = shared.outDir

  for (const rel of [
    "index.html",
    `${journey.folderRoute.replace(/^\//, "")}.html`,
    `${journey.leafRoute.replace(/^\//, "")}.html`,
  ]) {
    assert.ok(fs.existsSync(path.join(outDir, rel)), `static export emits ${rel}`)
  }

  const { server, baseUrl } = await serveOut(outDir)

  const built = {
    server,
    baseUrl,
    outDir,
    work: shared.work,
    contentDir: shared.contentDir,
    metadata: shared.metadata,
    journey,
  }

  const browser = await launchBrowser()

  const expect = {
    areas: built.journey.areas,
    folderTitle: built.journey.folderTitle,
    folderRoute: built.journey.folderRoute,
    leafTitle: built.journey.leafTitle,
    leafRoute: built.journey.leafRoute,
    areaRoutes: built.metadata.navigation.map((entry) => rootRoute(entry)),
    kinds: built.metadata.navigation.map((entry) =>
      entry.kind === "directory" ? "folder" : "note",
    ),
    projection: built.metadata.title,
  }

  try {
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "narrow phone")
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneCardsDetail(page, built.baseUrl, expect, "narrow phone")
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneNoteDetail(page, built.baseUrl, "narrow phone")
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneBreadcrumbsDetail(page, built.baseUrl, built.contentDir, "narrow phone")
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneDrawerSwitcher(
        page,
        built.baseUrl,
        { ...expect, destinations: SYNTHETIC_DESTINATIONS },
        "narrow phone",
      )
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneHeaderVaultSheet(
        page,
        built.baseUrl,
        { ...expect, destinations: SYNTHETIC_DESTINATIONS },
        "narrow phone",
      )
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runDerivedOverflowProbes(page, built.baseUrl, built.contentDir, "narrow phone", {
        checkWiki: true,
        requireImage: true,
      })
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runKeyboardChecks(page, built.baseUrl, "narrow phone")
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneSearchDialog(page, built.baseUrl, expect, "narrow phone")
    })
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneOfflinePlacement(page, built.baseUrl, "narrow phone")
    })
    await withPhonePage(browser, "large", async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "larger phone")
    })
    await withPhonePage(browser, "large", async (page) => {
      await runDerivedOverflowProbes(page, built.baseUrl, built.contentDir, "larger phone", {
        checkWiki: true,
        requireImage: true,
      })
      await goto(page, `${built.baseUrl}${expect.leafRoute}`)
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        expect.leafTitle,
        "larger phone: direct nested URL renders",
      )
      await page.reload({ waitUntil: "networkidle", timeout: 15000 })
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        expect.leafTitle,
        "larger phone: refresh keeps the nested note",
      )
      await assertNoPageOverflow(page, "larger phone refresh")
    })
    await withDesktopPage(browser, async (page) => {
      await runDesktopChecks(page, built.baseUrl, expect, "desktop")
    })
    await runOutputInspection(built.outDir, built.work, kb, UNSELECTED_SENTINEL)
  } finally {
    await browser.close()
    await closeServer(built.server)
  }
})

test("synthetic browse journey covers home → folder → nested note → Back", async () => {
  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const shared = await getSharedSyntheticBuild()
  const kb = shared.kb
  const work = shared.work
  const contentDir = shared.contentDir
  const metadata = shared.metadata
  const machineryBefore = shared.machineryBefore
  const journey = deriveJourney(contentDir, metadata)
  const outDir = shared.outDir

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
  const orchardEntry = metadata.navigation.find((entry) => entry.path === "orchard")
  const orchardTitle = orchardEntry ? expectedRootTitle(orchardEntry, contentDir) : "Orchard"
  const orchardChildren = expectedFolderChildren(contentDir, "orchard")

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
    await runTreePagination(treePage, baseUrl, {
      paginationRoute: "/orchard",
      paginationTitle: orchardTitle,
      paginationChildren: orchardChildren,
      deepRoute: journey.leafRoute,
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
    await runMetaLineBrowser(page, baseUrl)
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

test("generic real phone journey covers drawer open/close and home to note", async (t) => {
  const kbRoot = process.env.KNOWLEDGE_BASE_ROOT

  if (!kbRoot || !fs.existsSync(path.resolve(kbRoot))) {
    t.skip("KNOWLEDGE_BASE_ROOT is not set to a vault checkout; skipping real-corpus phone journey")

    return
  }

  assert.ok(
    fs.existsSync(path.join(READER_ROOT, "node_modules", "next")),
    "reader dependencies must be installed (run `npm ci` in reader/)",
  )
  const built = await buildAndServe(path.resolve(kbRoot))
  const browser = await launchBrowser()

  const expect = {
    areas: built.journey.areas,
    folderTitle: built.journey.folderTitle,
    folderRoute: built.journey.folderRoute,
    leafTitle: built.journey.leafTitle,
    leafRoute: built.journey.leafRoute,
    projection: built.metadata.title,
  }

  try {
    await withPhonePage(browser, "narrow", async (page) => {
      await runPhoneJourney(page, built.baseUrl, expect, "real narrow phone")
    })
    await withPhonePage(browser, "large", async (page) => {
      await runDerivedOverflowProbes(page, built.baseUrl, built.contentDir, "real larger phone", {
        requireImage: false,
      })
      await goto(page, `${built.baseUrl}${expect.leafRoute}`)
      await page.reload({ waitUntil: "networkidle", timeout: 15000 })
      assert.equal(
        await page.evaluate(() => document.querySelector("article h1")?.textContent?.trim()),
        expect.leafTitle,
        "real larger phone: refresh keeps the nested note",
      )
    })
    await withDesktopPage(browser, async (page) => {
      await runDesktopChecks(page, built.baseUrl, expect, "real desktop")
    })
    await runOutputInspection(built.outDir, built.work, path.resolve(kbRoot), null)
  } finally {
    await browser.close()
    await closeServer(built.server)
  }
})
