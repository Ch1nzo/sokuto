import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Banner, Button, Checkbox, Radio, RadioGroup, Text, TextField, VStack, useToast } from '@channel.io/bezier-react'
import { AiOffIcon, TrashIcon } from '@channel.io/bezier-icons'
import type { Channel } from '@shared/channels/types'
import { api } from '../../lib/api'
import { useT, type Key } from '../../lib/i18n'
import { Card, ErrorBanner, LoadingState, SelectField, TextAreaField, TextInputField } from '../../components'
import { AddButton, IconBtn } from '../flow-editor/fields'
import { BotFrame, SwitchRow, useBot } from './shared'
import type { BotConfig } from './types'

const CHANNELS: Channel[] = ['line', 'messenger', 'instagram']
const MAX_LINES = 20

/** Editable list of short lines (guidelines, guardrails): one text field per line, ≤ 20 lines of ≤ 200 characters. */
function LineList({ label, help, placeholder, items, onChange }: { label: string; help: string; placeholder: string; items: string[]; onChange: (v: string[]) => void }) {
  const t = useT()
  return (
    <VStack spacing={8}>
      <Text as="p" typo="13" color="txt-black-dark">
        {help}
      </Text>
      {items.map((line, i) => (
        <div key={i} className="bot-line">
          <TextField
            size="m"
            value={line}
            maxLength={200}
            placeholder={placeholder}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <IconBtn icon={TrashIcon} danger label={`${t('delete')}: ${label} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <div className="bot-line__foot">
        <AddButton text={t('bot_rules_add_line')} disabled={items.length >= MAX_LINES} onClick={() => onChange([...items, ''])} />
        <Text typo="12" color="txt-black-dark" className="tabular">
          {`${items.length} / ${MAX_LINES}`}
        </Text>
      </div>
    </VStack>
  )
}

const clean = (lines: string[]) => lines.map((s) => s.trim()).filter(Boolean)

export default function Rules() {
  const t = useT()
  const toast = useToast()
  const { bot, error: loadError, reload, setBot } = useBot()
  const [form, setForm] = useState<BotConfig | null>(bot?.config ?? null)
  const [segments, setSegments] = useState<{ id: number; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const channelsLabel = useId()
  const unknownLabel = useId()

  // The form starts from the saved config (and follows it after a save or a reload).
  useEffect(() => {
    if (bot) setForm(bot.config)
  }, [bot])

  useEffect(() => {
    // Optional: without segments the picker only offers "everyone".
    api.get<{ segments: { id: number; name: string }[] }>('/api/segments').then((r) => setSegments(r.segments), () => {})
  }, [])

  if (!bot || !form) {
    return <BotFrame section="rules">{loadError ? <ErrorBanner error={loadError} onRetry={() => void reload()} /> : <LoadingState compact />}</BotFrame>
  }

  const set = <K extends keyof BotConfig>(key: K, value: BotConfig[K]) => setForm({ ...form, [key]: value })
  const dirty = JSON.stringify(form) !== JSON.stringify(bot.config)
  const turnsInvalid = !Number.isInteger(form.maxTurns) || form.maxTurns < 1 || form.maxTurns > 50

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!dirty || turnsInvalid) return
    setSaving(true)
    setError(null)
    try {
      const body: BotConfig = { ...form, name: form.name.trim(), guidelines: clean(form.guidelines), guardrails: clean(form.guardrails) }
      const r = await api.put<{ config: BotConfig }>('/api/bot', body)
      setBot({ ...bot, config: r.config })
      toast.addToast(t('saved'), { preset: 'success' })
    } catch (err) {
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  const toggleChannel = (c: Channel, on: boolean) => set('channels', on ? CHANNELS.filter((x) => x === c || form.channels.includes(x)) : form.channels.filter((x) => x !== c))

  const languageOptions = [
    { value: 'auto' as const, label: t('bot_lang_auto') },
    { value: 'ja' as const, label: '日本語' },
    { value: 'en' as const, label: 'English' },
  ]
  const segmentOptions = [{ value: '', label: t('bot_rules_everyone') }, ...segments.map((s) => ({ value: String(s.id), label: s.name }))]

  return (
    <BotFrame section="rules">
      <VStack as="form" spacing={16} className="bot-form" onSubmit={save} aria-label={t('bot_nav_rules')}>
        {!bot.aiConfigured && (
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

        <Card title={t('bot_rules_basic')}>
          <VStack spacing={16}>
            <SwitchRow id="bot-enabled" label={t('bot_rules_enabled').replace('{name}', form.name || 'Soku')} help={t('bot_rules_enabled_help')} checked={form.enabled} onChange={(v) => set('enabled', v)} />
            <div className="bot-form-row">
              <TextInputField label={t('bot_rules_name')} value={form.name} maxLength={30} required onChange={(e) => set('name', e.target.value)} />
              <SelectField label={t('bot_rules_language')} value={form.language} options={languageOptions} onChange={(v) => set('language', v)} />
            </div>
            <div className="bot-field" role="group" aria-labelledby={channelsLabel}>
              <Text as="div" id={channelsLabel} typo="13" bold color="txt-black-darker">
                {t('bot_rules_channels')}
              </Text>
              <div className="bot-checks">
                {CHANNELS.map((c) => (
                  <Checkbox key={c} checked={form.channels.includes(c)} onCheckedChange={(v) => toggleChannel(c, v === true)}>
                    {t(`channel_${c}` as Key)}
                  </Checkbox>
                ))}
              </div>
            </div>
            <SelectField
              label={t('bot_rules_segment')}
              helperText={t('bot_rules_segment_help')}
              value={form.segmentId === null ? '' : String(form.segmentId)}
              options={segmentOptions}
              onChange={(v) => set('segmentId', v ? Number(v) : null)}
            />
          </VStack>
        </Card>

        <Card title={t('bot_rules_persona')}>
          <TextAreaField
            label={t('bot_rules_persona_label')}
            helperText={t('bot_rules_persona_help')}
            value={form.persona}
            maxLength={2000}
            maxRows={16}
            onChange={(e) => set('persona', e.target.value)}
          />
        </Card>

        <Card title={t('bot_rules_guidelines')}>
          <LineList
            label={t('bot_rules_guidelines')}
            help={t('bot_rules_guidelines_help')}
            placeholder={t('bot_rules_guidelines_ph')}
            items={form.guidelines}
            onChange={(v) => set('guidelines', v)}
          />
        </Card>

        <Card title={t('bot_rules_guardrails')}>
          <LineList
            label={t('bot_rules_guardrails')}
            help={t('bot_rules_guardrails_help')}
            placeholder={t('bot_rules_guardrails_ph')}
            items={form.guardrails}
            onChange={(v) => set('guardrails', v)}
          />
        </Card>

        <Card title={t('bot_rules_handoff')}>
          <VStack spacing={16}>
            <div className="bot-field">
              <Text as="div" id={unknownLabel} typo="13" bold color="txt-black-darker">
                {t('bot_rules_unknown')}
              </Text>
              <RadioGroup value={form.unknownAction} onValueChange={(v: BotConfig['unknownAction']) => set('unknownAction', v)} spacing={8} aria-labelledby={unknownLabel}>
                <Radio value="handoff">{t('bot_rules_unknown_handoff')}</Radio>
                <Radio value="fallback">{t('bot_rules_unknown_fallback')}</Radio>
              </RadioGroup>
            </div>
            <TextAreaField label={t('bot_rules_handoff_message')} helperText={t('bot_rules_handoff_message_help')} value={form.handoffMessage} maxLength={500} maxRows={6} onChange={(e) => set('handoffMessage', e.target.value)} />
            {form.unknownAction === 'fallback' && (
              <TextAreaField label={t('bot_rules_fallback_message')} value={form.fallbackMessage} maxLength={500} maxRows={6} onChange={(e) => set('fallbackMessage', e.target.value)} />
            )}
            <div className="bot-form-row">
              <TextInputField
                label={t('bot_rules_max_turns')}
                helperText={t('bot_rules_max_turns_help')}
                error={turnsInvalid ? t('bot_rules_max_turns_invalid') : undefined}
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                step={1}
                value={Number.isNaN(form.maxTurns) ? '' : String(form.maxTurns)}
                onChange={(e) => set('maxTurns', e.target.value === '' ? Number.NaN : Number(e.target.value))}
              />
            </div>
          </VStack>
        </Card>

        <Card title={t('bot_rules_resolve')}>
          <VStack spacing={16}>
            <SwitchRow id="bot-auto-close" label={t('bot_rules_auto_close')} help={t('bot_rules_auto_close_help')} checked={form.autoClose} onChange={(v) => set('autoClose', v)} />
            <TextAreaField label={t('bot_rules_resolve_message')} helperText={t('bot_rules_resolve_message_help')} value={form.resolveMessage} maxLength={500} maxRows={6} onChange={(e) => set('resolveMessage', e.target.value)} />
          </VStack>
        </Card>

        <Card title={t('bot_nav_products')}>
          <SwitchRow id="bot-recommend" label={t('bot_rules_recommend')} help={t('bot_rules_recommend_help')} checked={form.recommendProducts} onChange={(v) => set('recommendProducts', v)} />
        </Card>

        <Card title={t('bot_rules_learning')}>
          <SwitchRow id="bot-suggest" label={t('bot_rules_suggest')} help={t('bot_rules_suggest_help')} checked={form.suggestFaqs} onChange={(v) => set('suggestFaqs', v)} />
        </Card>

        {error !== null && <ErrorBanner error={error} />}
        <div className="bot-savebar">
          <Text typo="13" color="txt-black-dark" className="bot-savebar__hint" aria-live="polite">
            {dirty ? t('bot_rules_unsaved') : ''}
          </Text>
          {dirty && <Button styleVariant="tertiary" colorVariant="monochrome-dark" text={t('bot_rules_discard')} onClick={() => setForm(bot.config)} />}
          <Button type="submit" text={t('save')} loading={saving} disabled={!dirty || turnsInvalid || !form.name.trim()} />
        </div>
      </VStack>
    </BotFrame>
  )
}
