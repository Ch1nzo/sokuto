import { useEffect, useRef, useState } from 'react'
import { Badge, Button, Divider, HStack, Icon, KeyValueItem, SegmentedControl, SegmentedControlItem, Spinner, Tag, Text, TextField, VStack } from '@channel.io/bezier-react'
import { CancelIcon, ChatBubbleIcon, CommentIcon, NotificationIcon, PersonAddIcon, RefreshIcon, SendIcon, ArrowRightUpSmallIcon } from '@channel.io/bezier-icons'
import type { FlowDefinition } from '@shared/flows/types'
import type { Channel, OutboundButton } from '@shared/channels/types'
import { api } from '../../lib/api'
import type { Key } from '../../lib/i18n'
import { ErrorBanner } from '../../components'
import { IconBtn } from './fields'
import { TEST_CHANNELS, type SimulatedInput, type SimulationResult, type TFn } from './model'
import { formatFlowError } from './errors'

function inputLabel(input: SimulatedInput, t: TFn): string {
  if (input.button) return input.button
  if (input.type === 'follow') return t('test_follow')
  return input.text ?? input.payload ?? input.ref ?? input.type
}

function waitingLabel(waiting: string, t: TFn): string {
  if (waiting === 'input') return t('test_waiting_input')
  if (waiting === 'button') return t('test_waiting_button')
  return waiting
}

/**
 * Simulated conversation against the current (unsaved) definition. Every send re-posts the whole
 * input history to POST /api/flows/:id/test with `newContact: true`, so the transcript is always
 * the server's replay of all inputs so far.
 */
export function TestPanel({ flowId, definition, defaultChannel, onClose, t }: { flowId: string; definition: FlowDefinition; defaultChannel: Channel; onClose?: () => void; t: TFn }) {
  const [inputs, setInputs] = useState<SimulatedInput[]>([])
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [text, setText] = useState('')
  const [channel, setChannel] = useState<Channel>(defaultChannel)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => setChannel(defaultChannel), [defaultChannel])

  useEffect(() => {
    const el = transcriptRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [result, busy])

  const run = async (next: SimulatedInput[], ch: Channel = channel) => {
    setInputs(next)
    setError('')
    if (next.length === 0) {
      setResult(null)
      return
    }
    setBusy(true)
    try {
      const r = await api.post<SimulationResult>(`/api/flows/${flowId}/test`, { inputs: next, channel: ch, newContact: true, definition })
      setResult(r)
    } catch (err) {
      setError(formatFlowError(err, t))
    } finally {
      setBusy(false)
    }
  }

  const send = (input: SimulatedInput) => {
    void run([...inputs, input])
    if (input.text !== undefined) setText('')
  }

  const reset = () => {
    setInputs([])
    setResult(null)
    setError('')
    setText('')
  }

  const chip = (b: OutboundButton, k: number) =>
    b.url ? (
      <a key={k} className="chip" href={b.url} target="_blank" rel="noreferrer">
        {b.label}
        <Icon source={ArrowRightUpSmallIcon} size="xs" />
      </a>
    ) : (
      <button key={k} type="button" className="chip" disabled={busy} onClick={() => send({ type: 'message', button: b.label })}>
        {b.label}
      </button>
    )

  const trimmed = text.trim()
  const lastStep = result?.steps[result.steps.length - 1]
  const fields = result ? Object.entries(result.fields) : []

  return (
    <section className="card fe-test" aria-labelledby="fe-test-title">
      <div className="fe-test__head">
        <VStack spacing={2} className="fe-grow">
          <Text as="h2" id="fe-test-title" typo="16" bold color="txt-black-darkest">
            {t('test_title')}
          </Text>
          <Text typo="12" color="txt-black-dark">
            {t('test_lead')}
          </Text>
        </VStack>
        <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={RefreshIcon} text={t('test_reset')} disabled={inputs.length === 0 && !error} onClick={reset} />
        {onClose && (
          <span className="fe-test__close">
            <IconBtn icon={CancelIcon} label={t('close')} onClick={onClose} />
          </span>
        )}
      </div>

      <SegmentedControl
        type="radiogroup"
        size="s"
        width="100%"
        value={channel}
        aria-label={t('editor_channel')}
        onValueChange={(ch: Channel) => {
          setChannel(ch)
          if (inputs.length) void run(inputs, ch)
        }}
      >
        {TEST_CHANNELS.map((c) => (
          <SegmentedControlItem key={c} value={c}>
            {t(`channel_${c}` as Key)}
          </SegmentedControlItem>
        ))}
      </SegmentedControl>

      <div className="fe-transcript" ref={transcriptRef} aria-live="polite">
        {!result && !busy && (
          <div className="fe-transcript__empty">
            <Icon source={ChatBubbleIcon} size="m" color="txt-black-dark" />
            <Text typo="13" color="txt-black-dark" align="center">
              {t('test_empty')}
            </Text>
          </div>
        )}
        {result?.steps.map((s, i) => (
          <div key={i} className="fe-turn">
            <div className="bubble in">
              {inputLabel(s.input, t)}
              {s.input.type === 'comment' && <div className="meta">{t('test_comment')}</div>}
            </div>
            {!s.triggered && (
              <Text typo="12" color="txt-black-dark" className="fe-turn__note">
                {t('test_not_triggered')}
              </Text>
            )}
            {s.outputs.map((o, j) => {
              const chips = [...(o.buttons ?? []), ...(o.quickReplies ?? [])]
              return (
                <div key={j} className="fe-out">
                  {(o.text || o.imageUrl) && (
                    <div className="bubble out">
                      {o.imageUrl && <img src={o.imageUrl} alt="" className="fe-out__img" />}
                      {o.text}
                    </div>
                  )}
                  {o.attachment && (
                    <a className="bubble out fe-wrap" href={o.attachment.url} target="_blank" rel="noreferrer">
                      {t(`attachment_${o.attachment.type}`)}: {o.attachment.url}
                    </a>
                  )}
                  {o.cards && o.cards.length > 0 && (
                    <div className="fe-cards">
                      {o.cards.map((c, k) => (
                        <div key={k} className="fe-card">
                          {c.imageUrl && <img src={c.imageUrl} alt="" className="fe-card__img" />}
                          <div className="fe-card__title">{c.title}</div>
                          {c.subtitle && <div className="fe-card__sub">{c.subtitle}</div>}
                          {c.buttons.length > 0 && <div className="chips">{c.buttons.map(chip)}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {chips.length > 0 && <div className="chips fe-out__chips">{chips.map(chip)}</div>}
                </div>
              )
            })}
            {s.commentReplies.map((c, j) => (
              <div key={`c${j}`} className="fe-comment-reply">
                <Icon source={CommentIcon} size="xs" color="txt-black-dark" />
                <Text typo="12" color="txt-black-dark" className="fe-wrap">
                  {c}
                </Text>
              </div>
            ))}
          </div>
        ))}
        {busy && (
          <div className="fe-transcript__busy">
            <Spinner size="s" />
          </div>
        )}
      </div>

      {error && <ErrorBanner error={error} />}

      <VStack spacing={8}>
        <TextField
          value={text}
          placeholder={t('test_placeholder')}
          aria-label={t('test_placeholder')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && trimmed && !busy) send({ type: 'message', text: trimmed })
          }}
        />
        <div className="fe-test__sends">
          <Button size="s" leftContent={SendIcon} text={t('test_message')} disabled={busy || !trimmed} onClick={() => send({ type: 'message', text: trimmed })} />
          <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={CommentIcon} text={t('test_comment')} disabled={busy || !trimmed} onClick={() => send({ type: 'comment', text: trimmed })} />
          <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={PersonAddIcon} text={t('test_follow')} disabled={busy} onClick={() => send({ type: 'follow' })} />
        </div>
      </VStack>

      {result && (
        <>
          <Divider withoutIndent />
          <VStack spacing={12} className="fe-state">
            <HStack spacing={8} align="center" justify="between" wrap>
              <Text as="h3" typo="14" bold color="txt-black-darkest">
                {t('test_state')}
              </Text>
              {lastStep?.waiting ? (
                <Badge size="m" variant="orange">
                  {waitingLabel(lastStep.waiting, t)}
                </Badge>
              ) : result.completed ? (
                <Badge size="m" variant="green">
                  {t('test_completed')}
                </Badge>
              ) : null}
            </HStack>

            <VStack spacing={4}>
              <Text typo="12" bold color="txt-black-darker">
                {t('test_result_fields')}
              </Text>
              {fields.length === 0 ? (
                <Text typo="13" color="txt-black-dark">—</Text>
              ) : (
                <div className="fe-kv">
                  {fields.map(([k, v]) => (
                    <KeyValueItem key={k} keyContent={<span className="fe-mono">{k}</span>}>
                      <span className="fe-wrap">{v}</span>
                    </KeyValueItem>
                  ))}
                </div>
              )}
            </VStack>

            <VStack spacing={4}>
              <Text typo="12" bold color="txt-black-darker">
                {t('test_result_tags')}
              </Text>
              {result.tags.length === 0 ? (
                <Text typo="13" color="txt-black-dark">—</Text>
              ) : (
                <div className="inline-list">
                  {result.tags.map((tag) => (
                    <Tag key={tag} size="s" variant="blue">
                      {tag}
                    </Tag>
                  ))}
                </div>
              )}
            </VStack>

            <VStack spacing={4}>
              <Text typo="12" bold color="txt-black-darker">
                {t('test_result_notifications')}
              </Text>
              {result.notifications.length === 0 ? (
                <Text typo="13" color="txt-black-dark">—</Text>
              ) : (
                <ul className="fe-notes">
                  {result.notifications.map((n, i) => (
                    <li key={i}>
                      <Icon source={NotificationIcon} size="xs" color="txt-black-dark" />
                      <Text typo="13" color="txt-black-darkest" className="fe-wrap">
                        {n}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </VStack>

            {result.notes.length > 0 && (
              <VStack spacing={4}>
                <Text typo="12" bold color="txt-black-darker">
                  {t('test_result_notes')}
                </Text>
                <ul className="fe-notes">
                  {result.notes.map((n, i) => (
                    <li key={i}>
                      <Icon source={ArrowRightUpSmallIcon} size="xs" color="txt-black-dark" />
                      <Text typo="13" color="txt-black-darkest" className="fe-wrap">
                        {n}
                      </Text>
                    </li>
                  ))}
                </ul>
              </VStack>
            )}
          </VStack>
        </>
      )}
    </section>
  )
}
