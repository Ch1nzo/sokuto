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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  // Dev-only worst-case data (`?data=worst|empty|one|huge`). The DEV guard is replaced by `false`
  // in production builds, so this branch and the fixture module are dropped from the bundle.
  if (import.meta.env.DEV && method === 'GET') {
    const { devFixture } = await import('./devFixtures')
    const fixture = devFixture(path)
    if (fixture !== undefined) return fixture as T
  }
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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
