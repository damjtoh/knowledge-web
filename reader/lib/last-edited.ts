/**
 * Trustworthy Last edited source for published notes and authored folders.
 *
 * The sole source is the staged Markdown frontmatter `updated_at` value
 * exposed by the headless content loader (`page.data.updated_at`). No
 * `created_at`, copied-file mtime, or build time is read here. Missing,
 * invalid, date-only, or naive values return null so callers omit the line
 * instead of guessing freshness.
 *
 * The static display is deterministic: it reuses the source wall time and
 * an explicit zone label (`UTC` or `UTC±HH:MM`) without consulting the
 * build or viewer timezone. The machine-readable `datetime` carries the
 * same instant as canonical UTC ISO. There is no client-local enhancement;
 * the static text is the sole display, so hydration and offline copies
 * cannot drift.
 */

/** Parsed edit instant with deterministic static text. */
export interface LastEdited {
  /** Canonical UTC ISO for `<time datetime>`. */
  isoDatetime: string
  /** Deterministic visible text: `YYYY-MM-DD HH:MM ZONE`. */
  display: string
}

/** Loader page data carrying the named frontmatter field. */
export interface UpdatedAtSource {
  title?: string
  updated_at?: string | Date | null
}

/** Decoded frontmatter value before strict validation. */
export type UpdatedAtInput = string | Date | null | undefined

const OFFSET_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|z|[+-]\d{2}:?\d{2}|[+-]\d{2})$/

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function normalizeZone(rawZone: string): string | null {
  if (/^[Zz]$/.test(rawZone)) return "UTC"
  const compact = rawZone.replace(":", "")
  const sign = compact.charAt(0)
  const digits = compact.slice(1)

  if (sign !== "+" && sign !== "-") return null

  if (digits.length === 2) return `UTC${sign}${digits}:00`

  if (digits.length === 4) {
    const hours = Number(digits.slice(0, 2))
    const minutes = Number(digits.slice(2, 4))

    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null

    if (hours > 14 || minutes > 59) return null

    return `UTC${sign}${pad2(hours)}:${pad2(minutes)}`
  }

  return null
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28

  if (month === 4 || month === 6 || month === 9 || month === 11) return 30

  return 31
}

function rangeValid(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12) return false

  // Reject impossible calendar dates outright: Date.parse normalizes
  // overflow (e.g. Feb 30 becomes Mar 2), which would invent a day.
  if (day < 1 || day > daysInMonth(year, month)) return false

  if (hour > 23 || minute > 59 || second > 60) return false

  return true
}

/**
 * Parse a frontmatter `updated_at` value.
 *
 * Accepts only timezone-aware ISO strings (`Z` or numeric offset with an
 * explicit hour and minute). Date objects are never rendered: a Date
 * cannot prove the source included a time and timezone (a YAML date-only
 * value decodes to fake UTC midnight), so rendering one would guess
 * freshness. Returns null for missing, date-only, naive, or invalid
 * calendar values.
 */
export function parseUpdatedAt(value: UpdatedAtInput): LastEdited | null {
  // A Date carries an instant but no proof of source time and zone, so it
  // is omitted rather than displayed as a precise-looking edit time.
  if (value instanceof Date) return null

  if (String(value) !== value) return null

  // SAFETY: the string check above narrows null/undefined away; this holds the ISO text.
  const text = (value as string).trim()

  if (text === "") return null

  const match = OFFSET_TIME_RE.exec(text)

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])

  if (!rangeValid(year, month, day, hour, minute, second)) return null

  const zone = normalizeZone(match[8])

  if (zone === null) return null

  const millis = Date.parse(text)

  if (!Number.isFinite(millis)) return null

  const display = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]} ${zone}`

  return { isoDatetime: new Date(millis).toISOString(), display }
}

/**
 * Read the `updated_at` field from loader page data.
 *
 * Returns the raw value without interpreting any other frontmatter field.
 * `created_at` is never consulted here.
 */
export function updatedAtFromData(data: UpdatedAtSource | null | undefined): UpdatedAtInput {
  if (data === null || data === undefined) return undefined

  return data.updated_at ?? undefined
}

/** Valid edit instant with its relative label for the meta line. */
export interface RelativeUpdatedAt {
  /** Canonical UTC ISO for `<time datetime>`. */
  isoDatetime: string
  /** Relative label without the "Updated" prefix (`2 days ago`, `just now`). */
  label: string
}

/**
 * Strict instant millis for a frontmatter `updated_at` value.
 *
 * Reuses the same timezone-aware validation as the absolute display, so
 * only values worth rendering get a relative label. Returns null for
 * missing, date-only, naive, or invalid calendar values.
 */
export function updatedAtMillis(value: UpdatedAtInput): number | null {
  const parsed: LastEdited | null = parseUpdatedAt(value)

  if (parsed === null) return null
  const millis: number = Date.parse(parsed.isoDatetime)

  if (!Number.isFinite(millis)) return null

  return millis
}

/**
 * Relative edit label for a frontmatter `updated_at` value.
 *
 * Design wording is relative (`Updated 2 days ago`): under a minute reads
 * `just now`, then minutes, hours, days, 30-day months, and 365-day years
 * with singular/plural agreement. Future instants clamp to `just now`
 * rather than rendering a negative duration. Returns null when the value
 * is not worth rendering (same strictness as the absolute display).
 */
export function formatRelativeUpdatedAt(
  value: UpdatedAtInput,
  nowMillis: number = Date.now(),
): string | null {
  const millis: number | null = updatedAtMillis(value)

  if (millis === null) return null
  const elapsed: number = nowMillis - millis < 0 ? 0 : nowMillis - millis
  const seconds: number = Math.floor(elapsed / 1000)

  if (seconds < 60) return "just now"
  const minutes: number = Math.floor(seconds / 60)

  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`
  const hours: number = Math.floor(minutes / 60)

  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`
  const days: number = Math.floor(hours / 24)

  if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`
  const months: number = Math.floor(days / 30)

  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`
  const years: number = Math.floor(days / 365)

  return years === 1 ? "1 year ago" : `${years} years ago`
}

/**
 * Machine time plus relative label for a frontmatter `updated_at` value.
 *
 * Returns null when the value is not worth rendering.
 */
export function relativeUpdatedAt(
  value: UpdatedAtInput,
  nowMillis: number = Date.now(),
): RelativeUpdatedAt | null {
  const parsed: LastEdited | null = parseUpdatedAt(value)

  if (parsed === null) return null
  const label: string | null = formatRelativeUpdatedAt(value, nowMillis)

  if (label === null) return null

  return { isoDatetime: parsed.isoDatetime, label }
}
