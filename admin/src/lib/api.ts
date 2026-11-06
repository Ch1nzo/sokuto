/// <reference types="vite/client" />
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public body: Record<string, unknown>,
  ) {
    super(code)
  }
}

/*
 * Workspace of this tab. Read once from localStorage (`sokuto:ws`, default 1) so another tab switching
 * workspaces never redirects this tab's writes; sent as `X-Workspace` on every request and mirrored in the
 * `sokuto_ws` cookie for plain links (CSV export).
 */
const WS_KEY = 'sokuto:ws'
let workspaceId = readWorkspaceId()

function readWorkspaceId(): string {
  try {
    const v = localStorage.getItem(WS_KEY)
    if (v && /^[1-9]\d{0,8}$/.test(v)) return v
  } catch {
    /* storage unavailable */
  }
  return '1'
}

function syncCookie() {
  document.cookie = `sokuto_ws=${workspaceId}; path=/; SameSite=Lax`
}

export const getWorkspaceId = () => workspaceId

export function setWorkspaceId(id: number | string) {
  workspaceId = String(id)
  try {
    localStorage.setItem(WS_KEY, workspaceId)
  } catch {
    /* storage unavailable: this tab still uses it */
  }
  syncCookie()
}

let recovering = false

/** The tab's workspace was deleted (or never existed): fall back to the server's `current` and reload once. */
async function recoverWorkspace() {
  if (recovering) return
  recovering = true
  try {
    // Plain fetch: bypasses the dev fixtures, which do not know which workspaces the server has.
    const res = await fetch('/api/workspaces', { headers: { 'X-Workspace': workspaceId }, credentials: 'same-origin' })
    const r = (await res.json()) as { current?: number }
    if (res.ok && r.current && String(r.current) !== workspaceId) {
      setWorkspaceId(r.current)
      window.location.reload()
      return
    }
  } catch {
    /* keep the error the caller already got */
  }
  recovering = false
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Dev-only worst-case data (`?data=worst|empty|one|huge`). The DEV guard is replaced by `false`
  // in production builds, so this branch and the fixture module are dropped from the bundle.
  if (import.meta.env.DEV && method === 'GET') {
    const { devFixture } = await import('./devFixtures')
    const fixture = devFixture(path)
    if (fixture !== undefined) return fixture as T
  }
  syncCookie()
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'X-Workspace': workspaceId, 'Content-Type': 'application/json' } : { 'X-Workspace': workspaceId },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('sokuto:unauthorized'))
    }
    if (res.status === 404 && data.error === 'workspace_not_found' && !path.startsWith('/api/workspaces')) void recoverWorkspace()
    throw new ApiError(res.status, String(data.error ?? res.status), data)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = err.body.detail ?? err.body.message
    const errors = Array.isArray(err.body.errors) ? (err.body.errors as string[]).join('\n') : ''
    return [err.code, detail, errors].filter(Boolean).join(': ')
  }
  return err instanceof Error ? err.message : String(err)
}
