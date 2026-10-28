export interface Health { search: boolean; connectors: boolean }
export type ConnectionStatus = 'connected' | 'pending' | 'expired' | 'disconnected'
export interface Toolkit { slug: string; name: string; logo: string; description: string; categories: string[]; no_auth: boolean }
export interface ConnectorTool { slug: string; name: string; description: string; input_parameters: Record<string, unknown>; tags: string[]; toolkit: string }
export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api/' + path, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) })
  const data = await response.json()
  if (!response.ok || data.ok === false) throw new Error(data.error || 'The service is unavailable.')
  return data as T
}
export const getHealth = (signal?: AbortSignal) => api<Health>('health', undefined, signal).catch(() => ({ search: false, connectors: false }))
export const getConnections = (signal?: AbortSignal) => api<{ statuses: Record<string, ConnectionStatus> }>('connectors/connections', undefined, signal)
const CACHE = 'prometh.toolkits.v1', LIFETIME = 24 * 3600000
export function cachedCatalog(): { items: Toolkit[]; fetchedAt: number } | null {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE) ?? 'null')
    return data && Array.isArray(data.items) && data.items.length && typeof data.fetchedAt === 'number' ? data : null
  } catch { return null }
}
export async function getCatalog(signal?: AbortSignal): Promise<Toolkit[]> {
  const cached = cachedCatalog(), age = Date.now() - (cached?.fetchedAt ?? 0)
  if (cached && age >= 0 && age < LIFETIME) return cached.items
  const result = await api<{ items: Toolkit[] }>('connectors/catalog', undefined, signal)
  try { localStorage.setItem(CACHE, JSON.stringify({ items: result.items, fetchedAt: Date.now() })) } catch { /* caching is optional */ }
  return result.items
}
