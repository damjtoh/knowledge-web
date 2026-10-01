import type { ComponentType } from "react"
import Mermaid from "./mermaid"

/**
 * Shared component map for every compiled authored Markdown body.
 *
 * `remarkMermaid` turns each ```mermaid fence into `<Mermaid source="..." />`
 * in the compiled MDX. Supplying this map to the body renderer is what binds
 * that element to the local client renderer; no other Markdown element is
 * overridden, so standard HTML rendering stays in place.
 */
export const mdxComponents = { Mermaid } as const

/** Compiled MDX body that accepts the shared authored-Markdown map. */
export type MdxBody = ComponentType<{ components?: typeof mdxComponents }>
