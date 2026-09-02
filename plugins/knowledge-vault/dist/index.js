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
// PageType: virtual collection pages (single authoritative generation path)
// ---------------------------------------------------------------------------

export const Collections = (opts) => ({
  name: "KnowledgeVaultCollections",
  priority: 5,
  match: ({ fileData }) =>
    !!fileData && typeof fileData.collection === "object" && fileData.collection !== null,
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
    return virtualPages
  },
  layout: "collection",
  body: CollectionContent,
})
Collections.quartzCategory = "pageType"

export default KnowledgeVault
