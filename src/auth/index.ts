import { Hono, type Context, type Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Env } from '../env'
import { hashPassword, randomToken, sha256Hex, signToken, verifyPassword, verifyToken } from '../crypto'
import { getOrCreateSecret } from '../settings'
import { createDb } from '../db'
import { getWorkspace, parseWorkspaceId } from '../workspaces'

/** `ws` is the workspace the request works on (resolveWorkspace; the token's workspace for MCP tokens). */
export type AppEnv = { Bindings: Env; Variables: { auth: 'session' | 'mcp'; ws: number } }

const COOKIE = 'sokuto_session'
const SESSION_DAYS = 30

export async function hasAdmin(kv: KVNamespace): Promise<boolean> {
  return (await kv.get('admin:password')) !== null
}

export async function isAuthenticated(c: Context<AppEnv>): Promise<boolean> {
  const token = getCookie(c, COOKIE)
  if (!token) return false
  const secret = await getOrCreateSecret(c.env.KV, 'session_secret')
  const payload = await verifyToken<{ sub: string; exp: number }>(secret, token)
  return payload?.sub === 'admin'
}

/** Accepts either the admin cookie or the MCP bearer token. */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  if (await isAuthenticated(c)) {
    c.set('auth', 'session')
    return next()
  }
  const tokenWs = await checkBearer(c)
  if (tokenWs !== null) {
    c.set('auth', 'mcp')
    c.set('ws', tokenWs)
    return next()
  }
  return c.json({ error: 'unauthorized' }, 401)
}

/** The workspace a session request asks for: `X-Workspace` header, else the `sokuto_ws` cookie. */
export const requestedWorkspace = (c: Context<AppEnv>) => c.req.header('x-workspace') || getCookie(c, 'sokuto_ws')

/** Session requests work on the requested workspace (default 1). MCP tokens keep their own. */
export async function resolveWorkspace(c: Context<AppEnv>, next: Next) {
  if (c.get('auth') === 'session') {
    const raw = requestedWorkspace(c)
    const ws = raw ? parseWorkspaceId(raw) : 1
    if (ws === null || !(await getWorkspace(createDb(c.env.DB), ws))) return c.json({ error: 'workspace_not_found' }, 404)
    c.set('ws', ws)
  }
  return next()
}

/**
 * Workspace of the MCP bearer token, or null. KV: `mcp:token:<sha256>` = workspace id, `mcp:ws:<id>` = hash.
 * The single token from before workspaces (`mcp:token_hash`) belongs to workspace 1 and is moved on first use.
 */
export async function checkBearer(c: Context<AppEnv>): Promise<number | null> {
  const h = c.req.header('authorization') ?? ''
  if (!h.toLowerCase().startsWith('bearer ')) return null
  const token = h.slice(7).trim()
  if (!token) return null
  const kv = c.env.KV
  const hash = await sha256Hex(token)
  const ws = await kv.get(`mcp:token:${hash}`)
  if (ws) return Number(ws)
  if ((await kv.get('mcp:token_hash')) !== hash) return null
  await kv.put(`mcp:token:${hash}`, '1')
  await kv.put('mcp:ws:1', hash)
  await kv.delete('mcp:token_hash')
  return 1
}

/** Hash of the workspace's MCP token (workspace 1 may still have the pre-workspace key). */
export async function mcpTokenHash(kv: KVNamespace, ws: number): Promise<string | null> {
  return (await kv.get(`mcp:ws:${ws}`)) ?? (ws === 1 ? kv.get('mcp:token_hash') : null)
}

/** Replaces (token) or revokes (null) the workspace's MCP token. */
export async function setMcpToken(kv: KVNamespace, ws: number, token: string | null) {
  const old = await mcpTokenHash(kv, ws)
  if (old) await kv.delete(`mcp:token:${old}`)
  if (ws === 1) await kv.delete('mcp:token_hash')
  if (!token) return kv.delete(`mcp:ws:${ws}`)
  const hash = await sha256Hex(token)
  await kv.put(`mcp:token:${hash}`, String(ws))
  await kv.put(`mcp:ws:${ws}`, hash)
}

async function issueSession(c: Context<AppEnv>) {
  const secret = await getOrCreateSecret(c.env.KV, 'session_secret')
  const token = await signToken(secret, { sub: 'admin', iat: Date.now(), exp: Date.now() + SESSION_DAYS * 86400_000, nonce: randomToken(8) })
  const secure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86400 })
}

async function rateLimited(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `ratelimit:login:${ip}`
  const n = Number((await kv.get(key)) ?? '0')
  if (n >= 10) return true
  await kv.put(key, String(n + 1), { expirationTtl: 900 })
  return false
}

export const authRoutes = new Hono<AppEnv>()
  .get('/status', async (c) => {
    const setupRequired = !(await hasAdmin(c.env.KV))
    return c.json({ setupRequired, authenticated: setupRequired ? false : await isAuthenticated(c) })
  })
  .post('/setup', async (c) => {
    if (await hasAdmin(c.env.KV)) return c.json({ error: 'already_setup' }, 409)
    const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string })
    const password = body.password ?? ''
    if (password.length < 8) return c.json({ error: 'password_too_short' }, 400)
    await c.env.KV.put('admin:password', await hashPassword(password))
    await issueSession(c)
    return c.json({ ok: true })
  })
  .post('/login', async (c) => {
    const ip = c.req.header('cf-connecting-ip') ?? 'local'
    if (await rateLimited(c.env.KV, ip)) return c.json({ error: 'too_many_attempts' }, 429)
    const body = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string })
    const stored = await c.env.KV.get('admin:password')
    if (!stored || !(await verifyPassword(body.password ?? '', stored))) return c.json({ error: 'invalid_password' }, 401)
    await issueSession(c)
    return c.json({ ok: true })
  })
  .post('/logout', async (c) => {
    deleteCookie(c, COOKIE, { path: '/' })
    return c.json({ ok: true })
  })
  .post('/password', requireAuth, async (c) => {
    const body = await c.req.json<{ current?: string; password?: string }>().catch(() => ({}) as { current?: string; password?: string })
    const stored = await c.env.KV.get('admin:password')
    if (!stored || !(await verifyPassword(body.current ?? '', stored))) return c.json({ error: 'invalid_password' }, 401)
    if ((body.password ?? '').length < 8) return c.json({ error: 'password_too_short' }, 400)
    await c.env.KV.put('admin:password', await hashPassword(body.password!))
    return c.json({ ok: true })
  })
