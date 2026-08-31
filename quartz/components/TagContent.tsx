import { QuartzComponent, QuartzComponentProps } from "./types"
import { PageList } from "./PageList"
import { FullSlug, resolveRelative } from "../util/path"
import { i18n, ValidLocale } from "../i18n"
import { QuartzPluginData } from "../plugins/vfile"
import { getPagesForTag, getSortedTagsByCount, getTagCounts } from "../util/tags"

const TagContent: QuartzComponent = (props: QuartzComponentProps) => {
  const { fileData, allFiles, cfg, tree } = props
  const slug = (fileData.slug ?? "") as string
  if (!slug.startsWith("tags/")) return null

  const tag = slug.slice("tags/".length)
  const locale = (cfg.locale ?? "en-US") as ValidLocale

  const visibleFiles = (allFiles as QuartzPluginData[]).filter(
    (f) => (f as unknown as { unlisted?: unknown }).unlisted !== true,
  )

  // Tag index page: slug is tags/index
  if (tag === "index") {
    const counts = getTagCounts(visibleFiles)
    const sorted = getSortedTagsByCount(counts)

    // Minimal content rendering: if the virtual page had authored markdown,
    // its tree would contain hast nodes; otherwise show nothing extra.
    // For MVP we ignore tree content and focus on the listing.

    return (
      <div class="popover-hint">
        <article>
          <h1>{i18n(locale).pages.tagContent.tagIndex}</h1>
          <p>{i18n(locale).pages.tagContent.totalTags({ count: sorted.length })}</p>
          {sorted.length === 0 ? (
            <p>No tags yet.</p>
          ) : (
            <ul>
              {sorted.map(({ tag: t, count }) => (
                <li>
                  <a
                    class="internal tag-link"
                    href={resolveRelative(slug as FullSlug, `tags/${t}` as FullSlug)}
                  >
                    {t}
                  </a>
                  <span> ({count})</span>
                </li>
              ))}
            </ul>
          )}
        </article>
        {/* Render any authored description if present */}
        {tree && (tree as unknown as { children?: unknown[] })?.children?.length ? (
          <div class="markdown-preview-view">{/* authored content would be here */}</div>
        ) : null}
      </div>
    )
  }

  // Individual tag page
  const pages = getPagesForTag(visibleFiles, tag)
  const listProps = {
    ...props,
    allFiles: pages,
  }

  return (
    <div class="popover-hint">
      <article>
        <h1>{tag}</h1>
        <p>{i18n(locale).pages.tagContent.itemsUnderTag({ count: pages.length })}</p>
      </article>
      <div class="page-listing">
        <div>{PageList(listProps as unknown as QuartzComponentProps)}</div>
      </div>
    </div>
  )
}

TagContent.css = PageList.css

export default (() => TagContent) satisfies import("./types").QuartzComponentConstructor
