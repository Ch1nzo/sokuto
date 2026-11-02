import { ApiError, errorMessage } from '../../lib/api'
import type { TFn } from './model'

/**
 * Flow API errors as display text. `invalid_definition` responses carry the validator's
 * `errors: string[]`; show them as a bulleted list under a translated lead line.
 */
export function formatFlowError(err: unknown, t: TFn): string {
  if (err instanceof ApiError && Array.isArray(err.body.errors) && err.body.errors.length > 0) {
    const lead = err.code === 'invalid_definition' ? t('editor_invalid') : err.code
    return [lead, ...(err.body.errors as unknown[]).map((e) => `• ${String(e)}`)].join('\n')
  }
  return errorMessage(err)
}
