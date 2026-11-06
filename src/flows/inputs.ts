/** Answer checks for question steps (pure: shared by the engine and tests). */
export const INPUT_VALIDATIONS = ['email', 'phone', 'number', 'url', 'date'] as const
export type InputValidation = (typeof INPUT_VALIDATIONS)[number]

/** Quick-reply payload of a question's skip button. */
export const SKIP_PAYLOAD = 'sk-skip'
export const DEFAULT_RETRY_TEXT = '入力内容を確認して、もう一度送ってください。'

/** Returns the normalized answer, or null when it is not a valid `kind`. */
export function validateInput(kind: InputValidation, raw: string): string | null {
  const s = raw.trim()
  const half = s.normalize('NFKC') // full-width digits and symbols → half-width
  switch (kind) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
    case 'phone': {
      const p = half.replace(/[\s()\-‐－（）]/g, '')
      return /^\+?\d{8,15}$/.test(p) ? p : null
    }
    case 'number':
      return half !== '' && Number.isFinite(Number(half)) ? half : null
    case 'url':
      try {
        return ['http:', 'https:'].includes(new URL(s).protocol) ? s : null
      } catch {
        return null
      }
    case 'date': {
      const m = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$/.exec(half)
      if (!m) return null
      const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`
      // Date.UTC rolls 2025-02-30 over to March: a round trip that changes the text means no such day.
      return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString().slice(0, 10) === iso ? iso : null
    }
  }
}
