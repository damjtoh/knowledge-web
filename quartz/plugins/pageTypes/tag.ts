import { QuartzPageTypePlugin } from "../types"
import { match } from "./matchers"
import TagContent from "../../components/TagContent"
import { FullSlug } from "../../util/path"
import { ValidLocale, i18n } from "../../i18n"
import { getDistinctTags } from "../../util/tags"

export const TagPageType: QuartzPageTypePlugin = () => ({
  name: "TagPage",
  priority: 10,
  match: match.slugPrefix("tags/"),
  generate({ content, cfg }) {
    const allFiles = content
      .map((c) => c[1].data)
      .filter((d) => (d as { unlisted?: unknown } | undefined)?.unlisted !== true)
    const locale = (cfg.locale ?? "en-US") as ValidLocale

    const distinct = getDistinctTags(allFiles)

    const existingSlugs = new Set<string>()
    for (const [, file] of content) {
      const slug = (file.data as { slug?: string } | undefined)?.slug
      if (typeof slug === "string" && slug.startsWith("tags/")) {
        existingSlugs.add(slug)
      }
    }

    const virtualPages: import("../types").VirtualPage[] = []

    for (const tag of distinct) {
      const slug = `tags/${tag}` as FullSlug
      if (existingSlugs.has(slug)) continue
      virtualPages.push({
        slug,
        title: tag,
        data: {},
      })
    }

    const indexSlug = "tags/index" as FullSlug
    if (!existingSlugs.has(indexSlug)) {
      virtualPages.push({
        slug: indexSlug,
        title: i18n(locale).pages.tagContent.tagIndex,
        data: {},
      })
    }

    return virtualPages
  },
  layout: "tag",
  body: TagContent,
})
