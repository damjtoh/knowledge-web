import fs from "node:fs"
import path from "node:path"
import { routeForSourcePath } from "./wiki-aliases"

interface MarkdownNode {
  type: string
  url?: string
  children?: MarkdownNode[]
}

/** Resolve Markdown links against their source file, not the exported page URL. */
export default function remarkRelativeLinks(contentDir: string) {
  const root = fs.realpathSync(contentDir)

  return (tree: MarkdownNode, file: { path: string }) => {
    const source = fs.realpathSync(
      path.isAbsolute(file.path) ? file.path : path.resolve(root, file.path),
    )

    function visit(node: MarkdownNode): void {
      if ((node.type === "link" || node.type === "definition") && node.url) {
        const match = /^([^?#]+\.mdx?)([?#].*)?$/i.exec(node.url)

        if (match && !path.isAbsolute(match[1]) && !/^[a-z][a-z\d+.-]*:/i.test(match[1])) {
          const target = path.resolve(path.dirname(source), match[1])

          if (fs.existsSync(target) && fs.statSync(target).isFile()) {
            const relative = path.relative(root, fs.realpathSync(target))

            if (
              relative !== "" &&
              relative !== ".." &&
              !relative.startsWith(`..${path.sep}`) &&
              !path.isAbsolute(relative)
            ) {
              node.url = `${routeForSourcePath(relative)}${match[2] ?? ""}`
            }
          }
        }
      }

      for (const child of node.children ?? []) visit(child)
    }

    visit(tree)
  }
}
