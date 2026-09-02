/**
 * Knowledge Vault presentation plugin — Tolaria first-H1 title adaptation.
 *
 * - If a note has no explicit `title` frontmatter, use the text of its first
 *   level-1 heading as the page title (frontmatter.title) so every downstream
 *   Quartz surface (article title, listings, breadcrumbs, previews, search
 *   index, metadata) sees the readable title.
 * - Remove that H1 from rendered content so the page shows a single primary
 *   title (the ArticleTitle component) instead of both.
 * - If the file has no H1, keep Quartz's filename fallback and do not fail.
 * - Byte-for-byte canonical Markdown is preserved; only build metadata and
 *   rendered output are affected.
 */

function getRawFrontmatterTitle(raw) {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith("---")) return null
  const end = trimmed.indexOf("\n---", 3)
  if (end === -1) return null
  const fmBlock = trimmed.slice(3, end)
  // Quick yaml-ish extraction for `title:` line. Handles quoted values.
  const lines = fmBlock.split("\n")
  for (const line of lines) {
    const m = line.match(/^\s*title\s*:\s*(.*)\s*$/)
    if (m) {
      let val = (m[1] ?? "").trim()
      if (val === "" || val === "null" || val === "~") return null
      // Strip surrounding quotes if present
      if (
        (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
        (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
      ) {
        val = val.slice(1, -1)
      }
      // Remove trailing comments? Not needed for synthetic fixtures
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
      // Empty heading: treat as no title, don't use
      return null
    }
  }
  return null
}

export const KnowledgeVault = (opts) => ({
  name: "KnowledgeVault",
  markdownPlugins(ctx) {
    return [
      () => {
        return (tree, file) => {
          const raw = (file.value ?? "").toString()
          const explicitTitle = getRawFrontmatterTitle(raw)
          if (explicitTitle !== null && explicitTitle !== "") {
            // Authored title present — leave H1 as content, do not adapt.
            return
          }

          // No explicit title — try to use first H1
          const found = findFirstH1(tree)
          if (!found) {
            // No H1: degrade to Quartz filename fallback (already set by NoteProperties)
            return
          }

          // Ensure frontmatter exists (NoteProperties guarantees it, but be safe)
          const fm = (file.data.frontmatter ??= {})
          fm.title = found.text
          // Mark adaptation for html-phase duplicate removal safety net
          file.data._knowledgeVaultAdapted = true
          file.data._knowledgeVaultTitle = found.text

          // Remove the H1 from markdown AST so it doesn't render as duplicate
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
          // Safety net: remove only the adapted H1 if it survived (e.g., raw HTML <h1>)
          // Compare normalized text to avoid deleting legitimate subsequent H1s.
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

export default KnowledgeVault
