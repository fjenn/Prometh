import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { handle } from '../server/app.ts'
import { compact } from '../server/composio.ts'
import { publicAddress, resolvePublic } from '../server/reader.ts'

const fakeKey = 'test-only-credential-DO-NOT-RETURN'
const envKeys = ['COMPOSIO_API_KEY', 'COMPOSIO_USER_ID', 'NODE_ENV', 'PROMETH_COMPOSIO_ENV', 'PROMETH_SESSION_SECRET', 'SEARXNG_URL']
let saved: Record<string, string | undefined>
const originalFetch = globalThis.fetch
beforeEach(() => {
  saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]))
  process.env.COMPOSIO_API_KEY = fakeKey
  process.env.COMPOSIO_USER_ID = randomUUID()
  process.env.NODE_ENV = 'production'
  process.env.PROMETH_SESSION_SECRET = 'test-session-secret'
  delete process.env.PROMETH_COMPOSIO_ENV
  process.env.SEARXNG_URL = 'http://search.internal:8888'
})
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const key of envKeys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]
})
const req = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request('https://prometh.test/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
test('health reflects configuration without credential disclosure or production implicit file fallback', async () => {
  assert.deepEqual(await (await handle(req('health'))).json(), { ok: true, search: true, connectors: true })
  delete process.env.COMPOSIO_API_KEY; delete process.env.SEARXNG_URL
  assert.deepEqual(await (await handle(req('health'))).json(), { ok: true, search: false, connectors: false })
  const result = await handle(req('connectors/catalog'))
  assert.equal(result.status, 503); assert.ok(!(await result.text()).includes(fakeKey))
})
test('search proxies only normalized top ten results', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    assert.equal(url.host, 'search.internal:8888'); assert.equal(url.searchParams.get('q'), 'latest news'); assert.equal(url.searchParams.get('format'), 'json')
    return json({ results: [{ url: 'javascript:alert(1)' }, ...Array.from({ length: 15 }, (_, i) => ({ title: 'title', url: 'https://a.org/' + i, content: 'body', publishedDate: '2026-10-28' }))] })
  }
  const data = await (await handle(req('search?q=latest+news'))).json()
  assert.equal(data.results.length, 10)
  assert.deepEqual(data.results[0], { title: 'title', url: 'https://a.org/0', snippet: 'body', publishedDate: '2026-10-28' })
})
test('catalog paginates, normalizes, redacts every string/property and caches in memory', async () => {
  let count = 0
  globalThis.fetch = async (input, init) => {
    count++; const url = new URL(String(input))
    assert.equal(new Headers(init?.headers).get('x-api-key'), fakeKey)
    assert.equal(url.pathname, '/api/v3.1/toolkits'); assert.equal(url.searchParams.get('limit'), '1000'); assert.equal(url.searchParams.get('type'), 'all')
    if (!url.searchParams.get('cursor')) return json({ items: [{ slug: 'github', name: 'GitHub', meta: { description: fakeKey, logo: 'https://a.org/logo', categories: [{ name: 'Dev' }] } }], next_cursor: 'next' })
    return json({ items: [{ slug: 'public', name: 'Public', no_auth: true, meta: { logo: 'javascript:no', categories: [] } }] })
  }
  const result = await handle(req('connectors/catalog')), raw = await result.text()
  assert.ok(!raw.includes(fakeKey)); const data = JSON.parse(raw)
  assert.equal(data.items.length, 2); assert.equal(data.items[0].description, '[redacted]'); assert.equal(data.items[1].no_auth, true)
  await handle(req('connectors/catalog')); assert.equal(count, 2)
})
test('connection ranking matches Mac and status route uses server identity', async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input)); assert.equal(url.searchParams.get('user_ids'), process.env.COMPOSIO_USER_ID)
    return json({ items: ['INITIATED', 'ACTIVE', 'EXPIRED', 'FAILED'].map((status) => ({ toolkit: { slug: 'github' }, status })) })
  }
  assert.deepEqual((await (await handle(req('connectors/connections'))).json()).statuses, { github: 'connected' })
  assert.equal((await (await handle(req('connectors/status?toolkit=github'))).json()).status, 'connected')
})
test('write without approval is refused, including authoritative destructive tags on a read-named action', async () => {
  let executions = 0
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (init?.method === 'POST') { executions++; throw new Error('write must not run') }
    return json({ items: [{ slug: url.searchParams.get('tool_slugs'), tags: ['destructiveHint', 'readOnlyHint'] }] })
  }
  for (const tool of ['TEST_CREATE_RECORD', 'TEST_GET_DANGEROUS']) {
    assert.deepEqual(await (await handle(req('connectors/tools/execute', { tool, arguments: {} }))).json(), { ok: false, executed: false, error: 'approval required' })
  }
  assert.equal(executions, 0)
})
test('read execution uses server user id/version and redacts deeply nested successful responses', async () => {
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/tools/execute/')) {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.user_id, process.env.COMPOSIO_USER_ID); assert.equal(body.version, 'latest'); assert.deepEqual(body.arguments, { count: 2 })
      return json({ successful: true, data: { message: fakeKey, [fakeKey]: ['prefix ' + fakeKey + ' suffix'] } })
    }
    return json({ items: [{ slug: 'TEST_LIST_RECORDS', tags: ['readOnlyHint'] }] })
  }
  const response = await handle(req('connectors/tools/execute', { tool: 'TEST_LIST_RECORDS', arguments: { count: 2 }, user_id: 'attacker' }))
  const raw = await response.text()
  assert.ok(!raw.includes(fakeKey)); assert.match(raw, /redacted/)
  assert.equal(JSON.parse(raw).executed, true)
})
test('upstream errors cannot leak the key; invalid tool slugs never reach upstream', async () => {
  globalThis.fetch = async () => { throw new Error('network error ' + fakeKey) }
  const response = await handle(req('connectors/tools/search', { query: 'anything' }))
  assert.ok(!(await response.text()).includes(fakeKey))
  globalThis.fetch = async () => { throw new Error('should not be called') }
  for (const tool of ['A/DELETE', 'A?B', 'A B', 'A#B']) {
    const response = await handle(req('connectors/tools/execute', { tool, arguments: {} }))
    assert.equal(response.status, 400); assert.match(await response.text(), /Invalid tool/)
  }
})
test('known GitHub repo-list tool is pinned with its full schema', async () => {
  const preferred = 'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER'
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('toolkit_versions'), 'latest')
    return url.searchParams.has('tool_slugs') ? json({ items: [{ slug: preferred, input_parameters: { type: 'object', properties: { per_page: { type: 'integer' } } }, toolkit: { slug: 'github' } }] }) : json({ items: [{ slug: 'GITHUB_GET_REPO' }] })
  }
  const data = await (await handle(req('connectors/tools/search', { query: 'list my repos', toolkit: 'github' }))).json()
  assert.equal(data.items[0].slug, preferred); assert.equal(data.items[0].input_parameters.properties.per_page.type, 'integer')
})
test('link prepares managed auth and disconnect deletes only server-user accounts', async () => {
  const requests: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); requests.push((init?.method ?? 'GET') + ' ' + url.pathname)
    if (url.pathname.endsWith('/auth_configs') && init?.method === 'GET') return json({ items: [] })
    if (url.pathname.endsWith('/auth_configs')) { assert.equal(JSON.parse(String(init?.body)).auth_config.type, 'use_composio_managed_auth'); return json({ auth_config: { id: 'config' } }) }
    if (url.pathname.endsWith('/link')) { const body = JSON.parse(String(init?.body)); assert.equal(body.user_id, process.env.COMPOSIO_USER_ID); return json({ redirect_url: 'https://auth.example/connect' }) }
    if (init?.method === 'DELETE') return json({})
    assert.equal(url.searchParams.get('user_ids'), process.env.COMPOSIO_USER_ID)
    return json({ items: [{ id: 'account', status: 'ACTIVE' }] })
  }
  assert.equal((await (await handle(req('connectors/link', { toolkit: 'github' }))).json()).redirect_url, 'https://auth.example/connect')
  assert.equal((await (await handle(req('connectors/disconnect', { toolkit: 'github' }))).json()).status, 'disconnected')
  assert.ok(requests.includes('DELETE /api/v3.1/connected_accounts/account'))
})
test('browser identity is signed, stable, secure on HTTPS and resistant to tampering/client user ids', async () => {
  delete process.env.COMPOSIO_USER_ID
  const users: string[] = []
  globalThis.fetch = async (input) => { users.push(new URL(String(input)).searchParams.get('user_ids')!); return json({ items: [] }) }
  const first = await handle(req('connectors/connections')), cookie = first.headers.get('set-cookie')!
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Secure/)
  const cookieValue = cookie.split(';')[0]
  assert.match(cookieValue, /^prometh_uid=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/)
  const second = await handle(req('connectors/connections', undefined, { cookie: cookieValue }))
  assert.equal(second.headers.get('set-cookie'), null); assert.equal(users[0], users[1])
  const altered = cookieValue.replace(/.$/, cookieValue.endsWith('a') ? 'b' : 'a')
  const third = await handle(req('connectors/connections', undefined, { cookie: altered }))
  assert.ok(third.headers.get('set-cookie')); assert.notEqual(users[2], users[0])
})
test('cross-origin mutations are rejected before upstream; production requires persistent session secret', async () => {
  globalThis.fetch = async () => { throw new Error('must not call') }
  assert.equal((await handle(req('connectors/link', { toolkit: 'github' }, { origin: 'https://evil.test' }))).status, 403)
  delete process.env.COMPOSIO_USER_ID; delete process.env.PROMETH_SESSION_SECRET
  assert.equal((await (await handle(req('health'))).json()).connectors, false)
  assert.match(await (await handle(req('connectors/connections'))).text(), /SESSION_SECRET/)
})
test('SSRF guard rejects loopback/private/metadata/localhost and encoded IP variants without fetching', async () => {
  globalThis.fetch = async () => { throw new Error('must not fetch') }
  for (const url of ['http://127.0.0.1/', 'http://10.2.3.4/', 'http://169.254.169.254/latest', 'http://localhost/', 'http://2130706433/', 'http://0x7f000001/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'http://192.168.1.1/', 'http://172.16.0.1/']) {
    const response = await handle(req('read?url=' + encodeURIComponent(url)))
    assert.equal(response.status, 400, url); assert.equal((await response.json()).ok, false)
    await assert.rejects(resolvePublic(url))
  }
  assert.ok(publicAddress('8.8.8.8')); assert.ok(publicAddress('2606:4700:4700::1111'))
  for (const ip of ['0.0.0.0', '127.1.2.3', '100.100.100.200', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', '2002:7f00:1::1']) assert.equal(publicAddress(ip), false, ip)
})
test('huge execution results stay valid JSON and bounded with omission notes', () => {
  const result = compact({ ok: true, executed: true, data: { records: Array.from({ length: 500 }, () => ({ title: 'long'.repeat(5000), nested: [1, 2, 3] })) } })
  const text = JSON.stringify(result)
  assert.ok(text.length <= 5200, String(text.length)); assert.ok(JSON.parse(text)); assert.match(text, /omitted/)
})

test('reader extracts plain text from HTML and rejects redirects to private targets, non-HTML and oversized pages', async (t) => {
  const { Agent, MockAgent } = await import('undici')
  const mock = new MockAgent(); mock.disableNetConnect()
  t.mock.method(Agent.prototype, 'dispatch', function (options, handler) { return mock.get(String(options.origin)).dispatch(options, handler) })
  const pool = mock.get('http://8.8.8.8')
  const paragraph = 'This is readable article text with enough words and sentences to survive reader extraction. '.repeat(20)
  pool.intercept({ path: '/article' }).reply(200, `<html><head><title>A real format article</title></head><body><article><h1>Article title</h1><p>${paragraph}</p></article></body></html>`, { headers: { 'content-type': 'text/html' } })
  pool.intercept({ path: '/redirect' }).reply(302, '', { headers: { location: 'http://169.254.169.254/latest' } })
  pool.intercept({ path: '/json' }).reply(200, '{}', { headers: { 'content-type': 'application/json' } })
  pool.intercept({ path: '/large' }).reply(200, 'x'.repeat(3 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/html' } })
  try {
    const article = await (await handle(req('read?url=http://8.8.8.8/article'))).json()
    assert.equal(article.ok, true, JSON.stringify(article)); assert.ok(article.text.includes('readable article text')); assert.ok(!article.text.includes('<p>'))
    const redirect = await handle(req('read?url=http://8.8.8.8/redirect'))
    assert.equal(redirect.status, 400); assert.match(await redirect.text(), /Private addresses/)
    const nonHtml = await handle(req('read?url=http://8.8.8.8/json'))
    assert.equal(nonHtml.status, 400); assert.match(await nonHtml.text(), /not HTML/)
    const oversized = await handle(req('read?url=http://8.8.8.8/large'))
    assert.equal(oversized.status, 400); assert.match(await oversized.text(), /3 MB/)
    mock.assertNoPendingInterceptors()
  } finally { await mock.close() }
})
