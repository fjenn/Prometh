import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto'

const devSecret = randomBytes(32).toString('hex')
export async function apiKey(): Promise<string> {
  if (process.env.COMPOSIO_API_KEY?.trim()) return process.env.COMPOSIO_API_KEY.trim()
  const path = process.env.PROMETH_COMPOSIO_ENV || (process.env.NODE_ENV !== 'production' ? `${homedir()}/.config/prometh/composio.env` : '')
  if (!path) return ''
  try {
    const env = await readFile(path, 'utf8')
    const raw = env.match(/^\s*(?:export\s+)?COMPOSIO_API_KEY\s*=\s*(.*?)\s*$/m)?.[1] ?? ''
    return raw.replace(/^(['"])(.*)\1$/, '$2').trim()
  } catch { return '' }
}
export function identity(request: Request): { user: string; cookie?: string } {
  if (process.env.COMPOSIO_USER_ID) return { user: process.env.COMPOSIO_USER_ID }
  const secret = process.env.PROMETH_SESSION_SECRET || (process.env.NODE_ENV !== 'production' ? devSecret : '')
  if (!secret) throw new Error('PROMETH_SESSION_SECRET is required in production.')
  const sign = (id: string) => createHmac('sha256', secret).update(id).digest('base64url')
  const raw = request.headers.get('cookie')?.match(/(?:^|;\s*)prometh_uid=([^;]+)/)?.[1] ?? ''
  const [id, signature] = raw.split('.')
  if (/^[0-9a-f-]{36}$/i.test(id ?? '') && /^[A-Za-z0-9_-]{43}$/.test(signature ?? '') && signature.length === sign(id).length && timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))) return { user: id }
  const user = randomUUID()
  return { user, cookie: `prometh_uid=${user}.${sign(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` }
}
/** Redact recursively, including property names, before serialization (also handles escaped secrets). */
export function redact(value: unknown, secret: string): unknown {
  if (!secret) return value
  if (typeof value === 'string') return value.split(secret).join('[redacted]')
  if (Array.isArray(value)) return value.map((v) => redact(v, secret))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.split(secret).join('[redacted]'), redact(v, secret)]))
  return value
}
