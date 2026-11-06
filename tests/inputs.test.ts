import { describe, it, expect } from 'vitest'
import { validateInput } from '../src/flows/inputs'

describe('validateInput', () => {
  it('email', () => {
    expect(validateInput('email', 'a@b.co')).toBe('a@b.co')
    expect(validateInput('email', '  a@b.co \n')).toBe('a@b.co')
    expect(validateInput('email', 'nope')).toBeNull()
    expect(validateInput('email', 'a@b')).toBeNull()
  })

  it('phone', () => {
    expect(validateInput('phone', '090-1234-5678')).toBe('09012345678')
    expect(validateInput('phone', '+81 90 1234 5678')).toBe('+819012345678')
    expect(validateInput('phone', '０９０－１２３４－５６７８')).toBe('09012345678')
    expect(validateInput('phone', '(03) 1234-5678')).toBe('0312345678')
    expect(validateInput('phone', '1234')).toBeNull()
    expect(validateInput('phone', 'abc')).toBeNull()
  })

  it('number', () => {
    expect(validateInput('number', '42')).toBe('42')
    expect(validateInput('number', '３.５')).toBe('3.5')
    expect(validateInput('number', 'abc')).toBeNull()
    expect(validateInput('number', '')).toBeNull()
    expect(validateInput('number', '  ')).toBeNull()
  })

  it('url', () => {
    expect(validateInput('url', 'https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(validateInput('url', 'ftp://x')).toBeNull()
    expect(validateInput('url', 'example.com')).toBeNull()
  })

  it('date', () => {
    expect(validateInput('date', '2025-01-31')).toBe('2025-01-31')
    expect(validateInput('date', '2025/1/5')).toBe('2025-01-05')
    expect(validateInput('date', '2025年1月5日')).toBe('2025-01-05')
    expect(validateInput('date', '２０２５年１月５日')).toBe('2025-01-05')
    expect(validateInput('date', '2024-02-29')).toBe('2024-02-29')
    expect(validateInput('date', '2025-02-30')).toBeNull()
    expect(validateInput('date', '2025-13-01')).toBeNull()
    expect(validateInput('date', 'tomorrow')).toBeNull()
  })
})
