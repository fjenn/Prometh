import { apiKey, identity, redact } from './config.ts'
import { readPage } from './reader.ts'
import { catalog, connections, connectionStatus, link, disconnect, searchTools, executeTool, compact, validToolkit } from './composio.ts'

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new Error('Expected application/json.')
  if (Number(request.headers.get('content-length')) > 65536) throw new Error('Request too large.')
  const reader = request.body?.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  if (reader) for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 65536) { await reader.cancel(); throw new Error('Request too large.') }
    parts.push(value)
  }
  const parsed = JSON.parse(Buffer.concat(parts).toString('utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected a JSON object.')
  return parsed
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, cap = 300) => typeof v === 'string' ? v.trim().slice(0, cap) : ''

/** Host-neutral API boundary. Credentials and Composio identities are exclusively server-owned. */
export async function handle(request: Request): Promise<Response> {
  const key = await apiKey()
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(redact(value, key)), { status, headers })
  try {
    const url = new URL(request.url), path = url.pathname
    if (request.method === 'POST') {
      const origin = request.headers.get('origin')
      if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') return reply({ ok: false, error: 'Cross-origin request refused.' }, 403)
    }
    if (path === '/api/health' && request.method === 'GET') {
      const connectors = !!key && (!!process.env.COMPOSIO_USER_ID || !!process.env.PROMETH_SESSION_SECRET || process.env.NODE_ENV !== 'production')
      if (connectors) { const { cookie } = identity(request); if (cookie) headers.set('Set-Cookie', cookie) }
      return reply({ ok: true, search: !!process.env.SEARXNG_URL, connectors })
    }
    if (path === '/api/search' && request.method === 'GET') {
      if (!process.env.SEARXNG_URL) return reply({ ok: false, error: 'Web search is not configured.' }, 503)
      const q = text(url.searchParams.get('q'))
      if (!q) return reply({ ok: false, error: 'A search query is required.' }, 400)
      const endpoint = new URL('search', process.env.SEARXNG_URL.replace(/\/?$/, '/'))
      endpoint.searchParams.set('format', 'json'); endpoint.searchParams.set('q', q)
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error(`Search returned HTTP ${response.status}.`)
      const data = await response.json()
      const results = (Array.isArray(data.results) ? data.results : []).filter((v: Record<string, unknown>) => typeof v.url === 'string' && /^https?:\/\//i.test(v.url)).slice(0, 10).map((v: Record<string, unknown>) => ({ title: text(v.title, 250), url: text(v.url, 2000), snippet: text(v.content, 700), ...(v.publishedDate ? { publishedDate: text(v.publishedDate) } : {}) }))
      return reply({ ok: true, results })
    }
    if (path === '/api/read' && request.method === 'GET') return reply(await readPage(text(url.searchParams.get('url'), 4000)))
    if (!path.startsWith('/api/connectors/')) return reply({ ok: false, error: 'Route not found.' }, 404)
    if (!key) return reply({ ok: false, error: 'Connectors are not configured.' }, 503)
    const { user, cookie } = identity(request)
    if (cookie) headers.set('Set-Cookie', cookie)
    if (path === '/api/connectors/catalog' && request.method === 'GET') return reply({ ok: true, items: await catalog(key, user) })
    if (path === '/api/connectors/connections' && request.method === 'GET') return reply({ ok: true, statuses: await connections(key, user) })
    if (path === '/api/connectors/status' && request.method === 'GET') {
      const toolkit = validToolkit(url.searchParams.get('toolkit'))
      if (!toolkit) return reply({ ok: false, error: 'Unknown app.' }, 400)
      return reply({ ok: true, status: await connectionStatus(key, user, toolkit) })
    }
    if (request.method !== 'POST') return reply({ ok: false, error: 'Route not found.' }, 404)
    const body = await jsonBody(request)
    if (path === '/api/connectors/link' || path === '/api/connectors/disconnect') {
      const toolkit = validToolkit(body.toolkit)
      if (!toolkit) return reply({ ok: false, error: 'Unknown app.' }, 400)
      if (path.endsWith('/link')) return reply({ ok: true, redirect_url: await link(key, user, toolkit) })
      await disconnect(key, user, toolkit)
      return reply({ ok: true, status: 'disconnected' })
    }
    if (path === '/api/connectors/tools/search') {
      const query = text(body.query)
      if (!query) return reply({ ok: false, error: 'A query is required.' }, 400)
      return reply({ ok: true, items: await searchTools(key, query, validToolkit(body.toolkit)) })
    }
    if (path === '/api/connectors/tools/execute') {
      const tool = text(body.tool).toUpperCase()
      if (!/^[A-Z0-9_]+$/.test(tool) || !object(body.arguments)) return reply({ ok: false, executed: false, error: 'Invalid tool or arguments.' }, 400)
      return reply(compact(await executeTool(key, user, tool, body.arguments, body.approved === true)))
    }
    return reply({ ok: false, error: 'Route not found.' }, 404)
  } catch (error) {
    return reply({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }, 400)
  }
}
