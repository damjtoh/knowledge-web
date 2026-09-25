import { docTitle } from "./title"

export interface PageLike {
  slugs: string[]
  url: string
  data: unknown
  /** Virtualized source path (e.g. `mix/folder/index.md`); folder identity needs it. */
  path?: string
}

export interface PublishedRoot {
  path: string
  kind: "directory" | "markdown"
}

export interface NavigationNode {
  slugs: string[]
  url: string
  title: string
  page?: PageLike
  children: NavigationNode[]
  /** True for folders (virtual, indexed, directory roots, or parents); false for direct notes. */
  isFolder: boolean
}

export interface Crumb {
  title: string
  url?: string
  isCurrent: boolean
}

export interface ReaderNavigation {
  roots: NavigationNode[]
  find(slugs: string[]): NavigationNode | undefined
  breadcrumbs(slugs: string[]): Crumb[]
}

export function humanizeSegment(seg: string): string {
  const spaced = seg.replace(/[-_]+/g, " ").trim()

  if (spaced === "") return seg

  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function slugKey(slugs: string[]): string {
  return slugs.join("/")
}

function normalizeRootPath(raw: string): string {
  let rel = String(raw ?? "").trim()

  while (rel.startsWith("./")) rel = rel.slice(2)
  rel = rel.replace(/\/+/g, "/").replace(/\/+$/, "")

  return rel
}

function slugsForRoot(root: PublishedRoot): string[] {
  const rel = normalizeRootPath(root.path)

  if (rel === "" || rel === ".") return []

  if (root.kind === "markdown") {
    const withoutExt = rel.replace(/\.mdx?$/i, "")

    // A bare index file is the home route.
    if (/^index$/i.test(withoutExt)) return []
    const parts = withoutExt.split("/").filter((s) => s !== "")

    // A nested index file owns its folder route.
    if (parts.length > 0 && /^index$/i.test(parts[parts.length - 1])) parts.pop()

    return parts
  }

  return rel.split("/").filter((s) => s !== "")
}

function isPrefix(prefix: string[], full: string[]): boolean {
  if (prefix.length === 0) return full.length === 0

  if (prefix.length > full.length) return false

  return prefix.every((seg, i) => full[i] === seg)
}

function isUnderRoots(slugs: string[], rootSlugs: string[][]): boolean {
  return rootSlugs.some((root) => isPrefix(root, slugs))
}

function compareNodes(a: NavigationNode, b: NavigationNode): number {
  const byTitle = a.title.localeCompare(b.title)

  if (byTitle !== 0) return byTitle
  const ka = slugKey(a.slugs)
  const kb = slugKey(b.slugs)

  return ka < kb ? -1 : ka > kb ? 1 : 0
}

function titleFor(slugs: string[], page: PageLike | undefined): string {
  if (page) return docTitle(page.data, slugs)

  if (slugs.length === 0) return "Home"

  return humanizeSegment(slugs[slugs.length - 1])
}

function urlFor(slugs: string[], page: PageLike | undefined): string {
  if (page) return page.url

  if (slugs.length === 0) return "/"

  return `/${slugs.join("/")}`
}

function isIndexPath(path: unknown): boolean {
  if (typeof path !== "string") return false
  const base = path.replace(/\\/g, "/").split("/").pop() ?? ""

  return /^index\.mdx?$/i.test(base)
}

/**
 * One deep navigation tree for the generic reader.
 *
 * Roots follow generated metadata order. Every folder with Markdown
 * descendants becomes a node: an authored index owns its route, otherwise
 * the folder is virtual with a humanized title. A file route and the same
 * folder route merge into one node. Children sort by authored title, then
 * stable route. Pages outside configured roots never enter the tree.
 */
export function buildReaderNavigation(
  pages: PageLike[],
  navigationRoots: PublishedRoot[],
): ReaderNavigation {
  const rootSlugs: string[][] = []
  const rootKinds: string[] = []
  const seenRoots = new Set<string>()

  for (const root of navigationRoots) {
    const slugs = slugsForRoot(root)
    const key = slugKey(slugs)

    if (seenRoots.has(key)) continue
    seenRoots.add(key)
    rootSlugs.push(slugs)
    rootKinds.push(root.kind)
  }

  const pagePath = (page: PageLike): string =>
    typeof page.path === "string" ? page.path.replace(/\\/g, "/") : ""

  const pageTitle = (page: PageLike): string => docTitle(page.data, page.slugs)

  const orderedPages = [...pages].sort((a, b) => {
    const ka = slugKey(a.slugs)
    const kb = slugKey(b.slugs)

    if (ka !== kb) return ka < kb ? -1 : 1
    // Deterministic ownership without serializing page data (which may hold
    // circular or BigInt values): an authored index wins its folder route,
    // then smallest source path, URL, and safely derived title decide.
    // Return 0 only when the navigation-visible ownership is equivalent.
    const ia = isIndexPath(a.path) ? 0 : 1
    const ib = isIndexPath(b.path) ? 0 : 1

    if (ia !== ib) return ia - ib
    const pa = pagePath(a)
    const pb = pagePath(b)

    if (pa !== pb) return pa < pb ? -1 : 1

    if (a.url !== b.url) return a.url < b.url ? -1 : 1
    const ta = pageTitle(a)
    const tb = pageTitle(b)

    if (ta !== tb) return ta < tb ? -1 : ta > tb ? 1 : 0

    return 0
  })

  const pageByKey = new Map<string, PageLike>()

  for (const page of orderedPages) {
    const key = slugKey(page.slugs)

    if (!pageByKey.has(key)) pageByKey.set(key, page)
  }

  const included = orderedPages.filter((page) => isUnderRoots(page.slugs, rootSlugs))

  // Folder identity survives route collapse: any included index source at a
  // route marks that route as a folder, even when no other descendants exist.
  // This keeps file-route plus same-route folder merges correct.
  const indexByKey = new Set<string>()

  for (const page of included) {
    if (isIndexPath(page.path)) indexByKey.add(slugKey(page.slugs))
  }

  const dirRootKeys = new Set<string>()
  rootSlugs.forEach((slugs, i) => {
    if (rootKinds[i] === "directory") dirRootKeys.add(slugKey(slugs))
  })

  const required = new Map<string, string[]>()

  for (const slugs of rootSlugs) required.set(slugKey(slugs), [...slugs])

  for (const page of included) {
    for (let len = page.slugs.length; len >= 0; len--) {
      if (page.slugs.length === 0 && len === 0) {
        if (rootSlugs.some((r) => r.length === 0)) required.set("", [])
        break
      }

      if (len === 0) break
      const prefix = page.slugs.slice(0, len)

      if (!isUnderRoots(prefix, rootSlugs)) continue
      const key = slugKey(prefix)

      if (!required.has(key)) required.set(key, prefix)
    }
  }

  const nodes = new Map<string, NavigationNode>()

  for (const [key, slugs] of [...required].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const page = pageByKey.get(key)
    // Only pages under configured roots own nodes; required keys are
    // under roots by construction, so any matching page is included.
    const owned = page && isUnderRoots(page.slugs, rootSlugs) ? page : undefined
    nodes.set(key, {
      slugs: [...slugs],
      url: urlFor(slugs, owned),
      title: titleFor(slugs, owned),
      page: owned,
      children: [],
      isFolder: indexByKey.has(key) || dirRootKeys.has(key),
    })
  }

  for (const [key, node] of nodes) {
    if (node.slugs.length === 0) continue

    for (let len = node.slugs.length - 1; len >= 1; len--) {
      const parentKey = node.slugs.slice(0, len).join("/")
      const parent = nodes.get(parentKey)

      if (parent) {
        parent.children.push(node)
        break
      }
    }
  }

  const sortRecursively = (node: NavigationNode): void => {
    node.children.sort(compareNodes)

    for (const child of node.children) sortRecursively(child)
  }

  const roots: NavigationNode[] = []

  for (const slugs of rootSlugs) {
    const node = nodes.get(slugKey(slugs))

    if (node) {
      sortRecursively(node)
      roots.push(node)
    }
  }

  // Children of every node are sorted; roots keep metadata order.
  // Nodes already sorted via their root ancestor, but sort orphans too.
  // Any parent is a folder, even an index-only folder with no other children.
  for (const node of nodes.values()) {
    if (node.children.length > 0) {
      node.isFolder = true
      node.children.sort(compareNodes)
    }
  }

  const find = (slugs: string[]): NavigationNode | undefined => nodes.get(slugKey(slugs))

  const breadcrumbs = (slugs: string[]): Crumb[] => {
    if (slugs.length === 0) return [{ title: "Home", url: "/", isCurrent: true }]
    const crumbs: Crumb[] = [{ title: "Home", url: "/", isCurrent: false }]
    slugs.forEach((_, i) => {
      const prefix = slugs.slice(0, i + 1)
      const isCurrent = i === slugs.length - 1
      const node = nodes.get(slugKey(prefix))

      if (node) {
        if (isCurrent) crumbs.push({ title: node.title, isCurrent })
        else crumbs.push({ title: node.title, url: node.url, isCurrent: false })
      } else {
        const title = humanizeSegment(prefix[prefix.length - 1])
        crumbs.push(isCurrent ? { title, isCurrent } : { title, isCurrent: false })
      }
    })

    return crumbs
  }

  return { roots, find, breadcrumbs }
}

/** Immediate leaf notes under a folder node, sorted with the tree. */
export function getDirectNotes(node: NavigationNode): NavigationNode[] {
  return node.children.filter((child) => !child.isFolder)
}

/** Immediate child folders under a folder node, sorted with the tree. */
export function getChildFolders(node: NavigationNode): NavigationNode[] {
  return node.children.filter((child) => child.isFolder)
}

function normalizePathname(value: string): string {
  if (!value || value === "/") return "/"

  return value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value
}

/**
 * Active published root for a pathname.
 *
 * Roots keep metadata order elsewhere; selection here prefers the exact
 * root when present, otherwise the longest matching root prefix. This keeps
 * nested configured roots (e.g. `notes` and `notes/projects`) correct: the
 * deeper root owns its route and its phone groups.
 */
export function findActiveRoot(
  roots: NavigationNode[],
  pathname: string,
): NavigationNode | undefined {
  const current = normalizePathname(pathname)
  let best: NavigationNode | undefined
  let bestLength = -1

  for (const root of roots) {
    const url = normalizePathname(root.url)

    if (url === "/") {
      if (current === "/" && 0 > bestLength) {
        best = root
        bestLength = 0
      }

      continue
    }

    const matches = current === url || current.startsWith(`${url}/`)

    if (!matches) continue

    if (url.length > bestLength) {
      best = root
      bestLength = url.length
    }
  }

  return best
}
