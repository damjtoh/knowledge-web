import fs from "node:fs"
import path from "node:path"

// Title, route, and alias map for the maintained wikilink plugin.
// The plugin owns target, label, and heading syntax; this module maps metadata only.
export function routeForSourcePath(p: string): string {
  const posix = p.replace(/\\/g, "/")
  const base = posix.split("/").pop() ?? posix

  if (/^index\.mdx?$/i.test(base)) {
    const dir = posix.slice(0, Math.max(0, posix.length - base.length - 1))

    return dir === "" ? "/" : `/${dir}`
  }

  return `/${posix.replace(/\.mdx?$/i, "")}`
}

export function normalizeAlias(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ")
}

function splitFm(raw: string): { data: string; body: string } {
  const text = String(raw ?? "").replace(/\r\n/g, "\n")
  const lines = text.split("\n")

  if (lines[0]?.trim() !== "---") return { data: "", body: text }
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---")

  if (close === -1) return { data: "", body: text }

  return { data: lines.slice(1, close).join("\n"), body: lines.slice(close + 1).join("\n") }
}

function fmTitle(data: string): string {
  const m = data.match(/^title:\s*(.+?)\s*$/m)

  if (!m) return ""
  let v = m[1].trim()

  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1)
  const t = v.trim()

  if (t === "" || t.toLowerCase() === "null" || t === "~") return ""

  return t
}

function firstH1(body: string): string {
  let fenced = false

  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }

    if (fenced) continue
    const m = line.match(/^#\s+(.+?)\s*$/)

    if (m) return m[1].trim()
  }

  return ""
}

export function titleForContent(raw: string, fallback: string): string {
  const { data, body } = splitFm(raw)

  return fmTitle(data) || firstH1(body) || fallback
}

function fallbackFor(rel: string): string {
  const posix = rel.replace(/\\/g, "/")
  const base = posix.split("/").pop() ?? posix

  if (/^index\.mdx?$/i.test(base)) {
    const dir = posix.slice(0, Math.max(0, posix.length - base.length - 1))

    return dir === "" ? "index" : (dir.split("/").pop() ?? "index")
  }

  return base.replace(/\.mdx?$/i, "")
}

function discover(dir: string, root: string, out: string[]): void {
  for (const e of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name)

    if (e.isDirectory()) discover(abs, root, out)
    else if (e.isFile() && /\.mdx?$/i.test(e.name))
      out.push(path.relative(root, abs).split(path.sep).join("/"))
  }
}

export function buildWikiLinkMaps(contentDir: string): {
  files: string[]
  permalinks: Record<string, string>
} {
  let sources: string[] = []

  try {
    const out: string[] = []
    discover(contentDir, contentDir, out)
    sources = out.sort()
  } catch {
    return { files: [], permalinks: {} }
  }

  const titles = new Map(
    sources.map((r) => [
      r,
      titleForContent(fs.readFileSync(path.join(contentDir, r), "utf8"), fallbackFor(r)),
    ]),
  )

  const routes = new Map(sources.map((r) => [r, routeForSourcePath(r)]))
  const stems = new Map<string, number>()

  for (const r of sources) {
    const s = (r.replace(/\\/g, "/").split("/").pop() ?? r).replace(/\.mdx?$/i, "").toLowerCase()
    stems.set(s, (stems.get(s) ?? 0) + 1)
  }

  const toSources = new Map<string, string[]>()
  const original = new Map<string, string>()

  const add = (alias: string, rel: string) => {
    const k = normalizeAlias(alias)

    if (k === "") return

    if (!original.has(k)) original.set(k, alias)
    const l = toSources.get(k) ?? []

    if (!l.includes(rel)) l.push(rel)
    toSources.set(k, l.sort())
  }

  for (const rel of sources) {
    const seen = new Set<string>()
    const cands: string[] = [titles.get(rel) ?? "", rel.replace(/\.mdx?$/i, "")]
    const posix = rel.replace(/\\/g, "/")
    const base = posix.split("/").pop() ?? posix

    if (/^index\.mdx?$/i.test(base)) {
      const dir = posix.slice(0, Math.max(0, posix.length - base.length - 1))

      if (dir !== "") {
        cands.push(dir)
        cands.push(dir.split("/").pop() ?? "")
      }
    } else {
      const stem = base.replace(/\.mdx?$/i, "")

      if (stem.toLowerCase() !== "index" && stems.get(stem.toLowerCase()) === 1) cands.push(stem)
    }

    for (const a of cands) {
      const k = normalizeAlias(a)

      if (k === "" || seen.has(k)) continue
      seen.add(k)
      add(a, rel)
    }
  }

  const dups: string[] = []

  for (const [k, rels] of [...toSources].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (new Set(rels.map((r) => routes.get(r))).size > 1)
      dups.push(`${JSON.stringify(original.get(k) ?? k)} -> ${rels.join(", ")}`)
  }

  if (dups.length > 0) throw new Error(`duplicate wikilink aliases:\n${dups.join("\n")}`)
  const files: string[] = []
  const permalinks: Record<string, string> = {}

  for (const [k, rels] of [...toSources].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const o = original.get(k) ?? k
    files.push(o)
    permalinks[o] = routes.get(rels[0]) ?? ""
  }

  return { files: files.sort(), permalinks }
}
