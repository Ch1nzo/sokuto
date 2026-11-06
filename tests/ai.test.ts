import { describe, it, expect } from 'vitest'
import { classifyIntent, intentPrompt, parseAiReply, parseIntent, type IntentCandidate } from '../src/ai'

describe('parseAiReply', () => {
  it('reads plain JSON', () => {
    expect(parseAiReply('{"reply": "こんにちは", "done": false}')).toEqual({ reply: 'こんにちは', done: false })
    expect(parseAiReply('{"reply":"Bye","done":true}')).toEqual({ reply: 'Bye', done: true })
  })

  it('strips a ```json fence', () => {
    expect(parseAiReply('```json\n{"reply": "OK", "done": true}\n```')).toEqual({ reply: 'OK', done: true })
  })

  it('finds the object inside surrounding prose', () => {
    expect(parseAiReply('Sure! Here it is: {"reply": "営業は 10 時からです", "done": false} Hope that helps.')).toEqual({
      reply: '営業は 10 時からです',
      done: false,
    })
  })

  it('sends non-JSON text as is and keeps the conversation going', () => {
    expect(parseAiReply('  Just plain text  ')).toEqual({ reply: 'Just plain text', done: false })
    expect(parseAiReply('{broken json}')).toEqual({ reply: '{broken json}', done: false })
    expect(parseAiReply('{"answer": "no reply field"}')).toEqual({ reply: '{"answer": "no reply field"}', done: false })
  })
})

const candidates: IntentCandidate[] = [
  { flowId: 3, description: 'asks about shipping', examples: ['いつ届く?', 'Where is my order'] },
  { flowId: 7, description: 'wants to book a table' },
]

describe('parseIntent', () => {
  it('returns the matching flow id', () => {
    expect(parseIntent('{"flowId": 7}', candidates)).toBe(7)
  })

  it('returns null for null', () => {
    expect(parseIntent('{"flowId": null}', candidates)).toBeNull()
  })

  it('returns null for an id that is not a candidate', () => {
    expect(parseIntent('{"flowId": 99}', candidates)).toBeNull()
    expect(parseIntent('{"flowId": "3"}', candidates)).toBeNull()
    expect(parseIntent('no idea', candidates)).toBeNull()
  })

  it('reads a fenced reply', () => {
    expect(parseIntent('```json\n{"flowId": 3}\n```', candidates)).toBe(3)
  })
})

describe('intentPrompt', () => {
  it('lists each description and its examples', () => {
    const req = intentPrompt('荷物はいつ届きますか', candidates)
    expect(req.system).toContain('flowId 3: asks about shipping')
    expect(req.system).toContain('"いつ届く?"')
    expect(req.system).toContain('"Where is my order"')
    expect(req.system).toContain('flowId 7: wants to book a table')
    expect(req.messages).toEqual([{ role: 'user', content: '荷物はいつ届きますか' }])
  })
})

describe('classifyIntent', () => {
  it('uses the caller and swallows its errors', async () => {
    expect(await classifyIntent(async () => '{"flowId": 3}', 'hi', candidates)).toBe(3)
    expect(
      await classifyIntent(
        async () => {
          throw new Error('ai_not_configured')
        },
        'hi',
        candidates,
      ),
    ).toBeNull()
  })
})
