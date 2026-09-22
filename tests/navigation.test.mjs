/**
 * Step 3 generic navigation contract.
 *
 * Exercises the deep navigation module through its small interface only:
 * root order, virtual folders, authored indexes, merge, sorting, groups,
 * lookup, breadcrumbs, exclusion, and determinism. No vault or build needed.
 *
 * Run with: npm test -- tests/navigation.test.mjs tests/wiki-aliases.test.mjs
 */

import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildReaderNavigation,
  findActiveRoot,
  getDirectNotes,
  getChildFolders,
  humanizeSegment,
} from "../reader/lib/navigation.ts"
import * as navigationModule from "../reader/lib/navigation.ts"

function makePage(slugs, title, url, path) {
  return {
    slugs: [...slugs],
    url: url ?? (slugs.length === 0 ? "/" : `/${slugs.join("/")}`),
    data: title === undefined ? {} : { title },
    ...(path === undefined ? {} : { path }),
  }
}

function dirRoot(path) {
  return { path, kind: "directory" }
}

function fileRoot(path) {
  return { path, kind: "markdown" }
}

function snapshot(roots) {
  return roots.map((node) => ({
    slugs: node.slugs,
    url: node.url,
    title: node.title,
    hasPage: node.page !== undefined,
    isFolder: node.isFolder,
    children: snapshot(node.children),
  }))
}

function collectSlugs(roots) {
  const out = []
  const walk = (node) => {
    out.push(node.slugs.join("/"))
    for (const child of node.children) walk(child)
  }
  for (const root of roots) walk(root)
  return out.sort()
}

test("roots follow navigation metadata order and expose the small interface", () => {
  const pages = [
    makePage(["alpha"], "Alpha"),
    makePage(["beta"], "Beta"),
    makePage(["gamma"], "Gamma"),
  ]
  const roots = [dirRoot("gamma"), dirRoot("alpha"), dirRoot("beta")]
  const nav = buildReaderNavigation(pages, roots)
  assert.deepEqual(
    nav.roots.map((r) => r.slugs),
    [["gamma"], ["alpha"], ["beta"]],
  )
  assert.equal(typeof nav.find, "function")
  assert.equal(typeof nav.breadcrumbs, "function")
  assert.ok(Array.isArray(nav.roots))
  for (const root of nav.roots) {
    assert.ok(Array.isArray(root.slugs))
    assert.equal(typeof root.url, "string")
    assert.equal(typeof root.title, "string")
    assert.ok(Array.isArray(root.children))
  }
})

test("authored files and directory indexes provide titles", () => {
  const pages = [
    makePage(["about"], "About This Garden"),
    makePage(["projects"], "My Projects"),
    makePage(["projects", "alpha"], "Alpha Project"),
  ]
  const nav = buildReaderNavigation(pages, [fileRoot("about.md"), dirRoot("projects")])
  const about = nav.find(["about"])
  assert.ok(about)
  assert.equal(about.title, "About This Garden")
  assert.ok(about.page)
  assert.equal(about.url, "/about")
  const projects = nav.find(["projects"])
  assert.ok(projects)
  assert.equal(projects.title, "My Projects")
  assert.ok(projects.page)
  const alpha = nav.find(["projects", "alpha"])
  assert.ok(alpha)
  assert.equal(alpha.title, "Alpha Project")
})

test("virtual folders use humanized titles and have no page", () => {
  assert.equal(humanizeSegment("life-planning"), "Life planning")
  assert.equal(humanizeSegment("my_notes"), "My notes")
  const pages = [makePage(["notes", "alpha"], "Alpha"), makePage(["notes", "beta"], "Beta")]
  const nav = buildReaderNavigation(pages, [dirRoot("notes")])
  const root = nav.find(["notes"])
  assert.ok(root)
  assert.equal(root.title, "Notes")
  assert.equal(root.page, undefined)
  assert.equal(root.url, "/notes")
})

test("every folder with Markdown descendants exists, including nested virtual folders", () => {
  const pages = [makePage(["a", "b", "c", "leaf"], "Leaf")]
  const nav = buildReaderNavigation(pages, [dirRoot("a")])
  for (const slugs of [["a"], ["a", "b"], ["a", "b", "c"], ["a", "b", "c", "leaf"]]) {
    const node = nav.find(slugs)
    assert.ok(node, `missing ${slugs.join("/")}`)
  }
  assert.equal(nav.find(["a"]).page, undefined)
  assert.equal(nav.find(["a", "b"]).title, "B")
  assert.equal(nav.find(["a", "b", "c", "leaf"]).title, "Leaf")
  assert.ok(nav.find(["a", "b", "c", "leaf"]).page)
})

test("flat directories list every note as direct notes", () => {
  const pages = [
    makePage(["garden", "e"], "Echo"),
    makePage(["garden", "a"], "Alpha"),
    makePage(["garden", "c"], "Charlie"),
    makePage(["garden", "b"], "Bravo"),
    makePage(["garden", "d"], "Delta"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("garden")])
  const root = nav.find(["garden"])
  assert.ok(root)
  assert.deepEqual(
    root.children.map((c) => c.title),
    ["Alpha", "Bravo", "Charlie", "Delta", "Echo"],
  )
  assert.deepEqual(
    getDirectNotes(root).map((c) => c.title),
    ["Alpha", "Bravo", "Charlie", "Delta", "Echo"],
  )
  assert.deepEqual(getChildFolders(root), [])
})

test("nested folders mix authored indexes and virtual folders", () => {
  const pages = [
    makePage(["work"], "Work Index"),
    makePage(["work", "project"], "Project Index"),
    makePage(["work", "project", "alpha"], "Alpha"),
    makePage(["work", "notes", "plain"], "Plain"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("work")])
  const work = nav.find(["work"])
  assert.ok(work?.page)
  assert.equal(work.title, "Work Index")
  const project = nav.find(["work", "project"])
  assert.ok(project?.page)
  assert.equal(project.title, "Project Index")
  const notes = nav.find(["work", "notes"])
  assert.ok(notes)
  assert.equal(notes.page, undefined)
  assert.equal(notes.title, "Notes")
  const plain = nav.find(["work", "notes", "plain"])
  assert.ok(plain?.page)
})

test("a file route and same-route folder merge into one node", () => {
  const pages = [
    makePage(["inbox"], "Household Inbox"),
    makePage(["inbox", "todo"], "Todo"),
    makePage(["inbox", "done"], "Done"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("inbox")])
  const inbox = nav.find(["inbox"])
  assert.ok(inbox)
  assert.ok(inbox.page, "merged node keeps its file page")
  assert.equal(inbox.title, "Household Inbox")
  assert.equal(inbox.children.length, 2)
  assert.deepEqual(
    inbox.children.map((c) => c.title),
    ["Done", "Todo"],
  )
  const viaFileRoot = buildReaderNavigation(pages, [fileRoot("inbox.md")])
  const merged = viaFileRoot.find(["inbox"])
  assert.ok(merged?.page)
  assert.equal(merged.children.length, 2)
})

test("children sort by authored title then stable route", () => {
  const pages = [
    makePage(["x", "z"], "Zebra"),
    makePage(["x", "m"], "Mango"),
    makePage(["x", "a"], "Apple"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("x")])
  assert.deepEqual(
    nav.find(["x"]).children.map((c) => c.title),
    ["Apple", "Mango", "Zebra"],
  )
  const tied = [makePage(["y", "b"], "Same"), makePage(["y", "a"], "Same")]
  const tiedNav = buildReaderNavigation(tied, [dirRoot("y")])
  assert.deepEqual(
    tiedNav.find(["y"]).children.map((c) => c.slugs),
    [
      ["y", "a"],
      ["y", "b"],
    ],
  )
})

test("direct notes and child folders are generically identifiable without travel rules", () => {
  const pages = [
    makePage(["mix"], "Mix"),
    makePage(["mix", "note"], "A Note"),
    makePage(["mix", "folder", "leaf"], "Leaf"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("mix")])
  const root = nav.find(["mix"])
  assert.ok(root)
  const notes = getDirectNotes(root)
  const folders = getChildFolders(root)
  assert.deepEqual(
    notes.map((n) => n.slugs),
    [["mix", "note"]],
  )
  assert.deepEqual(
    folders.map((n) => n.slugs),
    [["mix", "folder"]],
  )
  assert.ok(!("SHARED" + "_" + "AREA_SLUGS" in navigationModule))
  assert.ok(!("getTravel" + "Groups" in navigationModule))
  assert.ok(!JSON.stringify(snapshot(nav.roots)).toLowerCase().includes("travel"))
})

test("output is stable independent of page input order and deterministic", () => {
  const ordered = [
    makePage(["s", "b"], "Beta"),
    makePage(["s", "a"], "Alpha"),
    makePage(["s"], "S Index"),
    makePage(["t"], "Tee"),
  ]
  const shuffled = [ordered[1], ordered[3], ordered[0], ordered[2]]
  const roots = [dirRoot("s"), fileRoot("t.md")]
  const first = buildReaderNavigation(ordered, roots)
  const second = buildReaderNavigation(shuffled, roots)
  assert.deepEqual(snapshot(first.roots), snapshot(second.roots))
  assert.deepEqual(snapshot(buildReaderNavigation(ordered, roots).roots), snapshot(first.roots))
  assert.deepEqual(
    first.roots.map((r) => r.slugs),
    [["s"], ["t"]],
  )
})

test("pages outside configured roots are excluded", () => {
  const pages = [
    makePage(["notes", "keep"], "Keep"),
    makePage(["secret", "hidden"], "Hidden"),
    makePage(["notes"], "Notes Index"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("notes")])
  assert.equal(nav.roots.length, 1)
  assert.ok(nav.find(["notes", "keep"]))
  assert.equal(nav.find(["secret", "hidden"]), undefined)
  assert.equal(nav.find(["secret"]), undefined)
  assert.deepEqual(collectSlugs(nav.roots), ["notes", "notes/keep"])
})

test("lookup and breadcrumbs cover pages, virtual folders, nested routes, and missing routes", () => {
  const pages = [
    makePage(["notes"], "Notes Index"),
    makePage(["notes", "guide"], "Guide Title"),
    makePage(["projects", "deep", "leaf"], "Leaf Title"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("notes"), dirRoot("projects")])
  assert.ok(nav.find(["notes"]))
  assert.ok(nav.find(["notes", "guide"]))
  const virtual = nav.find(["projects"])
  assert.ok(virtual)
  assert.equal(virtual.page, undefined)
  assert.equal(virtual.title, "Projects")
  const nestedVirtual = nav.find(["projects", "deep"])
  assert.ok(nestedVirtual)
  assert.equal(nestedVirtual.page, undefined)
  assert.ok(nav.find(["projects", "deep", "leaf"])?.page)
  assert.equal(nav.find(["missing"]), undefined)
  assert.equal(nav.find(["notes", "missing"]), undefined)

  assert.deepEqual(nav.breadcrumbs([]), [{ title: "Home", url: "/", isCurrent: true }])

  const rootCrumbs = nav.breadcrumbs(["notes"])
  assert.deepEqual(rootCrumbs, [
    { title: "Home", url: "/", isCurrent: false },
    { title: "Notes Index", isCurrent: true },
  ])

  const nestedCrumbs = nav.breadcrumbs(["notes", "guide"])
  assert.deepEqual(nestedCrumbs, [
    { title: "Home", url: "/", isCurrent: false },
    { title: "Notes Index", url: "/notes", isCurrent: false },
    { title: "Guide Title", isCurrent: true },
  ])

  const virtualCrumbs = nav.breadcrumbs(["projects", "deep", "leaf"])
  assert.deepEqual(virtualCrumbs, [
    { title: "Home", url: "/", isCurrent: false },
    { title: "Projects", url: "/projects", isCurrent: false },
    { title: "Deep", url: "/projects/deep", isCurrent: false },
    { title: "Leaf Title", isCurrent: true },
  ])

  const missingCrumbs = nav.breadcrumbs(["nope"])
  assert.deepEqual(missingCrumbs, [
    { title: "Home", url: "/", isCurrent: false },
    { title: "Nope", isCurrent: true },
  ])
})

test("active roots resolve and missing breadcrumbs stay humanized", () => {
  const pages = [makePage(["alpha", "one"], "One")]
  const nav = buildReaderNavigation(pages, [dirRoot("alpha"), dirRoot("beta")])
  const alpha = nav.find(["alpha"])
  assert.ok(alpha)
  assert.equal(alpha.title, "Alpha")
  const beta = nav.find(["beta"])
  assert.ok(beta, "root without pages still resolves as virtual folder")
  assert.equal(beta.title, "Beta")
  assert.equal(beta.page, undefined)
  assert.deepEqual(beta.children, [])
  const betaCrumbs = nav.breadcrumbs(["beta"])
  assert.deepEqual(betaCrumbs, [
    { title: "Home", url: "/", isCurrent: false },
    { title: "Beta", isCurrent: true },
  ])
})

test("an index-only child folder stays a child folder, not a direct note", () => {
  const pages = [
    makePage(["mix"], "Mix", undefined, "mix/index.md"),
    makePage(["mix", "note"], "A Note", undefined, "mix/note.md"),
    makePage(["mix", "folder"], "Folder Index", undefined, "mix/folder/index.md"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("mix")])
  const root = nav.find(["mix"])
  assert.ok(root)
  assert.ok(root.isFolder)
  const folder = nav.find(["mix", "folder"])
  assert.ok(folder?.page)
  assert.equal(folder.title, "Folder Index")
  assert.ok(folder.isFolder)
  assert.deepEqual(
    getChildFolders(root).map((n) => n.slugs),
    [["mix", "folder"]],
  )
  assert.deepEqual(
    getDirectNotes(root).map((n) => n.slugs),
    [["mix", "note"]],
  )
})

test("a collapsed file/index route keeps index ownership regardless of input order", () => {
  const leaf = makePage(["projects"], "File Title", "/projects", "projects.md")
  const index = makePage(["projects"], "Folder Index", "/projects", "projects/index.md")
  const child = makePage(["projects", "alpha"], "Alpha", undefined, "projects/alpha.md")
  const roots = [dirRoot("projects")]
  const forward = buildReaderNavigation([leaf, index, child], roots)
  const reversed = buildReaderNavigation([child, index, leaf], roots)
  for (const nav of [forward, reversed]) {
    const node = nav.find(["projects"])
    assert.ok(node?.page)
    assert.equal(node.title, "Folder Index")
    assert.equal(node.page.path, "projects/index.md")
    assert.ok(node.isFolder)
    assert.deepEqual(
      node.children.map((c) => c.slugs),
      [["projects", "alpha"]],
    )
  }
  assert.deepEqual(snapshot(forward.roots), snapshot(reversed.roots))
  assert.deepEqual(forward.breadcrumbs(["projects"]), reversed.breadcrumbs(["projects"]))
})

test("navigation never serializes page data, so circular and BigInt values do not throw", () => {
  const big = makePage(["dup"], "Same", "/dup", "dup.md")
  big.data = { title: "Same", n: 10n }
  const circularData = { title: "Same" }
  circularData.self = circularData
  const circular = makePage(["dup"], "Same", "/dup", "dup.md")
  circular.data = circularData
  const roots = [dirRoot("dup")]
  assert.doesNotThrow(() => buildReaderNavigation([big, circular], roots))
  const nav = buildReaderNavigation([circular, big], roots)
  assert.equal(nav.find(["dup"]).title, "Same")
})

test("nested roots select the exact root, otherwise the longest prefix, keeping order", () => {
  const pages = [
    makePage(["notes"], "Notes Index"),
    makePage(["notes", "projects"], "Projects Index"),
    makePage(["notes", "projects", "alpha"], "Alpha"),
    makePage(["notes", "plain"], "Plain"),
  ]
  const nav = buildReaderNavigation(pages, [dirRoot("notes"), dirRoot("notes/projects")])
  assert.deepEqual(
    nav.roots.map((r) => r.slugs),
    [["notes"], ["notes", "projects"]],
  )
  const exact = findActiveRoot(nav.roots, "/notes/projects")
  assert.ok(exact)
  assert.deepEqual(exact.slugs, ["notes", "projects"])
  const deep = findActiveRoot(nav.roots, "/notes/projects/alpha")
  assert.ok(deep)
  assert.deepEqual(deep.slugs, ["notes", "projects"])
  assert.deepEqual(
    getDirectNotes(deep).map((n) => n.slugs),
    [["notes", "projects", "alpha"]],
  )
  const broad = findActiveRoot(nav.roots, "/notes/plain")
  assert.ok(broad)
  assert.deepEqual(broad.slugs, ["notes"])
  const reversed = buildReaderNavigation(pages, [dirRoot("notes/projects"), dirRoot("notes")])
  assert.deepEqual(
    reversed.roots.map((r) => r.slugs),
    [["notes", "projects"], ["notes"]],
  )
  assert.deepEqual(findActiveRoot(reversed.roots, "/notes/projects")?.slugs, ["notes", "projects"])
  assert.deepEqual(findActiveRoot(nav.roots, "/missing"), undefined)
})
