import { QuartzEmitterPlugin } from "../types"
import { FullSlug } from "../../util/path"
import { BuildCtx } from "../../util/ctx"
import { ProcessedContent } from "../vfile"
import { write } from "./helpers"
import { FilePath } from "../../util/path"

export type ContentMetadataEntry = {
  slug: string
  title: string
  tags: string[]
  date: string | null
  description: string
}

/**
 * Build metadata entries from processed content.
 * Filters out unlisted pages, derives only from frontmatter/description/dates
 * (public-safe), and sorts by slug for deterministic output.
 */
export function buildMetadataEntries(content: ProcessedContent[]): ContentMetadataEntry[] {
  const entries: ContentMetadataEntry[] = []

  for (const [, file] of content) {
    const data = file.data as unknown as Record<string, unknown>
    if (data.unlisted === true) continue
    const slug = (data.slug as string) ?? ""
    if (!slug) continue

    const fm = (data.frontmatter as Record<string, unknown> | undefined) ?? {}
    const title = typeof fm.title === "string" ? fm.title : ""
    const rawTags = fm.tags as unknown
    const tags: string[] = Array.isArray(rawTags)
      ? rawTags.filter((t): t is string => typeof t === "string" && t.length > 0)
      : []

    // date via defaultDateType -> dates[defaultDateType]
    let date: string | null = null
    const defaultDateType = data.defaultDateType as string | undefined
    const dates = data.dates as Record<string, unknown> | undefined
    if (defaultDateType && dates) {
      const d = dates[defaultDateType]
      if (d instanceof Date && !Number.isNaN(d.getTime())) {
        date = d.toISOString()
      } else if (typeof d === "string") {
        const parsed = new Date(d)
        if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString()
      }
    }

    const rawDesc =
      (data.description as string | undefined) ??
      (fm.description as string | undefined) ??
      (fm.socialDescription as string | undefined) ??
      ""
    const description = typeof rawDesc === "string" ? rawDesc : ""

    entries.push({ slug, title, tags, date, description })
  }

  // deterministic stable order: sort by slug
  entries.sort((a, b) => a.slug.localeCompare(b.slug))
  return entries
}

export const ContentMetadata: QuartzEmitterPlugin = () => {
  const emitAll = async (ctx: BuildCtx, content: ProcessedContent[]) => {
    const entries = buildMetadataEntries(content)
    const json = JSON.stringify(entries, null, 2)
    const fp = await write({
      ctx,
      slug: "static/contentMetadata" as FullSlug,
      ext: ".json",
      content: json,
    })
    return [fp] as FilePath[]
  }

  return {
    name: "ContentMetadata",
    emit: emitAll,
    partialEmit: emitAll,
  }
}
