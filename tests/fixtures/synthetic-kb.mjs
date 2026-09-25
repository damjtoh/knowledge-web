/**
 * Canonical synthetic Knowledge Base fixture for reader browser tests.
 *
 * One neutral corpus covers every journey shape: an authored root index with
 * an introduction, an authored folder with children, a deep nested note, a
 * virtual folder without an index, a standalone direct note, a long-title
 * note, a staged-but-unnavigated hidden note, and notes with valid (`Z`,
 * `+02:00`) plus invalid (date-only, Feb-30) `updated_at` stamps. The
 * Publication Manifest declares the title, canonical hostname, allowlist,
 * ordered navigation roots, and two HTTPS projection destinations.
 *
 * `writeSyntheticKb` only writes files; staging stays with the harness
 * (`tests/helpers/reader-env.mjs`) so items 02-03 own the build.
 */

import fs from "node:fs"
import path from "node:path"

export const SYNTHETIC_TITLE = "Synthetic Garden"

export const SYNTHETIC_HOSTNAME = "synthetic.example.com"

export const LONG_TITLE =
  "An extremely long packing checklist title that keeps going SupercalifragilisticexpialidociousSupercalifragilisticexpialidocious"

export const LONG_SLUG = "long-packing-checklist-title-that-keeps-going-for-wrapping-probes"

/** Never selected: proves the allowlist keeps private material out of staging. */
export const UNSELECTED_SENTINEL = "SYNTHETIC_FIXTURE_UNSELECTED_7Q2X"

/** Ordered visible reader roots (manifest navigation order). */
export const SYNTHETIC_NAVIGATION = ["standalone.md", "orchard", "notes", "garden"]

/** Owner-declared cross-origin destinations (docs/manifest.md shape). */
export const SYNTHETIC_DESTINATIONS = [
  { name: "Personal Garden", origin: "https://personal.example.com" },
  { name: "Shared Garden", origin: "https://shared.example.com" },
]

/** Staged through the allowlist but kept out of navigation. */
export const HIDDEN_NOTE_PATH = "hidden/secret.md"

/** Never allowlisted: must never reach staged content. */
export const UNSELECTED_NOTE_PATH = "unselected.md"

export function writeFile(root, rel, content) {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

/** Write the canonical corpus into an existing directory; returns the root. */
export function writeSyntheticKb(kbRoot) {
  writeFile(
    kbRoot,
    "index.md",
    [
      "---",
      'title: "Synthetic Garden Home"',
      "---",
      "",
      "# Synthetic Garden Home",
      "",
      "Welcome to the canonical synthetic garden.",
      "",
    ].join("\n"),
  )
  writeFile(
    kbRoot,
    "garden/index.md",
    "# Garden Plots\n\nCultivated beds with an authored introduction.\n",
  )
  writeFile(kbRoot, "garden/alpha.md", "# Alpha Bed\n\nFirst bed.\n")
  writeFile(kbRoot, "garden/beta.md", "# Beta Bed\n\nSecond bed.\n")
  writeFile(
    kbRoot,
    "notes/guide.md",
    [
      "---",
      'title: "Field Guide"',
      "---",
      "",
      "# Ignored H1",
      "",
      "Wide table:",
      "",
      "| Day | Morning | Midday | Afternoon | Evening | Night | Cost | Notes |",
      "|---|---|---|---|---|---|---|---|",
      "| One | Kayak | Lunch | Trek | Dinner | Sleep | 85 € | Long day |",
      "",
      "- [ ] open task",
      "- [x] done task",
      "",
      "```js",
      "const alias = '[[Field Guide]]';",
      "```",
      "",
      "See [[Plain Meadow]] and [[Missing Page]].",
      "",
      "See https://example.com/field-guide for details.",
      "",
      "![Meadow view](https://example.com/photos/very-wide-panoramic-meadow-view.jpg)",
      "",
    ].join("\n"),
  )
  writeFile(
    kbRoot,
    "notes/plain.md",
    "# Plain Meadow\n\nJust a body.\n\n## Details\n\nSection content.\n",
  )
  writeFile(kbRoot, "notes/nest/inner/leaf.md", "# Inner Leaf\n\nDeep nested note.\n")
  writeFile(kbRoot, `notes/${LONG_SLUG}.md`, `# ${LONG_TITLE}\n\nPack light.\n`)
  writeFile(
    kbRoot,
    "notes/valid-z.md",
    [
      "---",
      'title: "Valid Zulu"',
      'updated_at: "2026-08-27T05:49:53.387Z"',
      "---",
      "",
      "# Valid Zulu",
      "",
      "Note with a Zulu timestamp.",
      "",
    ].join("\n"),
  )
  writeFile(
    kbRoot,
    "notes/valid-offset.md",
    [
      "---",
      'title: "Valid Offset"',
      'updated_at: "2026-09-20T14:30:00+02:00"',
      "---",
      "",
      "# Valid Offset",
      "",
      "Note with a positive offset.",
      "",
    ].join("\n"),
  )
  writeFile(
    kbRoot,
    "notes/date-only.md",
    ["---", 'title: "Date Only"', 'updated_at: "2026-09-20"', "---", "", "# Date Only", ""].join(
      "\n",
    ),
  )
  writeFile(
    kbRoot,
    "notes/feb-thirty.md",
    [
      "---",
      'title: "Feb Thirty"',
      'updated_at: "2026-02-30T10:00:00Z"',
      "---",
      "",
      "# Feb Thirty",
      "",
    ].join("\n"),
  )

  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(2, "0")
    writeFile(kbRoot, `orchard/note-${n}.md`, `# Orchard Note ${n}\n\nFlat orchard note ${n}.\n`)
  }

  writeFile(kbRoot, "standalone.md", "# Lone Pine\n\nStandalone file.\n")
  writeFile(kbRoot, "assets/photo.png", "not-a-real-png")
  writeFile(
    kbRoot,
    HIDDEN_NOTE_PATH,
    "# Hidden Draft\n\nStaged through the allowlist but kept out of navigation.\n",
  )
  writeFile(
    kbRoot,
    UNSELECTED_NOTE_PATH,
    `# Unselected\n\n${UNSELECTED_SENTINEL} must never appear.\n`,
  )
  writeFile(
    kbRoot,
    "publication.manifest.yaml",
    [
      `title: ${SYNTHETIC_TITLE}`,
      `canonicalHostname: ${SYNTHETIC_HOSTNAME}`,
      "select:",
      "  - index.md",
      "  - garden",
      "  - notes",
      "  - orchard",
      "  - standalone.md",
      "  - assets",
      "  - hidden",
      "navigation:",
      ...SYNTHETIC_NAVIGATION.map((entry) => `  - ${entry}`),
      "destinations:",
      ...SYNTHETIC_DESTINATIONS.flatMap((entry) => [
        `  - name: ${entry.name}`,
        `    origin: ${entry.origin}`,
      ]),
      "",
    ].join("\n"),
  )

  return kbRoot
}
