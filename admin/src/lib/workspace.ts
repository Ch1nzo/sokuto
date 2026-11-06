import { createContext, useContext } from 'react'
import { setWorkspaceId } from './api'

/** Row of GET /api/workspaces (src/workspaces.ts). Workspace 1 ("Default") always exists and cannot be deleted. */
export type Workspace = { id: number; name: string; createdAt: string }

type WorkspaceState = {
  workspaces: Workspace[]
  /** This tab's workspace; undefined until the list has loaded. */
  current: Workspace | undefined
  /** Conversations with unread messages in this workspace (GET /api/inbox/counts); null until it first loads. */
  unread: number | null
  /** Why the list could not be loaded (null when it loaded or is loading). */
  error: unknown
  /** Re-reads the workspace list (after create / rename / delete). */
  reload: () => Promise<void>
}

/** Provided by the shell (App.tsx). */
export const WorkspaceContext = createContext<WorkspaceState>({ workspaces: [], current: undefined, unread: null, error: null, reload: async () => {} })

export const useWorkspaces = () => useContext(WorkspaceContext)

/** Badge text for a count that may hit the API cap: 0–99 as is, then "99+". */
export const countLabel = (n: number) => (n > 99 ? '99+' : String(n))

/**
 * Switches this tab to another workspace with a fresh page load, staying in the same section
 * (`/inbox/42` → `/inbox`: the open record belongs to the old workspace).
 */
export function switchWorkspace(id: number) {
  setWorkspaceId(id)
  const { pathname, search, hash } = window.location
  const section = pathname.split('/').slice(0, 2).join('/') || '/'
  window.history.replaceState(null, '', section + search + hash)
  window.location.reload()
}
