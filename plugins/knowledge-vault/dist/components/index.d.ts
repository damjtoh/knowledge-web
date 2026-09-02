import type { QuartzComponentConstructor } from "@quartz-community/types"
export const CollectionNav: QuartzComponentConstructor
export default CollectionNav
export const FALLBACK_SLUG: string
export const FALLBACK_LABEL: string
export const COLLECTIONS_PREFIX: string
export function normalizeType(raw: unknown): string | null
export function slugForType(normalized: string): string
export function labelForType(normalized: string, slug: string): string
export function compareByTitleThenSlug(a: any, b: any): number
export function buildCollectionsFromFiles(allFiles: any[]): Array<{
  slug: string
  label: string
  items: any[]
}>
