import type { Crumb } from "../lib/navigation"
import type { AdjacentNotes } from "../lib/adjacent-notes"
import type { TocItem } from "../lib/toc"
import MetaLine, { type MetaLineData } from "./last-edited"
import { NoteCrumbs } from "./breadcrumbs"
import { NoteTocAside, NoteTocDetails } from "./note-toc"
import NotePager from "./note-pager"
import OtherNotes, { type SiblingNote } from "./other-notes"
import { mdxComponents, type MdxBody } from "./mdx-components"
import { readMinutesFromData } from "../lib/reading-time"

/**
 * Leaf note page: phone slash trail, shared meta line above the title (the
 * title lives inside the MDX body h1, so above the title means before
 * Body), the "On this page" block below xl, the authored body, previous
 * and next links, and the Other notes section. From xl the table of
 * contents sits in a sticky aside right of the article.
 *
 * Authored Markdown owns the Typeset scope; crumbs, meta, table of
 * contents, and siblings stay outside so Typeset never styles React chrome.
 */
export default function NotePage({
  crumbs,
  parentTitle,
  metaSource,
  Body,
  toc,
  adjacent,
  siblings,
}: {
  crumbs: Crumb[]
  parentTitle: string | undefined
  metaSource: MetaLineData
  Body: MdxBody
  toc: TocItem[]
  adjacent: AdjacentNotes
  siblings: SiblingNote[]
}) {
  return (
    <div className="xl:flex xl:items-start xl:gap-8">
      <article className="reader-article xl:flex-1">
        <NoteCrumbs crumbs={crumbs} />
        <MetaLine
          parentTitle={parentTitle}
          readMinutes={readMinutesFromData(metaSource)}
          data={metaSource}
        />
        <NoteTocDetails items={toc} />
        <div className="typeset">
          <Body components={mdxComponents} />
        </div>
        <NotePager previous={adjacent.previous} next={adjacent.next} />
        <OtherNotes parentTitle={parentTitle} siblings={siblings} />
      </article>
      <NoteTocAside items={toc} />
    </div>
  )
}
