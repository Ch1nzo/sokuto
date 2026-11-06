import { describe, it, expect } from 'vitest'
import { parseWorkspaceId } from '../src/workspaces'
import { wsKey } from '../src/settings'

describe('parseWorkspaceId', () => {
  it('accepts positive integers', () => {
    expect(parseWorkspaceId('1')).toBe(1)
    expect(parseWorkspaceId('42')).toBe(42)
  })

  it('rejects anything else', () => {
    for (const raw of [undefined, '', '0', '-1', '01', '1.5', '2a', ' 2', '1e3', '9999999999']) expect(parseWorkspaceId(raw)).toBeNull()
  })
})

describe('wsKey', () => {
  it('prefixes settings keys with the workspace', () => {
    expect(wsKey(1, 'general')).toBe('ws:1:general')
    expect(wsKey(12, 'channel:line')).toBe('ws:12:channel:line')
  })

  it('keeps one workspace prefix from matching another (LIKE ws:1:% vs ws:12:)', () => {
    expect(wsKey(12, 'general').startsWith(wsKey(1, ''))).toBe(false)
  })
})
