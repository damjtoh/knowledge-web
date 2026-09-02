import type { QuartzTransformerPlugin, QuartzPageTypePlugin } from "@quartz-community/types"
export const KnowledgeVault: QuartzTransformerPlugin
export const Collections: QuartzPageTypePlugin
export const Dashboard: QuartzPageTypePlugin
export default KnowledgeVault
export const FALLBACK_SLUG: string
export const FALLBACK_LABEL: string
export const COLLECTIONS_PREFIX: string
export const DASHBOARD_SLUG: string
export function normalizeType(raw: unknown): string | null
export function slugForType(normalized: string): string
export function labelForType(normalized: string, slug: string): string
export function compareByTitleThenSlug(a: any, b: any): number
export function buildCollectionsFromFiles(allFiles: any[]): Array<{
  slug: string
  label: string
  items: any[]
}>
export function normalizeStatus(raw: unknown): string | null
export function isOpenTask(file: any): boolean
export function isActiveIdea(file: any): boolean
export function parseDashboardDate(value: unknown): number | null
export function getRecencyTime(file: any): number | null
export function compareByRecencyThenTitle(a: any, b: any): number
export function isPublishableForDashboard(file: any): boolean
export function getDashboardSlug(allFiles: any[]): string
