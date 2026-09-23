import fs from "node:fs"
import path from "node:path"
import type { PublishedRoot } from "./navigation"

export interface SiteMetadata {
  title: string
  canonicalHostname: string
  /** Ordered published navigation roots from generated metadata. */
  navigation: PublishedRoot[]
}

/**
 * Generated site metadata emitted by staging (`site-identity.json`).
 *
 * The reader consumes ONLY this generated file for document metadata. It is
 * public projection identity (manifest title, canonical hostname, and ordered
 * navigation roots), never vault content. Override with
 * READER_SITE_METADATA_FILE; default is the publisher `./site-identity.json`
 * next to the staged `./content` tree.
 */
export function getSiteMetadata(): SiteMetadata {
  const configured = process.env.READER_SITE_METADATA_FILE ?? "../site-identity.json"
  const file = path.isAbsolute(configured)
    ? configured
    : path.resolve(import.meta.dirname, "..", configured)
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`site metadata at ${file} must be a JSON object`)
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.title !== "string" || record.title.trim() === "") {
    throw new Error(`site metadata at ${file} has no title`)
  }
  if (typeof record.canonicalHostname !== "string" || record.canonicalHostname.trim() === "") {
    throw new Error(`site metadata at ${file} has no canonicalHostname`)
  }
  if (!Array.isArray(record.navigation)) {
    throw new Error(`site metadata at ${file} has no navigation`)
  }
  const navigation: PublishedRoot[] = []
  for (const entry of record.navigation) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`site metadata at ${file} has an invalid navigation entry`)
    }
    const { path: entryPath, kind } = entry as Record<string, unknown>
    if (typeof entryPath !== "string" || entryPath.trim() === "") {
      throw new Error(`site metadata at ${file} has a navigation entry with no path`)
    }
    if (kind !== "directory" && kind !== "markdown") {
      throw new Error(`site metadata at ${file} has a navigation entry with invalid kind`)
    }
    navigation.push({ path: entryPath, kind })
  }
  return {
    title: (record.title as string).trim(),
    canonicalHostname: (record.canonicalHostname as string).trim(),
    navigation,
  }
}

export function canonicalUrl(hostname: string, pageUrl: string): string {
  return `https://${hostname}${pageUrl === "/" ? "/" : pageUrl}`
}
