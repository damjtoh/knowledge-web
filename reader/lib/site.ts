import fs from "node:fs"
import path from "node:path"
import type { PublishedRoot } from "./navigation"

export interface ProjectionDestination {
  name: string
  origin: string
}

export interface SiteMetadata {
  title: string
  canonicalHostname: string
  /** Ordered published navigation roots from generated metadata. */
  navigation: PublishedRoot[]
  /** Owner-declared cross-origin projection destinations from generated metadata. */
  destinations: ProjectionDestination[]
}

/** JSON value owned by the generated site-identity file. */
type SiteJson = string | number | boolean | null | SiteJson[] | { [key: string]: SiteJson }

function isString(value: unknown): value is string {
  return String(value) === value
}

function isSiteRecord(value: unknown): value is Record<string, SiteJson> {
  return value !== null && Object(value) === value && !(value instanceof Function)
}

// A canonical hostname: DNS labels separated by dots, no scheme, port, path,
// userinfo, or whitespace. Mirrors the staging hostname rule so the reader
// rejects the same unsafe origins staging rejects.
const HOSTNAME_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i

/**
 * Normalize an absolute secure HTTPS origin to `https://hostname`, or null
 * when unsafe or malformed. Rejects non-HTTPS schemes, credentials, ports,
 * paths, queries, fragments, whitespace, and non-DNS hostnames.
 */
function normalizeDestinationOrigin(trimmed: string): string | null {
  if (/\s/.test(trimmed)) return null

  let parsed: URL

  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== "https:") return null

  if (parsed.username !== "" || parsed.password !== "") return null

  if (parsed.port !== "") return null

  if (parsed.search !== "" || parsed.hash !== "") return null

  if (parsed.pathname !== "" && parsed.pathname !== "/") return null

  if (!HOSTNAME_RE.test(parsed.hostname)) return null

  return parsed.origin
}

/**
 * Generated site metadata emitted by staging (`site-identity.json`).
 *
 * The reader consumes ONLY this generated file for document metadata. It is
 * public projection identity (manifest title, canonical hostname, ordered
 * navigation roots, and owner-declared cross-origin destinations), never
 * content. Override with
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

  const canonicalHostname = record.canonicalHostname.trim()

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

  const destinations = readDestinations(file, record.destinations, canonicalHostname)

  return {
    title: record.title.trim(),
    canonicalHostname,
    navigation,
    destinations,
  }
}

/**
 * Owner-declared cross-origin destinations from generated metadata.
 *
 * Absent means no destinations: identities generated before destinations
 * existed stay valid and the switcher shows the current projection only.
 * When present, every entry needs an explicit display name and an absolute
 * secure HTTPS origin distinct from the current hostname, with no
 * duplicates. Anything else fails the build.
 */
function readDestinations(
  file: string,
  raw: SiteJson | undefined,
  canonicalHostname: string,
): ProjectionDestination[] {
  if (raw === undefined) return []

  if (!Array.isArray(raw)) {
    throw new Error(`site metadata at ${file} has invalid destinations`)
  }

  const canonical = canonicalHostname.toLowerCase()
  const destinations: ProjectionDestination[] = []
  const seenOrigins = new Set<string>()
  const seenNames = new Set<string>()

  for (const entry of raw) {
    if (!isSiteRecord(entry)) {
      throw new Error(`site metadata at ${file} has an invalid destination entry`)
    }

    const { name, origin } = entry

    if (!isString(name) || name.trim() === "") {
      throw new Error(`site metadata at ${file} has a destination with no name`)
    }

    if (!isString(origin) || origin.trim() === "") {
      throw new Error(`site metadata at ${file} has a destination with no origin`)
    }

    const normalized = normalizeDestinationOrigin(origin.trim())

    if (normalized === null) {
      throw new Error(`site metadata at ${file} has a destination with an unsafe origin`)
    }

    if (seenOrigins.has(normalized)) {
      throw new Error(`site metadata at ${file} has a duplicate destination origin`)
    }

    seenOrigins.add(normalized)

    const displayName = name.trim()

    if (seenNames.has(displayName)) {
      throw new Error(`site metadata at ${file} has a duplicate destination name`)
    }

    seenNames.add(displayName)

    if (normalized.replace(/^https:\/\//, "") === canonical) {
      throw new Error(`site metadata at ${file} lists its own origin as a destination`)
    }

    destinations.push({ name: displayName, origin: normalized })
  }

  return destinations
}

export function canonicalUrl(hostname: string, pageUrl: string): string {
  return `https://${hostname}${pageUrl === "/" ? "/" : pageUrl}`
}
