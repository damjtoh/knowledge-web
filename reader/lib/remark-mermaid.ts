/**
 * Authored ```mermaid fences become one MDX component call.
 *
 * Standard Markdown keeps Mermaid diagrams as fenced code. This transformer
 * rewrites ONLY a fenced code node whose info string is `mermaid` into a
 * `<Mermaid source="..." />` MDX flow element, so the compiled body binds
 * the local client renderer. Every other fence (and its language) stays a
 * plain code block. The diagram text crosses as a plain string prop: no
 * author-provided JSX, imports, or expressions enter the compiled body.
 */

/** Minimal mdast node shape for the recursive walk. */
interface MermaidFenceNode {
  type: string
  lang?: string | null
  value?: string
  children?: MermaidFenceNode[]
}

interface MermaidJsxAttribute {
  type: "mdxJsxAttribute"
  name: string
  value: string
}

/** MDX flow element the compiler resolves through the shared component map. */
export interface MermaidJsxElement {
  type: "mdxJsxFlowElement"
  name: "Mermaid"
  attributes: MermaidJsxAttribute[]
  children: []
}

/** True when a code fence info string declares the mermaid language. */
export function isMermaidFence(lang: string | null | undefined): boolean {
  return (lang ?? "").trim().toLowerCase() === "mermaid"
}

/** One `<Mermaid source={source} />` element with the fence body as text. */
export function mermaidFenceElement(source: string): MermaidJsxElement {
  return {
    type: "mdxJsxFlowElement",
    name: "Mermaid",
    attributes: [{ type: "mdxJsxAttribute", name: "source", value: source }],
    children: [],
  }
}

/** Remark transformer: mermaid fences only, every other node untouched. */
export default function remarkMermaid(): (tree: MermaidFenceNode) => void {
  return (tree: MermaidFenceNode): void => {
    function visit(node: MermaidFenceNode): void {
      const children = node.children

      if (!children) return

      for (let index = 0; index < children.length; index += 1) {
        const child = children[index]

        if (child.type === "code" && isMermaidFence(child.lang)) {
          children[index] = mermaidFenceElement(child.value ?? "")
          continue
        }

        visit(child)
      }
    }

    visit(tree)
  }
}
