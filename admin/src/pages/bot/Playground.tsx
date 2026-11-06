import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Banner, Button, Spinner, TextField } from '@channel.io/bezier-react'
import { AiOffIcon, ChatBubbleIcon, CheckIcon, HeadsetIcon, InfoFilledIcon, RefreshIcon, SendIcon } from '@channel.io/bezier-icons'
import { ApiError, api, errorMessage } from '../../lib/api'
import { useT, type Key } from '../../lib/i18n'
import { EmptyState, ErrorBanner, LoadingState } from '../../components'
import { BotFrame, DEFAULT_BOT_NAME, useBot, useReasonLabel } from './shared'
import type { BotConfig, PlaygroundReply } from './types'

/** `content` is what the customer would have received (what runBot sends for this result). */
type Turn = { role: 'user' | 'assistant'; content: string; result?: PlaygroundReply }

/** Mirrors src/bot.ts runBot: answer → reply; handoff (or unknown with unknownAction handoff) → handoffMessage; unknown → fallbackMessage. */
function outcome(r: PlaygroundReply, cfg: BotConfig | undefined): { handoff: boolean; text: string } {
  const handoff = r.action === 'handoff' || (r.action === 'unknown' && cfg?.unknownAction !== 'fallback')
  if (r.action === 'answer') return { handoff: false, text: r.reply }
  return { handoff, text: (handoff ? cfg?.handoffMessage : cfg?.fallbackMessage) ?? r.reply }
}

function Details({ r }: { r: PlaygroundReply }) {
  const t = useT()
  const reasonLabel = useReasonLabel()
  const list = (items: { id: number; label: string }[]) => (items.length === 0 ? '—' : <ul>{items.map((i) => <li key={i.id}>{i.label}</li>)}</ul>)
  return (
    <details className="bot-pg__details">
      <summary>{t('bot_pg_details')}</summary>
      <dl>
        <dt>{t('bot_pg_action')}</dt>
        <dd>{t(`bot_pg_action_${r.action}` as Key)}</dd>
        <dt>{t('bot_ov_resolved')}</dt>
        <dd>{r.resolved ? t('bot_yes') : t('bot_no')}</dd>
        {r.action !== 'answer' && (
          <>
            <dt>{t('bot_pg_reason')}</dt>
            <dd>{reasonLabel(r.reason)}</dd>
          </>
        )}
        <dt>FAQ</dt>
        <dd>{list(r.faqs.map((f) => ({ id: f.id, label: f.question })))}</dd>
        <dt>{t('bot_nav_products')}</dt>
        <dd>{list(r.products.map((p) => ({ id: p.id, label: p.name })))}</dd>
        <dt>{t('bot_documents')}</dt>
        <dd>{list(r.documents.map((d) => ({ id: d.id, label: d.name })))}</dd>
      </dl>
      <details className="bot-pg__raw">
        <summary>{t('bot_pg_raw')}</summary>
        <pre>{r.raw}</pre>
      </details>
    </details>
  )
}

export default function Playground() {
  const t = useT()
  const reasonLabel = useReasonLabel()
  const { bot, error: loadError, reload } = useBot()
  const cfg = bot?.config
  const name = cfg?.name || DEFAULT_BOT_NAME
  const ready = !!bot?.aiConfigured
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

  /** Every turn re-sends the whole conversation; nothing is sent to a channel or logged. */
  const ask = async (history: Turn[]) => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<PlaygroundReply>('/api/bot/playground', { messages: history.map(({ role, content }) => ({ role, content })) })
      setTurns([...history, { role: 'assistant', content: outcome(r, cfg).text, result: r }])
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'ai_not_configured' ? t('bot_ov_no_ai') : errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const send = (e?: FormEvent) => {
    e?.preventDefault()
    const body = text.trim()
    if (!body || busy || !ready) return
    const history: Turn[] = [...turns, { role: 'user', content: body }]
    setTurns(history)
    setText('')
    void ask(history)
  }

  const reset = () => {
    setTurns([])
    setError(null)
  }

  // Waiting for GET /api/bot: the AI status decides whether the input is enabled.
  if (!bot) return <BotFrame section="playground">{loadError ? <ErrorBanner error={loadError} onRetry={() => void reload()} /> : <LoadingState compact />}</BotFrame>

  return (
    <BotFrame
      section="playground"
      actions={<Button styleVariant="secondary" colorVariant="monochrome-dark" leftContent={RefreshIcon} text={t('test_reset')} disabled={turns.length === 0 || busy} onClick={reset} />}
    >
      <div className="stack">
        {ready ? (
          <Banner variant="blue" icon={InfoFilledIcon} content={t('bot_pg_cost')} />
        ) : (
          <Banner
            variant="orange"
            icon={AiOffIcon}
            content={`${t('bot_ov_no_ai')} `}
            hasLink
            linkText={t('bot_open_ai_settings')}
            renderLink={({ content }) => (
              <Link to="/settings#ai" className="banner-link">
                {content}
              </Link>
            )}
          />
        )}

        <section className="card bot-pg" aria-label={t('bot_nav_playground')}>
          <div className="bot-pg__log" ref={logRef} aria-live="polite">
            {turns.length === 0 && !busy ? (
              <div className="bot-pg__empty">
                <EmptyState compact icon={ChatBubbleIcon} title={t('bot_pg_empty').replace('{name}', name)} description={t('bot_pg_empty_desc')} />
              </div>
            ) : (
              turns.map((turn, i) => {
                if (turn.role === 'user') {
                  return (
                    <div key={i} className="bot-pg__msg bot-pg__msg--in">
                      <div className="bubble in">{turn.content}</div>
                    </div>
                  )
                }
                const r = turn.result!
                const { handoff } = outcome(r, cfg)
                return (
                  <div key={i} className="bot-pg__msg bot-pg__msg--out">
                    {handoff && <Banner className="bot-pg__handoff" variant="orange" icon={HeadsetIcon} content={t('bot_pg_handoff').replace('{reason}', reasonLabel(r.reason))} />}
                    {turn.content && <div className="bubble out bot-bubble">{turn.content}</div>}
                    <div className="bot-pg__meta">
                      <span>{name}</span>
                      {r.resolved && (
                        <Badge size="xs" variant="green" icon={CheckIcon}>
                          {t('bot_ov_resolved')}
                        </Badge>
                      )}
                    </div>
                    <Details r={r} />
                  </div>
                )
              })
            )}
            {busy && (
              <div className="bot-pg__msg bot-pg__msg--out">
                <Spinner size="s" />
              </div>
            )}
          </div>
          {error !== null && (
            <div className="bot-pg__error">
              <ErrorBanner error={error} onRetry={() => void ask(turns)} />
            </div>
          )}
          <form className="bot-pg__composer" onSubmit={send}>
            <TextField
              size="m"
              value={text}
              disabled={!ready}
              placeholder={t('bot_pg_placeholder')}
              aria-label={t('bot_pg_placeholder')}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter that confirms an IME conversion must not send.
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (!e.nativeEvent.isComposing) send()
              }}
            />
            <Button type="submit" leftContent={SendIcon} text={t('inbox_send')} disabled={!ready || busy || !text.trim()} />
          </form>
        </section>
      </div>
    </BotFrame>
  )
}
