import { parseUpdatedAt, updatedAtFromData, type UpdatedAtSource } from "../lib/last-edited"

/**
 * Subdued Last edited line for a published note or authored folder.
 *
 * Display-only semantic HTML (no UI control): a muted paragraph with a
 * machine-readable `<time datetime>`. The text is the deterministic static
 * fallback (`YYYY-MM-DD HH:MM ZONE`); there is no client-local rewrite, so
 * the static export, hydration, and offline copies all show the same
 * source instant. Returns null for missing or invalid timestamps and for
 * virtual folders (which pass no authored data), leaving absence visible
 * instead of guessing freshness. Never describes sync or drift.
 */
export default function LastEdited({ data }: { data: UpdatedAtSource | null | undefined }) {
  const parsed = parseUpdatedAt(updatedAtFromData(data))

  if (!parsed) return null

  return (
    <p className="reader-last-edited">
      Last edited <time dateTime={parsed.isoDatetime}>{parsed.display}</time>
    </p>
  )
}
