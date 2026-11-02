import { describe, it, expect } from 'vitest'
import {
  base64url,
  decryptString,
  encryptString,
  fromBase64url,
  hashPassword,
  randomToken,
  signToken,
  timingSafeEqual,
  verifyPassword,
  verifyToken,
} from '../src/crypto'

describe('base64url', () => {
  it('round trips arbitrary bytes', () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i++) bytes[i] = i
    const enc = base64url(bytes)
    expect(enc).not.toMatch(/[+/=]/)
    expect([...fromBase64url(enc)]).toEqual([...bytes])
  })

  it('round trips lengths that need padding', () => {
    for (const len of [0, 1, 2, 3, 4, 5]) {
      const bytes = new Uint8Array(len).map((_, i) => 250 + i)
      expect([...fromBase64url(base64url(bytes))]).toEqual([...bytes])
    }
  })

  it('accepts ArrayBuffer input', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer
    expect(base64url(buf)).toBe('AQID')
  })

  it('randomToken encodes the requested number of bytes', () => {
    expect(fromBase64url(randomToken(32)).length).toBe(32)
    expect(fromBase64url(randomToken(8)).length).toBe(8)
    expect(randomToken()).not.toBe(randomToken())
  })
})

describe('timingSafeEqual', () => {
  it('compares strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
  })
})

describe('hashPassword / verifyPassword', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('s3cret-パス')
    expect(stored).toMatch(/^pbkdf2\$100000\$[\w-]+\$[\w-]+$/)
    expect(await verifyPassword('s3cret-パス', stored)).toBe(true)
    expect(await verifyPassword('s3cret-pas', stored)).toBe(false)
  })

  it('uses a random salt', async () => {
    expect(await hashPassword('x')).not.toBe(await hashPassword('x'))
  })

  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt$1$a$b')).toBe(false)
  })
})

describe('signToken / verifyToken', () => {
  const secret = 'test-secret'

  it('round trips a payload', async () => {
    const token = await signToken(secret, { sub: 'admin', exp: Date.now() + 60_000 })
    const payload = await verifyToken<{ sub: string }>(secret, token)
    expect(payload?.sub).toBe('admin')
  })

  it('rejects a tampered signature', async () => {
    const token = await signToken(secret, { sub: 'admin' })
    const [body, sig] = token.split('.')
    const flipped = sig!.slice(0, -1) + (sig!.endsWith('A') ? 'B' : 'A')
    expect(await verifyToken(secret, `${body}.${flipped}`)).toBeNull()
  })

  it('rejects a tampered body', async () => {
    const token = await signToken(secret, { sub: 'user' })
    const sig = token.split('.')[1]
    const forged = base64url(new TextEncoder().encode(JSON.stringify({ sub: 'admin' })))
    expect(await verifyToken(secret, `${forged}.${sig}`)).toBeNull()
  })

  it('rejects a token signed with another secret', async () => {
    const token = await signToken('other', { sub: 'admin' })
    expect(await verifyToken(secret, token)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = await signToken(secret, { sub: 'admin', exp: Date.now() - 1 })
    expect(await verifyToken(secret, token)).toBeNull()
  })

  it('rejects malformed tokens', async () => {
    expect(await verifyToken(secret, '')).toBeNull()
    expect(await verifyToken(secret, 'nodot')).toBeNull()
    expect(await verifyToken(secret, '.sig')).toBeNull()
  })
})

describe('encryptString / decryptString', () => {
  it('round trips with a 32-byte key', async () => {
    const key = randomToken(32)
    const enc = await encryptString(key, 'channel-token-値')
    expect(enc.startsWith('enc:')).toBe(true)
    expect(enc).not.toContain('channel-token')
    expect(await decryptString(key, enc)).toBe('channel-token-値')
  })

  it('uses a fresh IV each time', async () => {
    const key = randomToken(32)
    expect(await encryptString(key, 'a')).not.toBe(await encryptString(key, 'a'))
  })

  it('passes through plain (unencrypted) values', async () => {
    expect(await decryptString(randomToken(32), 'plain-token')).toBe('plain-token')
  })

  it('fails to decrypt with the wrong key', async () => {
    const enc = await encryptString(randomToken(32), 'secret')
    await expect(decryptString(randomToken(32), enc)).rejects.toThrow()
  })
})
