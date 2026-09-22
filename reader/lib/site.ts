import fs from "node:fs"
import path from "node:path"

export interface SiteIdentity {
  title: string
  canonicalHostname: string
}

/**
 * Generated site identity emitted by staging (`site-identity.json`).
 *
 * The reader consumes ONLY this generated file for document metadata. It is
 * public projection identity (manifest title + canonical hostname), never
 * vault content. Override with SHARED_IDENTITY_FILE; default is the
 * publisher `./site-identity.json` next to the staged `./content` tree.
 */
export function getSiteIdentity(): SiteIdentity {
  const configured = process.env.SHARED_IDENTITY_FILE ?? "../site-identity.json"
  const file = path.isAbsolute(configured)
    ? configured
    : path.resolve(import.meta.dirname, "..", configured)
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SiteIdentity
  if (typeof parsed.title !== "string" || parsed.title.trim() === "") {
    throw new Error(`site identity at ${file} has no title`)
  }
  if (typeof parsed.canonicalHostname !== "string" || parsed.canonicalHostname.trim() === "") {
    throw new Error(`site identity at ${file} has no canonicalHostname`)
  }
  return { title: parsed.title.trim(), canonicalHostname: parsed.canonicalHostname.trim() }
}

export function canonicalUrl(hostname: string, pageUrl: string): string {
  return `https://${hostname}${pageUrl === "/" ? "/" : pageUrl}`
}
