import {
  relativeUpdatedAt,
  updatedAtFromData,
  type RelativeUpdatedAt,
  type UpdatedAtSource,
} from "../lib/last-edited"
import { readMinutesFromData, type ReadMinutesSource } from "../lib/reading-time"

/** Page data carrying both meta-line sources (date plus read minutes). */
export interface MetaLineData extends UpdatedAtSource, ReadMinutesSource {}

function normalizeMinutes(value: number | undefined): number | undefined {
  if (value === undefined) return undefined

  if (!Number.isFinite(value)) return undefined

  return Math.max(1, Math.round(value))
}

/**
 * Shared article meta line (design component HMIv8 "Article Meta Line").
 *
 * One row above the article title on every viewport: `{parent} • {N} min
 * read`, a 3px border-token dot, then `Updated {relative}`. Root notes
 * (no parent) drop the category segment and its dot, rendering `{N} min
 * read · Updated …`. Either segment omits itself gracefully when its
 * source is missing; both missing renders nothing (no freshness claim).
 * Utilities only: 11px is the text-2xs token, muted is
 * text-muted-foreground, the dot is bg-border. A div (not a paragraph)
 * keeps the unlayered `.reader-article p` margin rule from beating the
 * row, so no unlayered CSS is added for this component.
 */
export default function MetaLine({
  parentTitle,
  readMinutes,
  data,
}: {
  parentTitle?: string
  readMinutes?: number
  data: MetaLineData | null | undefined
}) {
  const relative: RelativeUpdatedAt | null = relativeUpdatedAt(updatedAtFromData(data))
  const fromData: number | undefined = readMinutesFromData(data)
  const minutes: number | undefined = normalizeMinutes(readMinutes) ?? fromData
  const category: string = parentTitle === undefined ? "" : parentTitle.trim()
  const hasCategory = category !== ""
  const hasMinutes = minutes !== undefined
  const hasFirst = hasCategory || hasMinutes

  if (!hasFirst && relative === null) return null

  let first = ""

  if (hasCategory && hasMinutes) first = `${category} • ${minutes} min read`
  else if (hasMinutes) first = `${minutes} min read`
  else first = category

  return (
    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
      {hasFirst ? <span>{first}</span> : null}
      {hasFirst && relative !== null ? (
        <span aria-hidden="true" className="size-0.75 shrink-0 rounded-full bg-border" />
      ) : null}
      {relative !== null ? (
        <time dateTime={relative.isoDatetime}>{`Updated ${relative.label}`}</time>
      ) : null}
    </div>
  )
}
