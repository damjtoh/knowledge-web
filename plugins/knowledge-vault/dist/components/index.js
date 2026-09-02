import { h } from "preact"
import { resolveRelative } from "@quartz-community/utils"

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

function CollectionNavComponent(props) {
  const { fileData, allFiles } = props
  const collections = buildCollectionsFromFiles(allFiles ?? [])
  if (collections.length === 0) return null
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
export default CollectionNav
