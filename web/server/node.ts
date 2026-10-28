import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { stat } from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, extname } from 'node:path'
import { handle } from './app.ts'

const dist = resolve(fileURLToPath(new URL('../dist/', import.meta.url)))
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.mjs': 'text/javascript' }
const server = createServer(async (req, res) => {
  try {
    const protocol = (('encrypted' in req.socket && req.socket.encrypted) || req.headers['x-forwarded-proto'] === 'https') ? 'https' : 'http'
    const url = new URL(req.url ?? '/', `${protocol}://${req.headers.host || 'localhost'}`)
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers()
      for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      const ac = new AbortController()
      res.on('close', () => { if (!res.writableEnded) ac.abort() })
      const request = new Request(url, { method: req.method, headers, signal: ac.signal, ...(!['GET', 'HEAD'].includes(req.method ?? 'GET') ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } : {}) })
      const response = await handle(request)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(await response.text())
      return
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405); res.end(); return }
    let path = resolve(dist, '.' + decodeURIComponent(url.pathname))
    if (path !== dist && !path.startsWith(dist + '/')) { res.writeHead(403); res.end(); return }
    if (!(await stat(path).catch(() => null))?.isFile()) path = resolve(dist, 'index.html')
    if (!existsSync(path)) { res.writeHead(404); res.end('Build the web app first, or use Vite for development.'); return }
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' })
    if (req.method === 'HEAD') res.end()
    else createReadStream(path).on('error', () => res.destroy()).pipe(res)
  } catch { res.writeHead(500); res.end('Request failed.') }
})
server.listen(Number(process.env.PORT || 8787), () => console.info(`Prometh server listening on port ${process.env.PORT || 8787}`))
