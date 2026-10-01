/**
 * Mermaid client-rendering helpers: secure config, accessible names, a
 * unique render id per attempt, and one serialized initialize+render queue.
 *
 * `mermaid.initialize` writes shared module state and `mermaid.render` reads
 * that state, so an initialize/render pair from two diagrams or two themes
 * could interleave. Every render here runs inside one promise chain, and the
 * config is re-initialized immediately before its own render, so a diagram
 * never renders under another diagram's theme.
 *
 * The config keeps mermaid strict and non-negotiable from authored content:
 * `securityLevel: "strict"` encodes labels and disables click callbacks,
 * `suppressErrorRendering` keeps the stray "Syntax error" SVG out of the
 * page, and the `secure` list (plus `htmlLabels`) keeps init directives and
 * diagram frontmatter from changing those keys. Mermaid still applies its
 * own DOMPurify pass to the rendered SVG.
 */

import type { MermaidConfig } from "mermaid"

export type MermaidAppearance = "light" | "dark"

/** Keys an authored init directive or frontmatter may never change. */
export const MERMAID_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "maxEdges",
  "suppressErrorRendering",
  "htmlLabels",
] as const

/**
 * Diagram Option keys that own a `useMaxWidth` switch. Mermaid defaults it
 * true, which stretches every SVG to 100% of its container: wide diagrams
 * would shrink to unreadable text instead of scrolling locally. Turning it
 * off keeps each diagram at its natural size inside the overflow container.
 */
type DiagramOptionsKey =
  | "flowchart"
  | "sequence"
  | "gantt"
  | "journey"
  | "timeline"
  | "class"
  | "state"
  | "er"
  | "pie"
  | "quadrantChart"
  | "xyChart"
  | "requirement"
  | "architecture"
  | "mindmap"
  | "ishikawa"
  | "kanban"
  | "gitGraph"
  | "c4"
  | "sankey"
  | "packet"
  | "block"
  | "eventmodeling"
  | "treeView"
  | "radar"
  | "usecase"
  | "venn"
  | "wardley-beta"
  | "cynefin"
  | "railroad"

const NATURAL_SIZE_DIAGRAMS: Pick<MermaidConfig, DiagramOptionsKey> = {
  flowchart: { useMaxWidth: false, htmlLabels: false },
  sequence: { useMaxWidth: false },
  gantt: { useMaxWidth: false },
  journey: { useMaxWidth: false },
  timeline: { useMaxWidth: false },
  class: { useMaxWidth: false },
  state: { useMaxWidth: false },
  er: { useMaxWidth: false },
  pie: { useMaxWidth: false },
  quadrantChart: { useMaxWidth: false },
  xyChart: { useMaxWidth: false },
  requirement: { useMaxWidth: false },
  architecture: { useMaxWidth: false },
  mindmap: { useMaxWidth: false },
  ishikawa: { useMaxWidth: false },
  kanban: { useMaxWidth: false },
  gitGraph: { useMaxWidth: false },
  c4: { useMaxWidth: false },
  sankey: { useMaxWidth: false },
  packet: { useMaxWidth: false },
  block: { useMaxWidth: false },
  eventmodeling: { useMaxWidth: false },
  treeView: { useMaxWidth: false },
  radar: { useMaxWidth: false },
  usecase: { useMaxWidth: false },
  venn: { useMaxWidth: false },
  "wardley-beta": { useMaxWidth: false },
  cynefin: { useMaxWidth: false },
  railroad: { useMaxWidth: false },
}

/** Strict, deterministic config for one appearance. */
export function buildMermaidConfig(appearance: MermaidAppearance): MermaidConfig {
  return {
    ...NATURAL_SIZE_DIAGRAMS,
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    secure: [...MERMAID_SECURE_KEYS],
    htmlLabels: false,
    theme: appearance === "dark" ? "dark" : "default",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  }
}

/** First authored `accTitle:` line, trimmed, or null. */
export function accTitleFrom(source: string): string | null {
  const match = /^[ \t]*accTitle[ \t]*:[ \t]*(.+?)[ \t]*$/im.exec(source)

  return match ? match[1] : null
}

/**
 * First authored `accDescr:` value or the first line of an `accDescr { ... }`
 * block, trimmed, or null.
 */
export function accDescrFrom(source: string): string | null {
  const inline = /^[ \t]*accDescr[ \t]*:[ \t]*(.+?)[ \t]*$/im.exec(source)

  if (inline) return inline[1]

  const block = /^[ \t]*accDescr[ \t]*\{[ \t]*\r?\n?([\s\S]*?)\}/im.exec(source)

  if (!block) return null

  for (const line of block[1].split(/\r?\n/)) {
    const trimmed = line.trim()

    if (trimmed !== "") return trimmed
  }

  return null
}

/**
 * Accessible name for the diagram container. Authored accTitle/accDescr
 * wins; the generic fallback keeps every diagram named for assistive
 * technology.
 */
export function accessibleNameFor(source: string): string {
  return accTitleFrom(source) ?? accDescrFrom(source) ?? "Mermaid diagram"
}

let renderCounter = 0

/** Unique, selector-safe render id; mermaid ids cannot repeat on one page. */
export function nextMermaidRenderId(reactId: string): string {
  renderCounter += 1
  const safe = reactId.replace(/[^a-zA-Z0-9_-]/g, "")

  return `reader-mermaid-${safe === "" ? "diagram" : safe}-${renderCounter}`
}

let renderQueue: Promise<unknown> = Promise.resolve()

export interface MermaidRenderRequest {
  id: string
  source: string
  appearance: MermaidAppearance
}

/**
 * Render one diagram as an SVG string. Calls run serially: each attempt
 * initializes the strict config for its own appearance immediately before
 * its render. A failed attempt rejects without touching the page.
 */
export function renderMermaidDiagram({
  id,
  source,
  appearance,
}: MermaidRenderRequest): Promise<string> {
  const attempt = renderQueue.then(async () => {
    const { default: mermaid } = await import("mermaid")

    mermaid.initialize(buildMermaidConfig(appearance))
    const { svg } = await mermaid.render(id, source)

    return svg
  })

  // Failures stay with their caller; the queue itself always continues.
  renderQueue = attempt.then(
    () => undefined,
    () => undefined,
  )

  return attempt
}
