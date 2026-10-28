import { classify } from '../src/engine/connector-policy.ts'
import type { ToolHint } from '../src/engine/connector-policy.ts'

type Item = Record<string, any> // Upstream JSON is normalized at this boundary.
const base = 'https://backend.composio.dev/api/v3.1'
export type Status = 'connected' | 'pending' | 'expired' | 'disconnected'
export const statusOf = (raw: string): Status => raw === 'ACTIVE' ? 'connected' : ['EXPIRED', 'FAILED'].includes(raw) ? 'expired' : ['INITIATED', 'INITIALIZING', 'PENDING', 'PENDING_AUTH'].includes(raw) ? 'pending' : 'disconnected'
const ranks = { disconnected: 0, pending: 1, expired: 2, connected: 3 }
export const validToolkit = (value: unknown): string => typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value) ? value.toLowerCase() : ''
const summaries = new Map<string, ToolHint>()
const catalogs = new Map<string, { at: number; items: Item[] }>()
export async function composio(key: string, method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<Item> {
  const response = await fetch(base + path + (query ? '?' + new URLSearchParams(query) : ''), {
    method, headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  })
  // Generic errors avoid propagating upstream headers or credential-bearing diagnostics.
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Connection service returned HTTP ${response.status}.`) }
  const parsed = await response.json()
  if (!parsed || typeof parsed !== 'object') throw new Error('Unreadable connection service response.')
  if (parsed.ok === false || parsed.error) throw new Error('Connection service could not complete the request.')
  return parsed
}
async function pages(key: string, path: string, query: Record<string, string>) {
  const items: Item[] = [], seen = new Set<string>()
  for (let i = 0; i < 100; i++) {
    const result = await composio(key, 'GET', path, undefined, query)
    if (!Array.isArray(result.items)) throw new Error('Invalid connection service catalog.')
    items.push(...result.items.filter((v: unknown) => v && typeof v === 'object'))
    if (!result.next_cursor) return items
    if (typeof result.next_cursor !== 'string' || seen.has(result.next_cursor)) throw new Error('Repeated connection service page.')
    seen.add(result.next_cursor)
    query = { ...query, cursor: result.next_cursor }
  }
  throw new Error('Too many connection service pages.')
}
export async function catalog(key: string, user: string) {
  const cached = catalogs.get(user)
  if (cached && Date.now() - cached.at < 3600000) return cached.items
  const all = await pages(key, '/toolkits', { limit: '1000', type: 'all', sort_by: 'alphabetically', user_id: user })
  const items = [...new Map(all.filter((v) => validToolkit(v.slug) && typeof v.name === 'string').map((v) => [v.slug, {
    slug: v.slug, name: v.name, logo: typeof v.meta?.logo === 'string' && v.meta.logo.startsWith('https://') ? v.meta.logo : '',
    description: String(v.meta?.description ?? '').slice(0, 350),
    categories: (Array.isArray(v.meta?.categories) ? v.meta.categories : []).map((c: Item) => c.name).filter((n: unknown) => typeof n === 'string'),
    no_auth: v.no_auth === true || v.is_no_auth === true || (Array.isArray(v.auth_schemes) && v.auth_schemes.includes('NO_AUTH')),
  }])).values()].sort((a, b) => a.name.localeCompare(b.name))
  if (catalogs.size >= 100) catalogs.delete(catalogs.keys().next().value!)
  catalogs.set(user, { at: Date.now(), items })
  return items
}
async function accounts(key: string, user: string, toolkit = '') {
  return pages(key, '/connected_accounts', { user_ids: user, limit: '100', ...(toolkit ? { toolkit_slugs: toolkit } : {}) })
}
export async function connections(key: string, user: string) {
  const statuses: Record<string, Status> = {}
  for (const item of await accounts(key, user)) {
    const slug = validToolkit(item.toolkit?.slug)
    if (!slug) continue
    const status = statusOf(String(item.status ?? '').toUpperCase())
    if (ranks[status] >= ranks[statuses[slug] ?? 'disconnected']) statuses[slug] = status
  }
  return statuses
}
export async function connectionStatus(key: string, user: string, toolkit: string) {
  const list = await accounts(key, user, toolkit)
  return list.reduce<Status>((best, item) => {
    const status = statusOf(String(item.status ?? '').toUpperCase())
    return ranks[status] > ranks[best] ? status : best
  }, 'disconnected')
}
export async function link(key: string, user: string, toolkit: string) {
  const configs = await composio(key, 'GET', '/auth_configs', undefined, { toolkit_slug: toolkit, limit: '20' })
  let id = configs.items?.find((v: Item) => v.id && (!v.toolkit?.slug || v.toolkit.slug === toolkit))?.id
  if (!id) {
    const created = await composio(key, 'POST', '/auth_configs', { toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth', credentials: {} } })
    id = created.auth_config?.id
  }
  if (!id) throw new Error('Could not prepare the connection.')
  const result = await composio(key, 'POST', '/connected_accounts/link', { auth_config_id: id, user_id: user })
  if (typeof result.redirect_url !== 'string' || !result.redirect_url.startsWith('https://')) throw new Error('Authorization page was not returned.')
  return result.redirect_url
}
export async function disconnect(key: string, user: string, toolkit: string) {
  // Remove all matching accounts so an older ACTIVE account cannot keep the app connected.
  for (const item of await accounts(key, user, toolkit)) if (typeof item.id === 'string') await composio(key, 'DELETE', '/connected_accounts/' + encodeURIComponent(item.id))
}
function toolSummary(item: Item) {
  const summary = {
    slug: String(item.slug), name: typeof item.name === 'string' ? item.name : '',
    description: String(item.human_description || item.description || '').slice(0, 1200), input_parameters: item.input_parameters ?? {},
    tags: Array.isArray(item.tags) ? item.tags.filter((v: unknown) => typeof v === 'string') : [],
    toolkit: typeof item.toolkit === 'string' ? item.toolkit : item.toolkit?.slug ?? '',
  }
  if (summaries.size >= 2000) summaries.delete(summaries.keys().next().value!)
  summaries.set(summary.slug.toUpperCase(), summary)
  return summary
}
export async function searchTools(key: string, query: string, toolkit = '') {
  if (!toolkit) toolkit = ['google drive', 'gmail', 'outlook', 'github'].find((v) => query.toLowerCase().includes(v))?.replace('google drive', 'googledrive') ?? ''
  const result = await composio(key, 'GET', '/tools', undefined, { query, limit: '8', toolkit_versions: 'latest', ...(toolkit ? { toolkit_slug: toolkit } : {}) })
  let items = (Array.isArray(result.items) ? result.items : []).filter((v: Item) => typeof v.slug === 'string').map(toolSummary)
  if ((!toolkit || toolkit === 'github') && /repo|repositor/i.test(query) && /list|my|show|what/i.test(query)) {
    const preferred = 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER'
    let pinned = items.find((v: Item) => v.slug === preferred)
    if (!pinned) {
      const found = await composio(key, 'GET', '/tools', undefined, { tool_slugs: preferred, toolkit_versions: 'latest' })
      const raw = found.items?.find((v: Item) => v.slug === preferred)
      if (raw) pinned = toolSummary(raw)
    }
    if (pinned) items = [pinned, ...items.filter((v: Item) => v.slug !== preferred)]
  }
  return items.slice(0, 8)
}
export async function executeTool(key: string, user: string, tool: string, args: Record<string, unknown>, approved: boolean) {
  let hint = summaries.get(tool)
  if (!hint) {
    const found = await composio(key, 'GET', '/tools', undefined, { tool_slugs: tool, toolkit_versions: 'latest' })
    const item = found.items?.find((v: Item) => v.slug?.toUpperCase() === tool)
    if (item) hint = toolSummary(item)
  }
  if (classify(tool, hint?.tags) === 'write' && !approved) return { ok: false, executed: false, error: 'approval required' }
  const result = await composio(key, 'POST', '/tools/execute/' + tool, { user_id: user, arguments: args, version: 'latest' })
  return { ...result, ok: result.successful !== false, executed: true }
}
/** A bounded JSON tree, retaining useful fields and explicit omission counts. */
// Generous bounds: the browser compacts again to fit the model context, so lists stay complete and counts truthful.
export function compact(value: unknown, max = 60000): unknown {
  const shrink = (v: unknown, depth = 0): unknown => {
    if (typeof v === 'string') return v.length > 900 ? v.slice(0, 899) + '…' : v
    if (depth > 7 && v && typeof v === 'object') return '[nested data omitted]'
    if (Array.isArray(v)) return [...v.slice(0, 100).map((x) => shrink(x, depth + 1)), ...(v.length > 100 ? [{ _note: `${v.length - 100} items omitted` }] : [])]
    if (v && typeof v === 'object') {
      const entries = Object.entries(v)
      return { ...Object.fromEntries(entries.slice(0, 80).map(([k, x]) => [k, shrink(x, depth + 1)])), ...(entries.length > 80 ? { _note: `${entries.length - 80} fields omitted` } : {}) }
    }
    return v
  }
  const result = shrink(value)
  if (JSON.stringify(result).length <= max) return result
  // Keep the response envelope, then select as many individual fields/items as fit.
  let remaining = max - 500, omitted = 0
  const budgeted = (v: unknown): unknown => {
    if (v && typeof v === 'object') {
      if (Array.isArray(v)) {
        const kept: unknown[] = []
        for (const x of v) { if (remaining < 100) { omitted++; continue }; kept.push(budgeted(x)) }
        return kept
      }
      const kept: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) { if (remaining < k.length + 40) { omitted++; continue }; remaining -= k.length + 6; kept[k] = budgeted(x) }
      return kept
    }
    const text = JSON.stringify(v) ?? 'null'
    if (text.length > remaining) { omitted++; return '[omitted to fit context]' }
    remaining -= text.length
    return v
  }
  return { result: budgeted(result), _note: `${omitted} fields/items omitted to fit context` }
}
