const enc = new TextEncoder()

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return base64url(buf)
}

export function base64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function toBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hmacSha256(secret: string, data: string | ArrayBuffer): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data)
}

export async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(data)))
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Password hashing with PBKDF2-SHA256 (WebCrypto, available on Workers). */
export async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: s as BufferSource, iterations: 100_000 }, key, 256)
  return `pbkdf2$100000$${base64url(s)}$${base64url(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const salt = fromBase64url(parts[2]!)
  const candidate = await hashPassword(password, salt)
  return timingSafeEqual(candidate, stored)
}

/** Signed, expiring tokens for admin sessions: payload.signature */
export async function signToken(secret: string, payload: Record<string, unknown>): Promise<string> {
  const body = base64url(enc.encode(JSON.stringify(payload)))
  const sig = base64url(await hmacSha256(secret, body))
  return `${body}.${sig}`
}

export async function verifyToken<T = Record<string, unknown>>(secret: string, token: string): Promise<T | null> {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = base64url(await hmacSha256(secret, body))
  if (!timingSafeEqual(expected, sig)) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as T & { exp?: number }
    if (payload.exp && payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/** AES-GCM encryption for channel tokens stored in D1. The key lives in KV. */
async function aesKey(rawKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64url(rawKeyB64) as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptString(rawKeyB64: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await aesKey(rawKeyB64)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain))
  return `enc:${base64url(iv)}:${base64url(ct)}`
}

export async function decryptString(rawKeyB64: string, value: string): Promise<string> {
  if (!value.startsWith('enc:')) return value
  const [, ivB64, ctB64] = value.split(':')
  const key = await aesKey(rawKeyB64)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64url(ivB64!) as BufferSource }, key, fromBase64url(ctB64!) as BufferSource)
  return new TextDecoder().decode(pt)
}
