import type { Db } from './db'
import type { Env } from './env'
import { getAiConfig, type AiConfig } from './settings'

export type AiMessage = { role: 'user' | 'assistant'; content: string }
export type AiRequest = { system: string; messages: AiMessage[]; maxTokens?: number }
/** Calls the configured provider and returns the reply text. Throws on failure. */
export type AiCaller = (req: AiRequest) => Promise<string>
export type IntentCandidate = { flowId: number; description: string; examples?: string[] }

/** Used when `AiConfig.model` is empty. OpenAI-compatible APIs have no default (model is required). */
export const DEFAULT_MODEL: Record<AiConfig['provider'], string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: '',
  workers_ai: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
}

async function postJson<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new Error(`ai_http_${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}

export async function complete(cfg: AiConfig, req: AiRequest, ai?: Ai): Promise<string> {
  const model = cfg.model || DEFAULT_MODEL[cfg.provider]
  const maxTokens = req.maxTokens ?? 1024
  const messages = [{ role: 'system', content: req.system }, ...req.messages]
  if (cfg.provider === 'workers_ai') {
    // The binding is missing in `wrangler dev` without login and on deployments made before it was added.
    if (!ai) throw new Error('workers_ai_binding_missing')
    const out = await (ai as unknown as { run(model: string, input: unknown): Promise<{ response?: string }> }).run(model, { messages, max_tokens: maxTokens })
    return out.response ?? ''
  }
  if (cfg.provider === 'anthropic') {
    const r = await postJson<{ content?: Array<{ type: string; text?: string }> }>(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2026-10-21' },
      { model, max_tokens: maxTokens, system: req.system, messages: req.messages },
    )
    return (r.content ?? []).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('')
  }
  // ponytail: no token cap for OpenAI-compatible APIs (max_tokens vs max_completion_tokens differs by model); prompts keep replies short.
  const base = (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const r = await postJson<{ choices?: Array<{ message?: { content?: string | null } }> }>(
    `${base}/chat/completions`,
    { authorization: `Bearer ${cfg.apiKey ?? ''}` },
    { model, messages },
  )
  return r.choices?.[0]?.message?.content ?? ''
}

/** AiCaller that loads the workspace's settings on first use; throws `ai_not_configured` when none are saved. */
export function lazyAi(env: Env, db: Db, ws: number): AiCaller {
  let cfg: Promise<AiConfig | null> | undefined
  return async (req) => {
    const c = await (cfg ??= getAiConfig(db, env.KV, ws))
    if (!c) throw new Error('ai_not_configured')
    return complete(c, req, env.AI)
  }
}

/** The outermost `{…}` in a model reply (tolerates ```json fences and surrounding prose). */
function jsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const v: unknown = JSON.parse(raw.slice(start, end + 1))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** `{"reply": string, "done": boolean}` → parts. A model that ignores the format gets its text sent as is (done=false). */
export function parseAiReply(raw: string): { reply: string; done: boolean } {
  const v = jsonObject(raw)
  if (v && typeof v.reply === 'string') return { reply: v.reply.trim(), done: v.done === true }
  return { reply: raw.trim(), done: false }
}

export function intentPrompt(text: string, candidates: IntentCandidate[]): AiRequest {
  const list = candidates
    .map((c) => `- flowId ${c.flowId}: ${c.description}${c.examples?.length ? ` (examples: ${c.examples.map((e) => JSON.stringify(e)).join(', ')})` : ''}`)
    .join('\n')
  return {
    system: `Classify the user's message into one of these intents:\n${list}\n\nAnswer with JSON only: {"flowId": <number>} for the intent that clearly matches, or {"flowId": null} when none does.`,
    messages: [{ role: 'user', content: text }],
  }
}

/** flowId from the classifier reply, or null (no match, unknown id, unparsable). */
export function parseIntent(raw: string, candidates: IntentCandidate[]): number | null {
  const id = jsonObject(raw)?.flowId
  return typeof id === 'number' && candidates.some((c) => c.flowId === id) ? id : null
}

export async function classifyIntent(ai: AiCaller, text: string, candidates: IntentCandidate[]): Promise<number | null> {
  if (!candidates.length) return null
  try {
    return parseIntent(await ai(intentPrompt(text, candidates)), candidates)
  } catch {
    return null
  }
}
