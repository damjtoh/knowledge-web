"use client"

import { useEffect, useId, useState } from "react"
import {
  accessibleNameFor,
  nextMermaidRenderId,
  renderMermaidDiagram,
  type MermaidAppearance,
} from "../lib/mermaid"

interface MermaidProps {
  /** Diagram source authored in the Markdown fence. */
  source: string
}

type RenderState =
  { status: "pending" } | { status: "rendered"; svg: string } | { status: "failed" }

function readAppearance(): MermaidAppearance {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

/**
 * Local client Mermaid renderer for authored ```mermaid fences.
 *
 * The server render (and the pre-effect client render) shows the escaped
 * diagram source, so the page stays readable without JavaScript and while
 * the renderer loads. Mermaid is imported dynamically in the effect: only
 * pages carrying a diagram fetch the renderer chunk, and the fetch is local
 * to the static export. The document root `.dark` class is observed so
 * Light/Dark/System changes re-render, and a stale attempt never overwrites
 * a newer one. A failed render falls back to the same escaped source; it
 * never breaks the page or its valid neighbors.
 */
export default function Mermaid({ source }: MermaidProps) {
  const reactId = useId()
  const [appearance, setAppearance] = useState<MermaidAppearance | null>(null)
  const [state, setState] = useState<RenderState>({ status: "pending" })

  useEffect(() => {
    const root = document.documentElement

    setAppearance(readAppearance())

    // The appearance provider stays the only theme owner: we follow the
    // resolved root class instead of changing its public contract.
    const observer = new MutationObserver(() => {
      const next = readAppearance()

      setAppearance((current) => (current === next ? current : next))
    })

    observer.observe(root, { attributes: true, attributeFilter: ["class"] })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (appearance === null) return

    let cancelled = false

    renderMermaidDiagram({ id: nextMermaidRenderId(reactId), source, appearance })
      .then((svg) => {
        if (cancelled) return

        setState({ status: "rendered", svg })
      })
      .catch(() => {
        if (cancelled) return

        setState({ status: "failed" })
      })

    return () => {
      cancelled = true
    }
  }, [appearance, reactId, source])

  const label = accessibleNameFor(source)

  return (
    <figure data-mermaid="" aria-label={label} className="my-6 max-w-full">
      <div
        data-mermaid-viewport=""
        className="max-w-full overflow-x-auto overscroll-x-contain rounded-md border border-border"
      >
        {state.status === "rendered" ? (
          <div
            data-mermaid-svg=""
            className="[&_svg]:block [&_svg]:max-w-none"
            /* Mermaid strict sanitizes this SVG with DOMPurify and disables
               author callbacks. The string is renderer output, never author
               HTML: no author markup or script reaches this assignment. */
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        ) : (
          <div data-mermaid-source="">
            {state.status === "failed" ? (
              <p
                className="m-0 border-b border-border px-3 py-2 text-xs text-muted-foreground"
                role="status"
              >
                This diagram could not be rendered. Its source is shown instead.
              </p>
            ) : null}
            <pre className="m-0 max-w-full overflow-x-auto p-3 text-xs">
              <code>{source}</code>
            </pre>
          </div>
        )}
      </div>
    </figure>
  )
}
