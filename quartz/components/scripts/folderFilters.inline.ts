import { matchesQuery, matchesTags, isTagPagePath } from "../../util/folderFilters"

type Entry = {
  title: string
  tags: string[]
  date: string | null
  element: HTMLElement
  originalIndex: number
}

function getEntryFromLi(li: HTMLElement, idx: number): Entry {
  const titleEl = li.querySelector(".desc h3 a") ?? li.querySelector(".desc h3")
  const title = (titleEl?.textContent ?? "").trim()
  const tags = [...li.querySelectorAll(".tags .tag-link")]
    .map((a) => (a.textContent ?? "").trim())
    .filter(Boolean)
  const timeEl = li.querySelector("time[datetime]") as HTMLElement | null
  const date = timeEl?.getAttribute("datetime") ?? null
  return { title, tags, date, element: li, originalIndex: idx }
}

function parseDateMs(d: string | null): number | null {
  if (!d) return null
  const t = Date.parse(d)
  return Number.isNaN(t) ? null : t
}

function compareAlpha(a: Entry, b: Entry): number {
  const c = a.title.toLowerCase().localeCompare(b.title.toLowerCase())
  if (c !== 0) return c
  return a.originalIndex - b.originalIndex
}

function compareDate(a: Entry, b: Entry): number {
  const at = parseDateMs(a.date)
  const bt = parseDateMs(b.date)
  if (at !== null && bt !== null) {
    if (bt !== at) return bt - at
    return compareAlpha(a, b)
  }
  if (at !== null && bt === null) return -1
  if (at === null && bt !== null) return 1
  return compareAlpha(a, b)
}

function isFolderPage(): boolean {
  // Exclude tag pages: TagContent.tsx renders same .page-listing markup but is owned by kw-1
  // Tags live under /tags/... (segment-aware)
  if (isTagPagePath(location.pathname)) return false
  // Heuristic: folder pages have .page-listing and slug ends with /index or contains folder listing
  // Check presence of page-listing container with section-ul
  return !!document.querySelector(".page-listing .section-ul")
}

function setupFolderFilters() {
  const pageListing = document.querySelector(".page-listing") as HTMLElement | null
  const listing = document.querySelector(".page-listing .section-ul") as HTMLElement | null
  if (!pageListing || !listing) return

  // Avoid duplicate setup on same nav (SPA)
  if (pageListing.dataset.folderFiltersSetup === "true") {
    // Re-run filtering with current state if needed? For SPA nav we reset.
    // If dataset says setup, but we are on new page, the old dataset persists in new DOM? micromorph replaces body, so dataset resets.
    // So just proceed if not already setup for this DOM.
    return
  }
  pageListing.dataset.folderFiltersSetup = "true"

  const items = [...listing.querySelectorAll(":scope > .section-li")] as HTMLElement[]
  if (items.length === 0) return

  const entries: Entry[] = items.map((li, idx) => getEntryFromLi(li, idx))

  // Build filter UI
  const container = document.createElement("div")
  container.className = "folder-filters"
  // Use innerHTML for structure
  container.innerHTML = `
    <div class="folder-filters-row">
      <input type="search" class="folder-filter-input" placeholder="Filter by title or tag" aria-label="Filter pages" autocomplete="off" />
      <select class="folder-sort-select" aria-label="Sort pages">
        <option value="default" selected>Default</option>
        <option value="alpha">A–Z</option>
        <option value="date">Newest</option>
      </select>
    </div>
    <div class="folder-tag-filters" role="group" aria-label="Filter by tags"></div>
    <div class="folder-filter-count" aria-live="polite"></div>
  `

  const input = container.querySelector(".folder-filter-input") as HTMLInputElement
  const sortSelect = container.querySelector(".folder-sort-select") as HTMLSelectElement
  const tagContainer = container.querySelector(".folder-tag-filters") as HTMLElement
  const countEl = container.querySelector(".folder-filter-count") as HTMLElement

  // Distinct tags sorted
  const distinct = [...new Set(entries.flatMap((e) => e.tags))].sort((a, b) => a.localeCompare(b))
  for (const tag of distinct) {
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = "folder-tag-chip"
    btn.dataset.tag = tag
    btn.textContent = tag
    btn.setAttribute("aria-pressed", "false")
    tagContainer.appendChild(btn)
  }

  if (distinct.length === 0) {
    tagContainer.style.display = "none"
  }

  // Insert container before listing's wrapper div or before listing
  // pageListing structure: <p> count, <div><ul>
  // We want filters above the ul
  const wrapperDiv = listing.parentElement
  if (wrapperDiv && wrapperDiv.parentElement === pageListing) {
    pageListing.insertBefore(container, wrapperDiv)
  } else {
    pageListing.insertBefore(container, listing)
  }

  let selectedTags = new Set<string>()

  function apply() {
    const query = input.value.trim()
    const selected = [...selectedTags]
    const sortMode = sortSelect.value as "default" | "alpha" | "date"

    // Filter
    let visibleCount = 0
    for (const entry of entries) {
      const qMatch = matchesQuery(entry as unknown as any, query)
      const tMatch = matchesTags(entry as unknown as any, selected)
      const visible = qMatch && tMatch
      entry.element.style.display = visible ? "" : "none"
      if (visible) visibleCount++
    }

    // Sort (reorder DOM). Sorting reorders all nodes, hidden stays hidden but order changes
    if (sortMode !== "default") {
      const sorted = [...entries].sort((a, b) => {
        if (sortMode === "alpha") return compareAlpha(a, b)
        return compareDate(a, b)
      })
      for (const e of sorted) {
        listing!.appendChild(e.element)
      }
    } else {
      // default: restore original order
      const sorted = [...entries].sort((a, b) => a.originalIndex - b.originalIndex)
      for (const e of sorted) {
        listing!.appendChild(e.element)
      }
    }

    // Update count
    const total = entries.length
    if (query || selected.length > 0) {
      countEl.textContent = `${visibleCount} of ${total} shown`
    } else {
      // When no filter, show default count? Keep empty to not duplicate folder count
      countEl.textContent = ""
    }

    // Re-apply visibility after reorder (append moves nodes, display stays)
    // No need to re-filter, already set.
  }

  // Listeners
  const onInput = () => apply()
  const onSort = () => apply()

  input.addEventListener("input", onInput)
  sortSelect.addEventListener("change", onSort)

  tagContainer.addEventListener("click", (e) => {
    const target = e.target as HTMLElement
    const chip = target.closest(".folder-tag-chip") as HTMLElement | null
    if (!chip || !tagContainer.contains(chip)) return
    const tag = chip.dataset.tag!
    if (selectedTags.has(tag)) {
      selectedTags.delete(tag)
      chip.classList.remove("active")
      chip.setAttribute("aria-pressed", "false")
    } else {
      selectedTags.add(tag)
      chip.classList.add("active")
      chip.setAttribute("aria-pressed", "true")
    }
    apply()
  })

  // SPA cleanup
  const cleanup = () => {
    input.removeEventListener("input", onInput)
    sortSelect.removeEventListener("change", onSort)
    // Remove container if still in DOM (micromorph will replace body, but for safety)
    container.remove()
    // Reset dataset flag
    if (pageListing) delete pageListing.dataset.folderFiltersSetup
  }

  // @ts-ignore - window.addCleanup defined by SPA router
  if (typeof window !== "undefined" && (window as any).addCleanup) {
    ;(window as any).addCleanup(cleanup)
  }

  // Initial apply (no filter)
  apply()
}

function init() {
  if (!isFolderPage()) return
  setupFolderFilters()
}

document.addEventListener("nav", init)
// Also run once on initial load if nav already dispatched before this script
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init)
} else {
  // Defer to next tick to allow initial nav event to fire
  setTimeout(init, 0)
}
