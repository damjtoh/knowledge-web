import fs from "node:fs"
import path from "node:path"
import type { PublishedRoot } from "./navigation"

export interface SiteMetadata {
  title: string
  canonicalHostname: string
  /** Ordered published navigation roots from generated metadata. */
  navigation: PublishedRoot[]
}

/** JSON value owned by the generated site-identity file. */
type SiteJson = string | number | boolean | null | SiteJson[] | { [key: string]: SiteJson }

function isString(value: unknown): value is string {
  return String(value) === value
}

function isSiteRecord(value: unknown): value is Record<string, SiteJson> {
  return value !== null && Object(value) === value && !(value instanceof Function)
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
  // Relative defaults resolve from the build working directory (the reader
  // package root). import.meta.dirname is unavailable inside bundled server
  // chunks, so it must not be used here.
  const file = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"))

  if (!isSiteRecord(parsed)) {
    throw new Error(`site metadata at ${file} must be a JSON object`)
  }

  const record = parsed

  if (!isString(record.title) || record.title.trim() === "") {
    throw new Error(`site metadata at ${file} has no title`)
  }

  if (!isString(record.canonicalHostname) || record.canonicalHostname.trim() === "") {
    throw new Error(`site metadata at ${file} has no canonicalHostname`)
  }

  if (!Array.isArray(record.navigation)) {
    throw new Error(`site metadata at ${file} has no navigation`)
  }

  const navigation: PublishedRoot[] = []

  for (const entry of record.navigation) {
    if (!isSiteRecord(entry)) {
      throw new Error(`site metadata at ${file} has an invalid navigation entry`)
    }

    const { path: entryPath, kind } = entry

    if (!isString(entryPath) || entryPath.trim() === "") {
      throw new Error(`site metadata at ${file} has a navigation entry with no path`)
    }

    if (kind !== "directory" && kind !== "markdown") {
      throw new Error(`site metadata at ${file} has a navigation entry with invalid kind`)
    }

    navigation.push({ path: entryPath, kind })
  }

  return {
    title: record.title.trim(),
    canonicalHostname: record.canonicalHostname.trim(),
    navigation,
  }
}

export function canonicalUrl(hostname: string, pageUrl: string): string {
  return `https://${hostname}${pageUrl === "/" ? "/" : pageUrl}`
}
