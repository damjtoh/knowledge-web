/**
 * Knowledge Vault presentation plugin — Tolaria first-H1 title adaptation
 * plus type-derived virtual collections and collection pages.
 *
 * - If a note has no explicit `title` frontmatter, use the text of its first
 *   level-1 heading as the page title (frontmatter.title) so every downstream
 *   Quartz surface (article title, listings, breadcrumbs, previews, search
 *   index, metadata) sees the readable title.
 * - Remove that H1 from rendered content so the page shows a single primary
 *   title (the ArticleTitle component) instead of both.
 * - Generate stable human-readable virtual collection pages from `type`
 *   frontmatter. Membership comes only from type frontmatter, never paths or
 *   filenames. Each discovered nonempty normalized type gets a stable route
 *   `collections/<slug>`. Missing or empty types fall back to
 *   `collections/other`.
 * - Collection entries are sorted alphabetically by human titles with
 *   deterministic slug tie-breaking and show titles/descriptions.
 * - Provides an action-first Vault dashboard that combines prominent search,
 *   Open Tasks, active Ideas, recent content, and collection links derived
 *   from the same authoritative collection helpers.
 */

import { h } from "preact"
import { resolveRelative } from "@quartz-community/utils"

function getRawFrontmatterTitle(raw) {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith("---")) return null
  const end = trimmed.indexOf("\n---", 3)
  if (end === -1) return null
  const fmBlock = trimmed.slice(3, end)
  const lines = fmBlock.split("\n")
  for (const line of lines) {
    const m = line.match(/^\s*title\s*:\s*(.*)\s*$/)
    if (m) {
      let val = (m[1] ?? "").trim()
      if (val === "" || val === "null" || val === "~") return null
      if (
        (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
      ) {
        val = val.slice(1, -1)
      }
      if (val.trim() === "") return null
      return val.trim()
    }
  }
  return null
}

function mdastToString(node) {
  if (!node) return ""
  if (node.type === "text") return node.value ?? ""
  if (node.type === "inlineCode") return node.value ?? ""
  if (node.type === "break") return " "
  if (Array.isArray(node.children)) {
    return node.children.map(mdastToString).join("")
  }
  return ""
}

function findFirstH1(tree) {
  if (!tree || !Array.isArray(tree.children)) return null
  for (let i = 0; i < tree.children.length; i++) {
    const n = tree.children[i]
    if (n && n.type === "heading" && n.depth === 1) {
      const text = mdastToString(n).trim().replace(/\s+/g, " ")
      if (text.length > 0) return { index: i, text }
      return null
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Type normalization and collection helpers
// ---------------------------------------------------------------------------

export const FALLBACK_SLUG = "other"
export const FALLBACK_LABEL = "Other"
export const COLLECTIONS_PREFIX = "collections/"
export const DASHBOARD_SLUG = "dashboard"

export function normalizeType(raw) {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed
}

export function slugForType(normalized) {
  // normalized is assumed trimmed non-empty string
  return (
    normalized
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/_/g, "-")
      .replace(/&/g, "-and-")
      .replace(/%/g, "-percent")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || FALLBACK_SLUG
  )
}

export function labelForType(normalized, slug) {
  const pluralMap = {
    task: "Tasks",
    idea: "Ideas",
    note: "Notes",
    bookmark: "Bookmarks",
  }
  if (slug && pluralMap[slug]) return pluralMap[slug]
  // Derive readable label from normalized, preserving original casing and acronyms
  return normalized
    .trim()
    .split(/[\s_]+/)
    .map((word) => {
      if (word.length === 0) return word
      if (word.toUpperCase() === word && word.length > 1) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(" ")
}

export function compareByTitleThenSlug(a, b) {
  const aTitle = (a.frontmatter?.title ?? a.slug ?? "").toLowerCase()
  const bTitle = (b.frontmatter?.title ?? b.slug ?? "").toLowerCase()
  const cmp = aTitle.localeCompare(bTitle)
  if (cmp !== 0) return cmp
  return (a.slug ?? "").localeCompare(b.slug ?? "")
}

// ---------------------------------------------------------------------------
// Dashboard status/date helpers
// ---------------------------------------------------------------------------

export function normalizeStatus(raw) {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed
}

export function isOpenTask(file) {
  if (!file || !file.frontmatter) return false
  const type = normalizeType(file.frontmatter.type)
  if (!type) return false
  if (type.toLowerCase() !== "task") return false
  const status = normalizeStatus(file.frontmatter.status)
  if (!status) return false
  return status.toLowerCase() === "open"
}

export function isActiveIdea(file) {
  if (!file || !file.frontmatter) return false
  const type = normalizeType(file.frontmatter.type)
  if (!type) return false
  if (type.toLowerCase() !== "idea") return false
  const status = normalizeStatus(file.frontmatter.status)
  if (!status) return false
  const lower = status.toLowerCase()
  return lower === "seed" || lower === "exploring"
}

export function parseDashboardDate(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    const t = value.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof value === "number") {
    const d = new Date(value)
    const t = d.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed.length === 0) return null
    const t = Date.parse(trimmed)
    return Number.isNaN(t) ? null : t
  }
  return null
}

export function getRecencyTime(file) {
  if (!file || !file.frontmatter) return null
  const fm = file.frontmatter
  const updated = parseDashboardDate(fm.updated_at)
  if (updated !== null) return updated
  const created = parseDashboardDate(fm.created_at)
  if (created !== null) return created
  return null
}

export function compareByRecencyThenTitle(a, b) {
  const at = getRecencyTime(a)
  const bt = getRecencyTime(b)
  if (at !== null && bt !== null) {
    if (bt !== at) return bt - at
    return compareByTitleThenSlug(a, b)
  }
  if (at !== null && bt === null) return -1
  if (at === null && bt !== null) return 1
  return compareByTitleThenSlug(a, b)
}

export function isPublishableForDashboard(file) {
  if (!file || typeof file.slug !== "string") return false
  if (file.unlisted === true || file.frontmatter?.unlisted === true) return false
  if (file.collection !== undefined) return false
  if (file.isVirtualPage || file._isVirtualPage || file._virtualPage) return false
  const isTagVirtualMarker = file.tag !== undefined || file._isTagPage
  if (isTagVirtualMarker) return false
  if (file.frontmatter?.synthetic === true) return false
  const slug = file.slug
  if (slug === "index" || slug.endsWith("/index")) {
    const hasFilePath = typeof file.filePath === "string" && file.filePath.length > 0
    const isVirtualIndex =
      file.isVirtualPage ||
      file._isVirtualPage ||
      file._virtualPage ||
      file.collection !== undefined ||
      isTagVirtualMarker
    if (isVirtualIndex || !hasFilePath) return false
  }
  if (file.slug === DASHBOARD_SLUG || file.slug === `${DASHBOARD_SLUG}/index`) {
    // authored dashboard file itself remains publishable as content, but we still
    // treat it as publishable for dashboard data (it is a file). The virtual dashboard
    // slug collision handling is separate. For filtering dashboard data, include it.
  }
  return true
}

export function getDashboardSlug(allFiles) {
  const authored = new Set()
  for (const file of allFiles) {
    if (!file || typeof file.slug !== "string") continue
    if (file.unlisted === true || file.frontmatter?.unlisted === true) continue
    if (file.isVirtualPage || file._isVirtualPage || file._virtualPage) continue
    const isTagVirtualMarker = file.tag !== undefined || file._isTagPage
    if (isTagVirtualMarker) continue
    if (file.collection !== undefined) continue
    if (file.frontmatter?.synthetic === true) continue
    const slug = file.slug
    if (slug === DASHBOARD_SLUG || slug === `${DASHBOARD_SLUG}/index`) {
      authored.add(DASHBOARD_SLUG)
    } else if (slug.startsWith(`${DASHBOARD_SLUG}-`)) {
      const rest = slug.slice(`${DASHBOARD_SLUG}-`.length)
      const m = rest.match(/^(\d+)(\/index)?$/)
      if (m) {
        authored.add(`${DASHBOARD_SLUG}-${m[1]}`)
      }
      // authored file under dashboard-N subpath (e.g., dashboard-2/notes) does not block dashboard-N root, ignore
    }
    if (slug.startsWith(`${DASHBOARD_SLUG}/`) && slug !== `${DASHBOARD_SLUG}/index`) {
      // any authored file under dashboard prefix does not block dashboard root, ignore
    }
  }
  let candidate = DASHBOARD_SLUG
  let counter = 2
  while (authored.has(candidate)) {
    candidate = `${DASHBOARD_SLUG}-${counter}`
    counter++
  }
  return candidate
}

/**
 * Build collections from a list of QuartzPluginData entries.
 * Filters out virtual collection/tag pages via metadata, not filename alone.
 * Reserving the fallback slug and handling slug collisions ensures one-to-one
 * stable routes. Returns sorted collections with sorted items.
 */
export function buildCollectionsFromFiles(allFiles) {
  const map = new Map()
  const usedSlugs = new Set([FALLBACK_SLUG])
  const fallback = { slug: FALLBACK_SLUG, label: FALLBACK_LABEL, items: [] }

  const authoredCollectionSuffixes = new Set()
  for (const file of allFiles) {
    if (!file || typeof file.slug !== "string") continue
    if (file.unlisted === true || file.frontmatter?.unlisted === true) continue
    if (file.collection !== undefined) continue
    if (file.isVirtualPage || file._isVirtualPage || file._virtualPage) continue
    const isTagVirtualMarker = file.tag !== undefined || file._isTagPage
    if (isTagVirtualMarker) continue
    if (file.frontmatter?.synthetic === true) continue
    if (file.slug.startsWith(COLLECTIONS_PREFIX)) {
      const suffix = file.slug.slice(COLLECTIONS_PREFIX.length)
      if (suffix.length > 0) authoredCollectionSuffixes.add(suffix)
    }
  }

  const keyToGroup = new Map()
  for (const file of allFiles) {
    if (!file || typeof file.slug !== "string") continue
    const slug = file.slug
    if (file.unlisted === true || file.frontmatter?.unlisted === true) continue
    if (file.frontmatter?.synthetic === true) continue
    if (file.collection !== undefined) continue
    if (file.isVirtualPage || file._isVirtualPage || file._virtualPage) continue
    const isTagVirtualMarker = file.tag !== undefined || file._isTagPage
    if (isTagVirtualMarker) continue
    if (slug === "index" || slug.endsWith("/index")) {
      const hasFilePath = typeof file.filePath === "string" && file.filePath.length > 0
      const isVirtualIndex =
        file.isVirtualPage ||
        file._isVirtualPage ||
        file._virtualPage ||
        file.collection !== undefined ||
        isTagVirtualMarker
      if (isVirtualIndex || !hasFilePath) continue
    }

    const rawType = file.frontmatter?.type
    const normalized = normalizeType(rawType)
    if (!normalized) {
      fallback.items.push(file)
      continue
    }
    const key = normalized.toLowerCase()
    if (!keyToGroup.has(key)) {
      keyToGroup.set(key, { files: [], normalizedSet: new Set() })
    }
    const group = keyToGroup.get(key)
    group.files.push(file)
    group.normalizedSet.add(normalized)
  }

  // Deterministic slug allocation: sort distinct normalized keys before assigning
  // collisions, so route ownership does not depend on allFiles input order.
  const sortedKeys = [...keyToGroup.keys()].sort((a, b) => a.localeCompare(b))
  const normalizedToSlug = new Map()
  const keyToBase = new Map()
  const keyToLabel = new Map()
  for (const key of sortedKeys) {
    const group = keyToGroup.get(key)
    const variants = [...group.normalizedSet].sort((a, b) => a.localeCompare(b))
    const representative = variants[0]
    const base = slugForType(representative)
    keyToBase.set(key, base)
    let candidate = base
    if (usedSlugs.has(candidate) || authoredCollectionSuffixes.has(candidate)) {
      let counter = 2
      while (
        usedSlugs.has(`${base}-${counter}`) ||
        authoredCollectionSuffixes.has(`${base}-${counter}`)
      )
        counter++
      candidate = `${base}-${counter}`
    }
    normalizedToSlug.set(key, candidate)
    usedSlugs.add(candidate)
    const label = labelForType(representative, base)
    keyToLabel.set(key, label)
  }

  for (const key of sortedKeys) {
    const typeSlug = normalizedToSlug.get(key)
    const label = keyToLabel.get(key)
    const group = keyToGroup.get(key)
    map.set(typeSlug, { slug: typeSlug, label, items: [...group.files] })
  }

  const collections = [...map.values()].filter((c) => c.items.length > 0)
  collections.sort((a, b) => a.label.localeCompare(b.label))
  for (const col of collections) {
    col.items.sort(compareByTitleThenSlug)
  }
  if (fallback.items.length > 0) {
    if (authoredCollectionSuffixes.has(fallback.slug)) {
      const base = FALLBACK_SLUG
      let counter = 2
      let candidate = `${base}-${counter}`
      while (usedSlugs.has(candidate) || authoredCollectionSuffixes.has(candidate)) {
        counter++
        candidate = `${base}-${counter}`
      }
      fallback.slug = candidate
      usedSlugs.add(candidate)
    }
    fallback.items.sort(compareByTitleThenSlug)
    collections.push(fallback)
    collections.sort((a, b) => a.label.localeCompare(b.label))
  }
  return collections
}

// ---------------------------------------------------------------------------
// Collection page body component (used as pageType body)
// ---------------------------------------------------------------------------

function CollectionContentComponent(props) {
  const { fileData, allFiles } = props
  let collection = fileData.collection
  // Fallback: derive from slug if collection not stored (e.g., direct navigation)
  if (!collection) {
    const slug = (fileData.slug ?? "").replace(/^collections\//, "")
    const title = fileData.frontmatter?.title ?? slug
    // Try to find matching collection via buildCollectionsFromFiles
    const allCollections = buildCollectionsFromFiles(allFiles ?? [])
    collection = allCollections.find((c) => c.slug === slug) ?? {
      slug,
      label: title,
      items: [],
    }
  }

  const items = collection.items ?? []
  const label = collection.label ?? fileData.frontmatter?.title ?? collection.slug

  return h(
    "div",
    { class: "kv-collection" },
    h("h1", null, label),
    h(
      "p",
      { class: "kv-collection-count" },
      `${items.length} item${items.length !== 1 ? "s" : ""}`,
    ),
    items.length === 0
      ? h("p", null, "No items in this collection.")
      : h(
          "ul",
          { class: "kv-collection-list" },
          items.map((page) => {
            const title = page.frontmatter?.title ?? page.slug ?? "Untitled"
            const href = resolveRelative(fileData.slug, page.slug)
            const desc =
              typeof page.description === "string" && page.description.trim().length > 0
                ? page.description
                : typeof page.frontmatter?.description === "string"
                  ? page.frontmatter.description
                  : ""
            return h(
              "li",
              { class: "kv-collection-entry", key: page.slug },
              h(
                "div",
                { class: "kv-collection-entry-main" },
                h("a", { href, class: "internal" }, title),
                desc ? h("p", { class: "kv-collection-desc" }, desc) : null,
              ),
            )
          }),
        ),
  )
}

CollectionContentComponent.css = `
.kv-collection {
  max-width: 100%;
  overflow-wrap: break-word;
}
.kv-collection-count {
  color: var(--darkgray);
  margin-top: 0.25rem;
}
.kv-collection-list {
  list-style: none;
  padding: 0;
  margin: 1rem 0;
}
.kv-collection-entry {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--lightgray);
}
.kv-collection-entry:last-child {
  border-bottom: none;
}
.kv-collection-entry a {
  font-weight: 600;
  color: var(--secondary);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.kv-collection-entry a:hover {
  text-decoration: underline;
}
.kv-collection-desc {
  margin: 0.25rem 0 0;
  color: var(--darkgray);
  font-size: 0.9rem;
  line-height: 1.4;
  overflow-wrap: break-word;
}
.kv-collection-desc:empty {
  display: none;
}
`

const CollectionContent = () => CollectionContentComponent

// ---------------------------------------------------------------------------
// Collection navigation component (registered via components manifest)
// ---------------------------------------------------------------------------

function CollectionNavComponent(props) {
  const { fileData, allFiles } = props
  const collections = buildCollectionsFromFiles(allFiles ?? [])
  if (collections.length === 0) return null

  // For navigation, sort alphabetically by label including fallback
  const sorted = [...collections].sort((a, b) => a.label.localeCompare(b.label))

  return h(
    "nav",
    { class: "kv-collections-nav", "aria-label": "Collections" },
    h("h2", { class: "kv-collections-nav-title" }, "Collections"),
    h(
      "ul",
      null,
      sorted.map((col) => {
        const href = resolveRelative(fileData.slug ?? "index", `${COLLECTIONS_PREFIX}${col.slug}`)
        const isActive = (fileData.slug ?? "") === `${COLLECTIONS_PREFIX}${col.slug}`
        return h(
          "li",
          { key: col.slug },
          h(
            "a",
            {
              href,
              class: isActive ? "active internal" : "internal",
              "aria-current": isActive ? "page" : undefined,
            },
            `${col.label} (${col.items.length})`,
          ),
        )
      }),
    ),
  )
}

CollectionNavComponent.css = `
.kv-collections-nav {
  width: 100%;
  max-width: 100%;
  overflow-x: hidden;
  overflow-wrap: break-word;
  box-sizing: border-box;
}
.kv-collections-nav-title {
  font-size: 1rem;
  margin: 0 0 0.5rem;
  overflow-wrap: break-word;
}
.kv-collections-nav ul {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  list-style: none;
  padding: 0;
  margin: 0;
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
}
.kv-collections-nav li {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  display: flex;
  box-sizing: border-box;
}
.kv-collections-nav a {
  display: block;
  min-width: 0;
  max-width: 100%;
  padding: 0.35rem 0.6rem;
  border-radius: 0.375rem;
  background: var(--lightgray);
  color: var(--dark);
  text-decoration: none;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  overflow-wrap: anywhere;
  word-break: break-word;
  box-sizing: border-box;
}
.kv-collections-nav a:hover {
  background: var(--gray);
  color: var(--light);
}
.kv-collections-nav a.active {
  background: var(--secondary);
  color: var(--light);
}
@media (max-width: 600px) {
  .kv-collections-nav ul {
    gap: 0.4rem;
  }
  .kv-collections-nav a {
    padding: 0.3rem 0.5rem;
    font-size: 0.85rem;
  }
}
`

export const CollectionNav = () => CollectionNavComponent

// ---------------------------------------------------------------------------
// Vault dashboard page body component
// ---------------------------------------------------------------------------

function formatDashboardDate(time) {
  if (time === null || time === undefined) return null
  try {
    const d = new Date(time)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    })
  } catch {
    return null
  }
}

function DashboardCard(file, baseSlug) {
  const title = file.frontmatter?.title ?? file.slug ?? "Untitled"
  const href = resolveRelative(baseSlug, file.slug)
  const rawDesc =
    typeof file.description === "string" && file.description.trim().length > 0
      ? file.description.trim()
      : typeof file.frontmatter?.description === "string"
        ? file.frontmatter.description.trim()
        : ""
  const desc = rawDesc.length > 0 ? rawDesc : null
  const type = typeof file.frontmatter?.type === "string" ? file.frontmatter.type.trim() : ""
  const status = typeof file.frontmatter?.status === "string" ? file.frontmatter.status.trim() : ""
  const time = getRecencyTime(file)
  const dateLabel = time !== null ? formatDashboardDate(time) : null
  const iso = time !== null ? new Date(time).toISOString() : null
  // Only expose allowed metadata: title, desc, type, status, date. No IDs or arbitrary frontmatter.
  return h(
    "li",
    { class: "kv-dashboard-card", key: file.slug },
    h(
      "article",
      { class: "kv-dashboard-card-inner" },
      h("h3", { class: "kv-dashboard-card-title" }, h("a", { href, class: "internal" }, title)),
      desc ? h("p", { class: "kv-dashboard-card-desc" }, desc) : null,
      h(
        "div",
        { class: "kv-dashboard-card-meta" },
        type ? h("span", { class: "kv-dashboard-card-type" }, type) : null,
        status ? h("span", { class: "kv-dashboard-card-status" }, status) : null,
        dateLabel && iso
          ? h("time", { datetime: iso, class: "kv-dashboard-card-date" }, dateLabel)
          : null,
      ),
    ),
  )
}

function DashboardContentComponent(props) {
  const { fileData, allFiles } = props
  const baseSlug = fileData.slug ?? DASHBOARD_SLUG
  const all = allFiles ?? []
  const publishable = all.filter(isPublishableForDashboard)
  const openTasks = publishable.filter(isOpenTask).sort(compareByRecencyThenTitle)
  const activeIdeas = publishable.filter(isActiveIdea).sort(compareByRecencyThenTitle)
  const recent = [...publishable].sort(compareByRecencyThenTitle).slice(0, 12)
  const collections = buildCollectionsFromFiles(all)

  const hasOpen = openTasks.length > 0
  const hasIdeas = activeIdeas.length > 0
  const hasRecent = recent.length > 0
  const hasCollections = collections.length > 0

  // Collection links for dashboard secondary retrieval
  const sortedCollections = [...collections].sort((a, b) => a.label.localeCompare(b.label))

  return h(
    "main",
    { class: "kv-dashboard", id: "vault-dashboard" },
    h(
      "header",
      { class: "kv-dashboard-header" },
      h("h1", null, "Vault Dashboard"),
      h(
        "p",
        { class: "kv-dashboard-intro" },
        "Action-first overview of your vault — search, open work, ideas, and recent content.",
      ),
    ),
    // Prominent search - compatible Quartz Search DOM for full-text, tag filters, title boost, folder context, SPA reattachment
    h(
      "section",
      {
        class: "kv-dashboard-search",
        "aria-labelledby": "kv-search-heading",
        role: "search",
        "aria-label": "Vault search",
      },
      h("h2", { id: "kv-search-heading" }, "Search"),
      h(
        "div",
        { class: "search" },
        h(
          "button",
          {
            class: "search-button",
            "aria-label": "Search",
            "aria-expanded": "false",
            tabindex: "-1",
            style: "display:none",
          },
          h(
            "svg",
            { role: "img", xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 19.9 19.7" },
            h("title", null, "Search"),
            h(
              "g",
              { class: "search-path", fill: "none" },
              h("path", { "stroke-linecap": "square", d: "M18.5 18.3l-5.4-5.4" }),
              h("circle", { cx: "8", cy: "8", r: "7" }),
            ),
          ),
          h("p", null, "Search"),
        ),
        h(
          "div",
          { class: "search-container" },
          h(
            "div",
            { class: "search-space" },
            h(
              "label",
              { for: "kv-dashboard-search-input", class: "visually-hidden" },
              "Search vault",
            ),
            h("input", {
              id: "kv-dashboard-search-input",
              class: "search-bar kv-dashboard-search-input",
              type: "text",
              name: "search",
              placeholder: "Search titles, content, tags…",
              "aria-label": "Search vault",
              autocomplete: "off",
            }),
            h("div", {
              class: "search-layout",
              "data-preview": "true",
              "data-field-priority": JSON.stringify(["title", "tags", "content"]),
            }),
          ),
        ),
      ),
      h("p", { class: "kv-dashboard-search-hint" }, "Tip: use tag:work or #work to filter by tag."),
    ),
    hasOpen
      ? h(
          "section",
          {
            class: "kv-dashboard-section kv-dashboard-open-tasks",
            "aria-labelledby": "kv-open-tasks-heading",
          },
          h("h2", { id: "kv-open-tasks-heading" }, `Open Tasks (${openTasks.length})`),
          h(
            "ul",
            { class: "kv-dashboard-list" },
            openTasks.map((f) => DashboardCard(f, baseSlug)),
          ),
        )
      : null,
    hasIdeas
      ? h(
          "section",
          {
            class: "kv-dashboard-section kv-dashboard-active-ideas",
            "aria-labelledby": "kv-active-ideas-heading",
          },
          h("h2", { id: "kv-active-ideas-heading" }, `Active Ideas (${activeIdeas.length})`),
          h(
            "ul",
            { class: "kv-dashboard-list" },
            activeIdeas.map((f) => DashboardCard(f, baseSlug)),
          ),
        )
      : null,
    hasRecent
      ? h(
          "section",
          {
            class: "kv-dashboard-section kv-dashboard-recent",
            "aria-labelledby": "kv-recent-heading",
          },
          h("h2", { id: "kv-recent-heading" }, "Recent"),
          h(
            "ul",
            { class: "kv-dashboard-list" },
            recent.map((f) => DashboardCard(f, baseSlug)),
          ),
        )
      : null,
    hasCollections
      ? h(
          "nav",
          {
            class: "kv-dashboard-collections",
            "aria-label": "Collections",
            "aria-labelledby": "kv-collections-heading",
          },
          h("h2", { id: "kv-collections-heading" }, "Collections"),
          h(
            "ul",
            null,
            sortedCollections.map((col) => {
              const href = resolveRelative(baseSlug, `${COLLECTIONS_PREFIX}${col.slug}`)
              return h(
                "li",
                { key: col.slug },
                h("a", { href, class: "internal" }, `${col.label} (${col.items.length})`),
              )
            }),
          ),
        )
      : null,
  )
}

DashboardContentComponent.css = `
.kv-dashboard {
  display: grid;
  gap: 1.75rem;
  max-width: 75ch;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
  padding: 1rem;
  overflow-wrap: break-word;
  grid-template-areas:
    "search"
    "open"
    "ideas"
    "recent"
    "collections";
}
.kv-dashboard * {
  box-sizing: border-box;
}
.kv-dashboard-header {
  border-bottom: 1px solid var(--lightgray);
  padding-bottom: 0.75rem;
}
.kv-dashboard-header h1 {
  margin: 0;
  font-size: 1.75rem;
  overflow-wrap: break-word;
}
.kv-dashboard-intro {
  margin: 0.5rem 0 0;
  color: var(--darkgray);
  font-size: 0.95rem;
  line-height: 1.4;
  max-width: 60ch;
}
.kv-dashboard-search {
  grid-area: search;
  background: var(--light);
  border: 1px solid var(--lightgray);
  border-radius: 0.5rem;
  padding: 1rem;
}
.kv-dashboard-search h2 {
  margin: 0 0 0.6rem;
  font-size: 1.1rem;
}
.kv-dashboard-search .search {
  max-width: none;
  width: 100%;
}
.kv-dashboard-search .search > .search-button {
  display: none;
}
.kv-dashboard-search .search > .search-container {
  position: static;
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  backdrop-filter: none;
  contain: none;
}
.kv-dashboard-search .search > .search-container > .search-space {
  width: 100%;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.kv-dashboard-search .search > .search-container > .search-space > .search-layout {
  display: none;
  flex-direction: column;
  border: 1px solid var(--lightgray);
  border-radius: 0.375rem;
  background: var(--light);
  max-height: 400px;
  overflow-y: auto;
}
.kv-dashboard-search .search > .search-container > .search-space > .search-layout.display-results {
  display: flex;
}
.kv-dashboard-search-input {
  width: 100%;
  max-width: 640px;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--gray);
  border-radius: 0.375rem;
  font-size: 1rem;
  background: var(--light);
  color: var(--dark);
  box-sizing: border-box;
}
.kv-dashboard-search-input:focus {
  outline: 2px solid var(--secondary);
  outline-offset: 2px;
  border-color: var(--secondary);
}
.kv-dashboard-search-hint {
  margin: 0.6rem 0 0;
  font-size: 0.85rem;
  color: var(--darkgray);
}
.kv-dashboard-section h2 {
  margin: 0 0 0.75rem;
  font-size: 1.2rem;
  border-bottom: 1px solid var(--lightgray);
  padding-bottom: 0.25rem;
  overflow-wrap: break-word;
}
.kv-dashboard-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.75rem;
}
.kv-dashboard-card {
  border: 1px solid var(--lightgray);
  border-radius: 0.5rem;
  background: var(--light);
  padding: 0.75rem;
  overflow-wrap: break-word;
  word-break: break-word;
  max-width: 100%;
}
.kv-dashboard-card-inner {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
.kv-dashboard-card-title {
  margin: 0;
  font-size: 1rem;
  line-height: 1.3;
  overflow-wrap: anywhere;
}
.kv-dashboard-card-title a {
  color: var(--secondary);
  text-decoration: none;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.kv-dashboard-card-title a:hover {
  text-decoration: underline;
}
.kv-dashboard-card-title a:focus-visible {
  outline: 2px solid var(--secondary);
  outline-offset: 2px;
  border-radius: 2px;
}
.kv-dashboard-card-desc {
  margin: 0;
  color: var(--darkgray);
  font-size: 0.9rem;
  line-height: 1.4;
  overflow-wrap: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.kv-dashboard-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.8rem;
  color: var(--darkgray);
  align-items: center;
}
.kv-dashboard-card-type,
.kv-dashboard-card-status {
  background: var(--highlight);
  padding: 0.15rem 0.45rem;
  border-radius: 0.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  border: 1px solid transparent;
}
.kv-dashboard-card-status {
  background: var(--lightgray);
}
.kv-dashboard-card-date {
  background: transparent;
  padding: 0;
  color: var(--gray);
  font-size: 0.8rem;
  white-space: nowrap;
}
.kv-dashboard-collections {
  grid-area: collections;
  border: 1px solid var(--lightgray);
  border-radius: 0.5rem;
  padding: 1rem;
  background: var(--light);
  overflow-wrap: break-word;
}
.kv-dashboard-collections h2 {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
}
.kv-dashboard-collections ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.kv-dashboard-collections li {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
}
.kv-dashboard-collections a {
  display: block;
  padding: 0.35rem 0.6rem;
  background: var(--lightgray);
  border-radius: 0.375rem;
  color: var(--dark);
  text-decoration: none;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  box-sizing: border-box;
  overflow-wrap: anywhere;
}
.kv-dashboard-collections a:hover {
  background: var(--gray);
  color: var(--light);
}
.kv-dashboard-collections a:focus-visible {
  outline: 2px solid var(--secondary);
  outline-offset: 2px;
}
.kv-dashboard a:focus-visible,
.kv-dashboard button:focus-visible,
.kv-dashboard input:focus-visible {
  outline: 2px solid var(--secondary);
  outline-offset: 2px;
}
.kv-dashboard-open-tasks { grid-area: open; }
.kv-dashboard-active-ideas { grid-area: ideas; }
.kv-dashboard-recent { grid-area: recent; }
.kv-dashboard-search { grid-area: search; }

@media (min-width: 800px) {
  .kv-dashboard {
    max-width: 1100px;
    grid-template-columns: 1fr 340px;
    grid-template-areas:
      "search search"
      "open collections"
      "ideas collections"
      "recent recent";
    column-gap: 1.5rem;
    row-gap: 1.5rem;
    padding: 1.25rem;
  }
  .kv-dashboard-search .search {
    max-width: 640px;
  }
}
@media (max-width: 799px) {
  .kv-dashboard {
    padding: 0.75rem;
    gap: 1.25rem;
  }
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
`

function VaultPageBodyComponent(props) {
  const { fileData } = props
  if (fileData.isDashboard || fileData.dashboard) {
    return DashboardContentComponent(props)
  }
  if (fileData.collection) {
    return CollectionContentComponent(props)
  }
  const slug = (fileData.slug ?? "").toString()
  if (slug === DASHBOARD_SLUG || slug.startsWith(`${DASHBOARD_SLUG}/`)) {
    return DashboardContentComponent(props)
  }
  return CollectionContentComponent(props)
}
VaultPageBodyComponent.css = CollectionContentComponent.css + "\n" + DashboardContentComponent.css

const VaultPageBody = () => VaultPageBodyComponent
const DashboardContent = () => DashboardContentComponent

// ---------------------------------------------------------------------------
// Transformer: first-H1 title adaptation (single authoritative instance)
// ---------------------------------------------------------------------------

export const KnowledgeVault = (opts) => ({
  name: "KnowledgeVault",
  markdownPlugins(ctx) {
    return [
      () => {
        return (tree, file) => {
          const raw = (file.value ?? "").toString()
          const explicitTitle = getRawFrontmatterTitle(raw)
          if (explicitTitle !== null && explicitTitle !== "") {
            return
          }
          const found = findFirstH1(tree)
          if (!found) {
            return
          }
          const fm = (file.data.frontmatter ??= {})
          fm.title = found.text
          file.data._knowledgeVaultAdapted = true
          file.data._knowledgeVaultTitle = found.text
          tree.children.splice(found.index, 1)
        }
      },
    ]
  },
  htmlPlugins(ctx) {
    return [
      () => {
        return (tree, file) => {
          if (!file.data._knowledgeVaultAdapted) return
          if (!tree || !Array.isArray(tree.children)) return
          const adaptedTitle = file.data._knowledgeVaultTitle
          if (typeof adaptedTitle !== "string" || adaptedTitle.length === 0) return
          let idx = -1
          for (let i = 0; i < tree.children.length; i++) {
            const n = tree.children[i]
            if (n && n.type === "element" && n.tagName === "h1") {
              const text = mdastToString(n).trim().replace(/\s+/g, " ")
              if (text === adaptedTitle) {
                idx = i
                break
              }
            }
          }
          if (idx !== -1) {
            tree.children.splice(idx, 1)
          }
        }
      },
    ]
  },
})
KnowledgeVault.quartzCategory = "transformer"

// ---------------------------------------------------------------------------
// PageType: virtual collection pages plus Vault dashboard (single authoritative generation path)
// ---------------------------------------------------------------------------

export const Collections = (opts) => ({
  name: "KnowledgeVaultCollections",
  priority: 5,
  match: ({ fileData }) =>
    !!fileData &&
    ((typeof fileData.collection === "object" && fileData.collection !== null) ||
      !!fileData.isDashboard ||
      !!fileData.dashboard),
  generate({ content, cfg }) {
    const allFiles = content.map((c) => c[1].data).filter((d) => d.unlisted !== true)
    // buildCollectionsFromFiles already accounts for authored route occupancy
    // deterministically, so generated slugs are collision-safe and need not be skipped.
    const collections = buildCollectionsFromFiles(allFiles)

    const virtualPages = []
    for (const col of collections) {
      const slug = `${COLLECTIONS_PREFIX}${col.slug}`
      virtualPages.push({
        slug,
        title: col.label,
        data: { collection: col, isVirtualPage: true },
      })
    }
    const dashboardSlug = getDashboardSlug(allFiles)
    virtualPages.push({
      slug: dashboardSlug,
      title: "Vault Dashboard",
      data: { isDashboard: true, dashboard: true, isVirtualPage: true },
    })
    return virtualPages
  },
  layout: "collection",
  body: VaultPageBody,
})
Collections.quartzCategory = "pageType"

// Dashboard alias for explicit category discovery — shares same implementation as Collections unified pageType
export const Dashboard = Collections
Dashboard.quartzCategory = "pageType"

export default KnowledgeVault
