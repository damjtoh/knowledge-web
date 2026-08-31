import {
  parseSearchQuery,
  getFolderPath,
  matchesTags,
  matchesTagSubstring,
} from "../../util/search"

type SearchItem = {
  slug: string
  title: string
  content: string
  tags: string[]
}

let contentData: Record<string, SearchItem> | null = null

async function loadContentData(): Promise<Record<string, SearchItem>> {
  if (contentData) return contentData
  try {
    const data = await (globalThis as unknown as { fetchData: Promise<unknown> }).fetchData
    if (data && typeof data === "object") {
      const maybe = data as Record<string, unknown>
      // contentIndex is emitted as Object.fromEntries of linkIndex; may be nested under `content` if wrapped
      const candidate =
        maybe["content"] && typeof maybe["content"] === "object"
          ? (maybe["content"] as Record<string, SearchItem>)
          : (maybe as Record<string, SearchItem>)
      // basic shape check: values should have slug
      const first = Object.values(candidate)[0] as unknown
      if (first && typeof first === "object" && "slug" in (first as Record<string, unknown>)) {
        contentData = candidate
        return contentData
      }
    }
  } catch {
    // ignore
  }
  try {
    const res = await fetch("/static/contentIndex.json")
    if (res.ok) {
      const json = (await res.json()) as Record<string, SearchItem>
      contentData = json
      return json
    }
  } catch {
    // ignore
  }
  return {}
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function highlightSimple(text: string, term: string): string {
  if (!term) return escapeHTML(text)
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`(${escapedTerm})`, "gi")
  const parts = escapeHTML(text).split(regex)
  return parts
    .map((part) =>
      part.toLowerCase() === term.toLowerCase() ? `<span class="highlight">${part}</span>` : part,
    )
    .join("")
}

function getFolderDisplay(slug: string): string {
  return getFolderPath(slug)
}

function ensureFolderElements(container: Element) {
  const cards = container.querySelectorAll(".result-card:not(.no-match)")
  for (const card of Array.from(cards)) {
    if (card.querySelector(".search-folder")) continue
    const slug = (card as HTMLElement).id || card.getAttribute("href")?.replace(/^\//, "") || ""
    const folder = getFolderDisplay(slug)
    const folderEl = document.createElement("p")
    folderEl.className = "search-folder"
    folderEl.textContent = folder || "—"
    // Insert after title if possible, otherwise append
    const titleEl = card.querySelector(".card-title")
    if (titleEl && titleEl.nextSibling) {
      titleEl.parentNode?.insertBefore(folderEl, titleEl.nextSibling)
    } else if (titleEl) {
      titleEl.after(folderEl)
    } else {
      card.appendChild(folderEl)
    }
  }
}

function titleBoostSort(cards: Element[], query: string): Element[] {
  if (!query) return cards
  const q = query.toLowerCase()
  const withTitle: Element[] = []
  const without: Element[] = []
  for (const card of cards) {
    const slug = (card as HTMLElement).id
    const item = contentData?.[slug]
    const title = item?.title ?? card.querySelector(".card-title")?.textContent ?? ""
    if (title.toLowerCase().includes(q)) withTitle.push(card)
    else without.push(card)
  }
  return [...withTitle, ...without]
}

async function postProcessSearch(searchBar: HTMLInputElement, resultsContainer: Element) {
  const raw = searchBar.value
  const { tags, query } = parseSearchQuery(raw)
  const data = await loadContentData()

  // Ensure folder elements for existing cards
  ensureFolderElements(resultsContainer)

  const cards = Array.from(
    resultsContainer.querySelectorAll(".result-card:not(.no-match)"),
  ) as HTMLElement[]

  // Tag filtering (AND, case-insensitive)
  if (tags.length > 0) {
    for (const card of cards) {
      const slug = card.id
      const item = data[slug]
      const itemTags = item?.tags ?? []
      const ok = matchesTags(itemTags, tags)
      card.style.display = ok ? "" : "none"
      // If card has tags ul, highlight matched tags? Already done by community for #, but for tag: we need to ensure highlight
      // Update tag highlight for tag: queries
      if (ok && itemTags.length > 0) {
        const ul = card.querySelector("ul.tags")
        if (ul) {
          // Rebuild tag list with highlights for matched tags
          const lowerTags = tags.map((t) => t.toLowerCase())
          const lis = Array.from(ul.querySelectorAll("li"))
          for (const li of lis) {
            const p = li.querySelector("p")
            if (!p) continue
            const rawTag = (p.textContent ?? "").replace(/^#/, "").trim()
            const isMatch = lowerTags.includes(rawTag.toLowerCase())
            p.classList.toggle("match-tag", isMatch)
          }
        }
      }
    }
  } else {
    // no tag filter, ensure all visible for query-only case (but we will further supplement)
    for (const card of cards) card.style.display = ""
  }

  // For tag: filtering, supplement missing results when query empty or query present but tag filter hides all and there are matching items not in DOM
  // Also for plain query tag-searchable: add tag substring matches not already present
  const visibleSlugs = new Set(
    Array.from(resultsContainer.querySelectorAll(".result-card:not(.no-match)"))
      .map((el) => (el as HTMLElement).id)
      .filter(Boolean),
  )

  // Build list of candidate slugs that should be visible but are not
  const candidates: SearchItem[] = []
  const allItems = Object.values(data)
  const lowerQuery = query.toLowerCase()

  if (tags.length > 0) {
    // tag: mode: find all items matching tags (and query if present) that are not yet in DOM
    for (const item of allItems) {
      if (visibleSlugs.has(item.slug)) continue
      if (!matchesTags(item.tags, tags)) continue
      if (query) {
        const titleMatch = item.title.toLowerCase().includes(lowerQuery)
        const contentMatch = item.content.toLowerCase().includes(lowerQuery)
        const tagSub = matchesTagSubstring(item.tags, query)
        if (!titleMatch && !contentMatch && !tagSub) continue
      }
      candidates.push(item)
    }
  } else if (query) {
    // plain query tag-searchable: add tag-substring matches not already present
    for (const item of allItems) {
      if (visibleSlugs.has(item.slug)) continue
      if (matchesTagSubstring(item.tags, query)) {
        candidates.push(item)
      }
    }
  }

  // Limit candidates to avoid flooding; community shows 8
  const maxResults = 8
  const visibleCount = Array.from(
    resultsContainer.querySelectorAll(".result-card:not(.no-match)"),
  ).filter((el) => (el as HTMLElement).style.display !== "none").length
  const remaining = Math.max(0, maxResults - visibleCount)
  const toAdd = candidates.slice(0, remaining)

  for (const item of toAdd) {
    const card = document.createElement("a")
    card.className = "result-card"
    card.id = item.slug
    // Use simple href; community uses resolveBasePath but slug works relative to current
    card.href = item.slug.startsWith("/") ? item.slug : `/${item.slug}`

    const titleEl = document.createElement("h3")
    titleEl.className = "card-title"
    titleEl.innerHTML = query
      ? highlightSimple(item.title || "", query)
      : escapeHTML(item.title || "")
    card.appendChild(titleEl)

    const folderEl = document.createElement("p")
    folderEl.className = "search-folder"
    const folder = getFolderDisplay(item.slug)
    folderEl.textContent = folder || "—"
    card.appendChild(folderEl)

    if (item.tags.length > 0) {
      const ul = document.createElement("ul")
      ul.className = "tags"
      for (const tag of item.tags.slice(0, 5)) {
        const li = document.createElement("li")
        const p = document.createElement("p")
        if (tags.length > 0 && tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
          p.className = "match-tag"
        } else if (query && tag.toLowerCase().includes(lowerQuery)) {
          p.className = "match-tag"
        }
        p.textContent = `#${tag}`
        li.appendChild(p)
        ul.appendChild(li)
      }
      card.appendChild(ul)
    }

    const desc = document.createElement("p")
    desc.className = "card-description"
    const snippet = item.content ? item.content.slice(0, 200) : ""
    desc.innerHTML = query ? highlightSimple(snippet, query) : escapeHTML(snippet)
    card.appendChild(desc)

    resultsContainer.appendChild(card)
    // Ensure click navigates and stores search term
    card.addEventListener("click", () => {
      if (query) sessionStorage.setItem("search-term", query)
      else if (tags.length > 0) sessionStorage.setItem("search-term", tags.join(" "))
    })
  }

  // Title boost reordering for visible cards
  if (query) {
    const visibleCards = Array.from(
      resultsContainer.querySelectorAll(".result-card:not(.no-match)"),
    ).filter((el) => (el as HTMLElement).style.display !== "none") as Element[]
    if (visibleCards.length > 1) {
      const sorted = titleBoostSort(visibleCards, query)
      for (const card of sorted) resultsContainer.appendChild(card)
      // Re-ensure folder elements after reorder (they are already there)
    }
  }

  // Handle no results case: if after filtering no visible cards, show no-match if not already
  const anyVisible = Array.from(
    resultsContainer.querySelectorAll(".result-card:not(.no-match)"),
  ).some((el) => (el as HTMLElement).style.display !== "none")
  const noMatch = resultsContainer.querySelector(".result-card.no-match") as HTMLElement | null
  if (!anyVisible) {
    if (!noMatch) {
      const el = document.createElement("a")
      el.className = "result-card no-match"
      const h3 = document.createElement("h3")
      h3.textContent = "No results."
      const p = document.createElement("p")
      p.textContent = "Try another search term?"
      el.appendChild(h3)
      el.appendChild(p)
      resultsContainer.appendChild(el)
    } else {
      noMatch.style.display = ""
    }
  } else if (noMatch) {
    noMatch.style.display = "none"
  }
}

// --- Attachment lifecycle (fix for review findings) ---

const attachedSet = new WeakSet<Element>()
const pendingMap = new WeakMap<Element, MutationObserver>()

function attachToSearch(
  searchEl: Element,
  searchBar: HTMLInputElement,
  _searchLayout: HTMLElement,
  resultsContainer: HTMLElement,
) {
  if ((searchEl as HTMLElement).dataset.searchUpgradesSetup === "true") return
  if (attachedSet.has(searchEl)) return

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const debouncedPostProcess = () => {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      postProcessSearch(searchBar, resultsContainer).catch(() => {})
    }, 60)
  }

  const observer = new MutationObserver(() => {
    ensureFolderElements(resultsContainer)
    debouncedPostProcess()
  })
  observer.observe(resultsContainer, { childList: true, subtree: false })

  const onInput = () => {
    debouncedPostProcess()
  }
  searchBar.addEventListener("input", onInput)

  const cleanup = () => {
    observer.disconnect()
    searchBar.removeEventListener("input", onInput)
    if (debounceTimer) clearTimeout(debounceTimer)
    attachedSet.delete(searchEl)
    pendingMap.delete(searchEl)
    delete (searchEl as HTMLElement).dataset.searchUpgradesSetup
  }

  // Register cleanup at ATTACH time (window.addCleanup is defined by spa.inline after its script eval, which is after this script but before nav dispatch)
  const w = window as unknown as { addCleanup?: (fn: () => void) => void }
  if (typeof w.addCleanup === "function") {
    w.addCleanup(cleanup)
  } else {
    // Fallback for non-SPA or very early attach: clean on prenav
    const prenavHandler = () => {
      cleanup()
      document.removeEventListener("prenav", prenavHandler)
    }
    document.addEventListener("prenav", prenavHandler)
  }

  attachedSet.add(searchEl)
  ;(searchEl as HTMLElement).dataset.searchUpgradesSetup = "true"
}

function trySetupElement(searchEl: Element) {
  if ((searchEl as HTMLElement).dataset.searchUpgradesSetup === "true") return
  if (attachedSet.has(searchEl)) return
  if (pendingMap.has(searchEl)) return

  const searchBar = searchEl.querySelector(".search-bar") as HTMLInputElement | null
  const searchLayout = searchEl.querySelector(".search-layout") as HTMLElement | null
  if (!searchBar || !searchLayout) return

  const resultsContainer = searchLayout.querySelector(".results-container") as HTMLElement | null
  if (resultsContainer) {
    attachToSearch(searchEl, searchBar, searchLayout, resultsContainer)
  } else {
    // Container not yet created by the search plugin (async initIndex); observe layout for its creation
    const layoutObserver = new MutationObserver(() => {
      const rc = searchLayout.querySelector(".results-container") as HTMLElement | null
      if (rc) {
        layoutObserver.disconnect()
        pendingMap.delete(searchEl)
        attachToSearch(searchEl, searchBar, searchLayout, rc)
      }
    })
    layoutObserver.observe(searchLayout, { childList: true, subtree: false })
    pendingMap.set(searchEl, layoutObserver)

    const pendingCleanup = () => {
      layoutObserver.disconnect()
      pendingMap.delete(searchEl)
    }
    const w = window as unknown as { addCleanup?: (fn: () => void) => void }
    if (typeof w.addCleanup === "function") {
      w.addCleanup(pendingCleanup)
    } else {
      const prenavHandler = () => {
        pendingCleanup()
        document.removeEventListener("prenav", prenavHandler)
      }
      document.addEventListener("prenav", prenavHandler)
    }
  }
}

function setupSearchUpgrades() {
  const searchEls = document.querySelectorAll(".search")
  for (const el of Array.from(searchEls)) {
    trySetupElement(el)
  }
}

// Re-attach per SPA navigation: micromorph wipes the runtime container on every nav (spa.inline morph before nav event),
// so we must observe anew on each nav, not just once.
document.addEventListener("nav", setupSearchUpgrades)
// Also handle "render" for completeness (search plugin listens to both)
document.addEventListener("render", setupSearchUpgrades)

// Initial attempt: if nav has already been dispatched before this script's listener was registered (late load),
// the scheduled nav handler will still run on next nav, but also try once now via microtask after spa defines addCleanup.
// Use a deferred call so window.addCleanup is defined (spa.inline defines it synchronously in the same afterDOMLoaded bundle after this script).
setTimeout(setupSearchUpgrades, 0)
