/**
 * Focused-test probe: compile one staged note through the reader's real
 * Markdown pipeline and render it with the real Mermaid component.
 *
 * The parent test runs this as a child process with `reader/` as the working
 * directory. `READER_CONTENT_DIR` points at a temporary staged tree;
 * `READER_ROOT`, `MDX_OUT_DIR`, and `DOC_PATH` name the reader checkout, the
 * compiled-config output directory, and the note to import.
 *
 * `fumadocs-mdx/node` is the supported Node loader entry: it compiles the
 * note with the reader's own `source.config.ts` (mermaid, wikilink, relative
 * link, and read-time transformers included). `react` and `react-dom/server`
 * resolve through the reader package; the parent supplies the tsx loader for
 * the `.tsx` import. The probe prints one JSON object on stdout: `{ html }`
 * on success, `{ error }` when rendering fails.
 */

import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const readerRoot = process.env.READER_ROOT

const contentDir = process.env.READER_CONTENT_DIR

const outDir = process.env.MDX_OUT_DIR

const docPath = process.env.DOC_PATH

if (!readerRoot || !contentDir || !outDir || !docPath) {
  throw new Error(
    "mermaid-render-probe requires READER_ROOT, READER_CONTENT_DIR, MDX_OUT_DIR, and DOC_PATH",
  )
}

const requireFromReader = createRequire(path.join(readerRoot, "package.json"))

const { register } = await import(
  pathToFileURL(requireFromReader.resolve("fumadocs-mdx/node")).href
)

register({
  configPath: path.join(readerRoot, "source.config.ts"),
  outDir,
})

const doc = await import(pathToFileURL(docPath).href)

const React = requireFromReader("react")

const { renderToStaticMarkup } = requireFromReader("react-dom/server")

const Mermaid = (
  await import(pathToFileURL(path.join(readerRoot, "components", "mermaid.tsx")).href)
).default

try {
  const html = renderToStaticMarkup(React.createElement(doc.default, { components: { Mermaid } }))

  process.stdout.write(JSON.stringify({ html }))
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String(error) }))
}
