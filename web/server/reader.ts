import { lookup } from 'node:dns/promises'
import { isIP, BlockList } from 'node:net'
import { Agent, fetch as pinnedFetch } from 'undici'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

const blocked = new BlockList()
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['192.0.2.0', 24], ['192.88.99.0', 24], ['198.51.100.0', 24], ['203.0.113.0', 24], ['168.63.129.16', 32], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(address, prefix, 'ipv4')
// Only globally routable IPv6 unicast; reject transition mechanisms that can encode private IPv4.
export function publicAddress(address: string) {
  if (isIP(address) === 4) return !blocked.check(address, 'ipv4')
  if (isIP(address) !== 6) return false
  const first = parseInt(address.split(':')[0], 16)
  return first >= 0x2000 && first <= 0x3fff && !/^200[12]:/i.test(address) && !/^2001:(?:0*|db8):/i.test(address)
}
export async function resolvePublic(raw: string, signal = AbortSignal.timeout(8000)) {
  signal.throwIfAborted()
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only public HTTP(S) pages can be read.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw new Error('Private addresses cannot be read.')
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await Promise.race([
    lookup(host, { all: true }),
    new Promise<never>((_, reject) => { signal.addEventListener('abort', () => reject(new Error('Page lookup timed out.')), { once: true }) }),
  ])
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new Error('Private addresses cannot be read.')
  return { url, address: addresses[0] }
}
export async function readPage(raw: string) {
  const signal = AbortSignal.timeout(8000)
  for (let redirects = 0; redirects <= 3; redirects++) {
    const { url, address } = await resolvePublic(raw, signal)
    // Pin the validated DNS result to the actual socket; no second DNS lookup/rebinding window.
    const agent = new Agent({ connect: { lookup: (_host, options, callback) => {
      if (options.all) callback(null, [{ address: address.address, family: address.family }])
      else callback(null, address.address, address.family)
    } } })
    try {
      const res = await pinnedFetch(url, { dispatcher: agent, signal, redirect: 'manual', headers: { accept: 'text/html, application/xhtml+xml', 'user-agent': 'PromethReader/1.0' } })
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        await res.body?.cancel()
        const location = res.headers.get('location')
        if (!location || redirects === 3) throw new Error('Too many page redirects.')
        raw = new URL(location, url).href
        continue
      }
      if (!res.ok) throw new Error(`Page returned HTTP ${res.status}.`)
      if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(res.headers.get('content-type') ?? '')) throw new Error('The page is not HTML.')
      const cap = 3 * 1024 * 1024
      if (Number(res.headers.get('content-length')) > cap) throw new Error('Page exceeds 3 MB.')
      const chunks: Uint8Array[] = []
      let size = 0
      if (res.body) for await (const chunk of res.body) {
        size += chunk.length
        if (size > cap) { await res.body.cancel().catch(() => {}); throw new Error('Page exceeds 3 MB.') }
        chunks.push(chunk)
      }
      signal.throwIfAborted()
      const { document } = parseHTML(Buffer.concat(chunks).toString('utf8'))
      Object.defineProperty(document, 'documentURI', { value: url.href })
      const article = new Readability(document as unknown as Document, { maxElemsToParse: 80000 }).parse()
      const text = (article?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24000)
      if (!text) throw new Error('No readable article text was found.')
      return { ok: true, title: article?.title ?? document.title, url: url.href, text }
    } finally { await agent.destroy() }
  }
  throw new Error('Too many page redirects.')
}
