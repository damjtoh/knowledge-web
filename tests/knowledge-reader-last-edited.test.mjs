/**
 * Trustworthy Last edited time on notes (item 06).
 *
 * Focused seam: valid timezone-aware `updated_at` from staged Markdown
 * renders a subdued Last edited line with date, hour, minute, an explicit
 * zone, and a machine-readable `<time datetime>`. Missing, invalid, date-only, naive,
 * `created_at`-only, mtime, and build-time values never create a label;
 * virtual folders never guess one. The static text is deterministic and
 * offline-stable; it never describes sync or drift. Source Markdown stays
 * byte-for-byte.
 *
 * The browser half (Last edited renders for valid authored timestamps,
 * absent for invalid/virtual, offline page carries the same timestamp)
 * lives in the desktop backbone journey; only the parseUpdatedAt unit test
 * stays here.
 *
 * Run with: pnpm test -- tests/knowledge-reader-last-edited.test.mjs
 */

import assert from "node:assert/strict"
import { test } from "node:test"
import {
  formatRelativeUpdatedAt,
  parseUpdatedAt,
  relativeUpdatedAt,
  updatedAtFromData,
} from "../reader/lib/last-edited.ts"
import {
  estimateReadMinutes,
  readMinutesFromData,
  default as remarkReadingTime,
} from "../reader/lib/reading-time.ts"

test("parseUpdatedAt accepts only timezone-aware instants with a stable zone display", () => {
  const offset = parseUpdatedAt("2026-09-20T14:30:00+02:00")
  assert.ok(offset, "offset-aware value parses")
  assert.equal(offset.display, "2026-09-20 14:30 UTC+02:00")
  assert.equal(offset.isoDatetime, "2026-09-20T12:30:00.000Z")

  const utc = parseUpdatedAt("2026-08-27T05:49:53.387Z")
  assert.ok(utc, "Zulu value parses")
  assert.equal(utc.display, "2026-08-27 05:49 UTC")
  assert.equal(utc.isoDatetime, "2026-08-27T05:49:53.387Z")

  const neg = parseUpdatedAt("2026-09-06T08:15:04-05:00")
  assert.ok(neg, "negative offset parses")
  assert.equal(neg.display, "2026-09-06 08:15 UTC-05:00")
  assert.equal(neg.isoDatetime, "2026-09-06T13:15:04.000Z")

  const compact = parseUpdatedAt("2026-09-20T14:30:00+0200")
  assert.ok(compact, "compact offset parses")
  assert.equal(compact.display, "2026-09-20 14:30 UTC+02:00")

  const noSeconds = parseUpdatedAt("2026-09-20T14:30+02:00")
  assert.ok(noSeconds, "minute precision parses")
  assert.equal(noSeconds.display, "2026-09-20 14:30 UTC+02:00")

  const leap = parseUpdatedAt("2024-02-29T10:00:00Z")
  assert.ok(leap, "leap-day parses")
  assert.equal(leap.display, "2024-02-29 10:00 UTC")

  // A Date cannot prove the source included a time and timezone (a YAML
  // date-only value decodes to fake UTC midnight), so Dates never render.
  assert.equal(
    parseUpdatedAt(new Date("2026-09-20T12:30:00.000Z")),
    null,
    "rejects valid Date objects",
  )
  assert.equal(parseUpdatedAt(new Date("invalid")), null, "rejects invalid Date")

  for (const bad of [
    undefined,
    null,
    "",
    "   ",
    "not-a-date",
    "2026-09-20",
    "2026-09-20T14:30:00",
    "2026-09-20 14:30:00+02:00",
    "2026-13-01T00:00:00Z",
    "2026-09-20T25:00:00Z",
    "2026-02-30T10:00:00Z",
    "2026-02-29T10:00:00Z",
    "2026-04-31T10:00:00Z",
    "2026-09-20T14:30:00+15:00",
    "2026-09-20T14:30:00+02:60",
    1727265000000,
    true,
  ]) {
    // SAFETY: focused unit check passes non-domain values to prove rejection at runtime.
    assert.equal(parseUpdatedAt(bad), null, `rejects ${JSON.stringify(String(bad))}`)
  }

  // Deterministic: the same source renders the same wall time and zone,
  // never a viewer-local conversion.
  assert.equal(
    parseUpdatedAt("2026-09-20T14:30:00+02:00").display,
    "2026-09-20 14:30 UTC+02:00",
    "offset wall time is preserved, not converted to UTC",
  )

  // Only the named field is read; created_at never supplies a label.
  assert.equal(updatedAtFromData({ title: "Note" }), undefined)
  assert.equal(updatedAtFromData(null), undefined)
  assert.equal(updatedAtFromData(undefined), undefined)
  assert.equal(
    updatedAtFromData({ updated_at: "2026-09-20T14:30:00+02:00" }),
    "2026-09-20T14:30:00+02:00",
  )
})

test("formatRelativeUpdatedAt renders design-relative labels with the same strictness", () => {
  const instant = Date.parse("2026-09-20T12:30:00.000Z")

  assert.equal(
    formatRelativeUpdatedAt("2026-09-20T14:30:00+02:00", instant + 30 * 1000),
    "just now",
  )
  assert.equal(
    formatRelativeUpdatedAt("2026-09-20T14:30:00+02:00", instant + 2 * 60 * 1000),
    "2 minutes ago",
  )
  assert.equal(
    formatRelativeUpdatedAt("2026-09-20T14:30:00+02:00", instant + 60 * 60 * 1000),
    "1 hour ago",
  )
  assert.equal(
    formatRelativeUpdatedAt("2026-09-20T14:30:00+02:00", instant + 2 * 24 * 60 * 60 * 1000),
    "2 days ago",
  )
  assert.equal(
    formatRelativeUpdatedAt("2026-09-20T14:30:00+02:00", instant - 1000),
    "just now",
    "future instants clamp instead of rendering negative durations",
  )

  // Same strictness as the absolute display: date-only, naive, and
  // impossible values never get a label.
  for (const bad of ["2026-09-20", "2026-09-20T14:30:00", "2026-02-30T10:00:00Z"]) {
    assert.equal(formatRelativeUpdatedAt(bad, instant), null, `rejects ${bad}`)
  }

  const relative = relativeUpdatedAt("2026-09-20T14:30:00+02:00", instant + 2 * 24 * 60 * 60 * 1000)

  assert.equal(relative?.isoDatetime, "2026-09-20T12:30:00.000Z")
  assert.equal(relative?.label, "2 days ago")
  assert.equal(relativeUpdatedAt("2026-09-20", instant), null)
})

test("read-time heuristic counts words at 200wpm with a one-minute floor", () => {
  assert.equal(estimateReadMinutes(0), 1, "empty pages read one minute")
  assert.equal(estimateReadMinutes(7), 1, "short notes read one minute")
  assert.equal(estimateReadMinutes(200), 1, "200 words read one minute")
  assert.equal(estimateReadMinutes(300), 2, "300 words read two minutes")
  assert.equal(estimateReadMinutes(2000), 10, "long pages scale linearly")

  assert.equal(readMinutesFromData({ read_minutes: 3 }), 3)
  assert.equal(readMinutesFromData({ read_minutes: "2" }), 2)
  assert.equal(readMinutesFromData({ read_minutes: 0 }), 1, "zero clamps to the floor")
  assert.equal(readMinutesFromData({}), undefined)
  assert.equal(readMinutesFromData(null), undefined)
  assert.equal(readMinutesFromData({ read_minutes: "lots" }), undefined)

  // The remark plugin writes parsed frontmatter idempotently: reruns
  // overwrite the same value instead of accumulating.
  const tree = {
    type: "root",
    children: [{ type: "paragraph", children: [{ type: "text", value: "one two three" }] }],
  }

  const file = { data: { frontmatter: {} } }

  const transform = remarkReadingTime()

  transform(tree, file)
  assert.equal(file.data.frontmatter.read_minutes, 1)
  transform(tree, file)
  assert.equal(file.data.frontmatter.read_minutes, 1, "rebuilds do not double-inject")
})
