import { QuartzPluginData } from "../plugins/vfile"
import { FullSlug } from "./path"

export function getDistinctTags(allFiles: QuartzPluginData[]): string[] {
  const set = new Set<string>()
  for (const file of allFiles) {
    if ((file as unknown as { unlisted?: unknown }).unlisted === true) continue
    const tags = (file.frontmatter?.tags ?? []) as string[]
    for (const tag of tags) {
      if (typeof tag === "string" && tag.length > 0) {
        set.add(tag)
      }
    }
  }
  return [...set]
}

export function getTagCounts(allFiles: QuartzPluginData[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const file of allFiles) {
    if ((file as unknown as { unlisted?: unknown }).unlisted === true) continue
    const tags = (file.frontmatter?.tags ?? []) as string[]
    // dedupe per file: note-properties already dedupes, but guard against duplicates
    const unique = new Set<string>()
    for (const tag of tags) {
      if (typeof tag === "string" && tag.length > 0) unique.add(tag)
    }
    for (const tag of unique) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return counts
}

export function getPagesForTag(allFiles: QuartzPluginData[], tag: string): QuartzPluginData[] {
  return allFiles.filter((file) => {
    if ((file as unknown as { unlisted?: unknown }).unlisted === true) return false
    const tags = (file.frontmatter?.tags ?? []) as string[]
    return tags.includes(tag)
  })
}

export function slugForTag(tag: string): FullSlug {
  return `tags/${tag}` as FullSlug
}

export function slugForTagIndex(): FullSlug {
  return "tags/index" as FullSlug
}

export function getSortedTagsByCount(
  counts: Map<string, number>,
): Array<{ tag: string; count: number }> {
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return a.tag.localeCompare(b.tag)
    })
}
