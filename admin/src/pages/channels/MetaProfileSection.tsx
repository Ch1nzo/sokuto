import { useState, type FormEvent } from 'react'
import { Banner, Button, Switch, Text, VStack, useToast } from '@channel.io/bezier-react'
import { InfoFilledIcon, TrashIcon } from '@channel.io/bezier-icons'
import { ApiError, api, errorMessage } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { ErrorBanner, SelectField, TextAreaField, TextInputField } from '../../components'
import { ConfirmAction } from '../../components/ConfirmAction'
import { AddButton, IconBtn } from '../flow-editor/fields'
import type { FlowRecord } from '@shared/flows/types'

/** Mirrors `MetaProfile` in src/settings.ts (`settings` row `profile:meta`). */
export type MetaProfile = {
  greeting?: string
  getStartedFlowId?: number
  menu: { label: string; url?: string; flowId?: number }[]
  iceBreakers: { question: string; flowId: number }[]
  applyToInstagram: boolean
}

export type FlowOption = Pick<FlowRecord, 'id' | 'name' | 'status'>

type Form = {
  greeting: string
  getStartedFlowId?: number
  menu: { label: string; url: string; flowId?: number }[]
  iceBreakers: { question: string; flowId?: number }[]
  applyToInstagram: boolean
}

type ApplyResponse = { ok: boolean; results: { messenger: { ok: boolean; error?: string }; instagram?: { ok: boolean; error?: string } } }

const MAX_MENU = 3
const MAX_ICE = 4

/** Flow picker: `#id name (下書き)`; '—' clears it. Also used by the LINE rich menu section. */
export function FlowSelect({ label, value, flows, onChange }: { label: string; value?: number; flows: FlowOption[]; onChange: (id: number | undefined) => void }) {
  const t = useT()
  const options = [
    { value: '', label: '—' },
    ...flows.map((f) => ({ value: String(f.id), label: `#${f.id} ${f.name}${f.status === 'draft' ? ` (${t('status_draft')})` : ''}` })),
  ]
  return <SelectField label={label} value={value ? String(value) : ''} options={options} onChange={(v) => onChange(v ? Number(v) : undefined)} />
}

function toForm(p: MetaProfile | null): Form {
  return {
    greeting: p?.greeting ?? '',
    getStartedFlowId: p?.getStartedFlowId,
    menu: (p?.menu ?? []).map((m) => ({ label: m.label, url: m.url ?? '', flowId: m.flowId })),
    iceBreakers: p?.iceBreakers ?? [],
    applyToInstagram: p?.applyToInstagram ?? false,
  }
}

/** Messenger / Instagram profile: Get Started, greeting, persistent menu and ice breakers. */
export function MetaProfileSection({ initial, flows, hasInstagram, onSaved }: { initial: MetaProfile | null; flows: FlowOption[]; hasInstagram: boolean; onSaved: () => void }) {
  const t = useT()
  const toast = useToast()
  const [form, setForm] = useState(() => toForm(initial))
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [confirming, setConfirming] = useState(false)

  const setMenu = (i: number, patch: Partial<Form['menu'][number]>) => setForm({ ...form, menu: form.menu.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
  const setIce = (i: number, patch: Partial<Form['iceBreakers'][number]>) =>
    setForm({ ...form, iceBreakers: form.iceBreakers.map((q, j) => (j === i ? { ...q, ...patch } : q)) })

  /** Success toast when Meta accepted everything; per-platform errors stay visible in the banner. */
  const report = (r: ApplyResponse) => {
    const problems = Object.entries(r.results)
      .filter(([, v]) => v?.error)
      .map(([k, v]) => `${k === 'instagram' ? 'Instagram' : 'Messenger'}: ${v!.error}`)
    if (r.ok) toast.addToast(t('saved'), { preset: 'success' })
    if (problems.length > 0) setError(problems.join('\n'))
    onSaved()
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setError(null)
    try {
      const body = {
        greeting: form.greeting.trim() || undefined,
        getStartedFlowId: form.getStartedFlowId,
        menu: form.menu.map((m) => ({ label: m.label, url: m.url.trim() || undefined, flowId: m.url.trim() ? undefined : m.flowId })),
        iceBreakers: form.iceBreakers,
        applyToInstagram: hasInstagram && form.applyToInstagram,
      }
      report(await api.put<ApplyResponse>('/api/channels/meta/profile', body))
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'get_started_required' ? t('profile_get_started_required') : errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    setError(null)
    try {
      const r = await api.delete<ApplyResponse>('/api/channels/meta/profile')
      setForm(toForm(null))
      report(r)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <VStack as="form" spacing={16} onSubmit={save}>
      <Text as="h3" typo="15" bold color="txt-black-darkest">
        {t('profile_title')}
      </Text>
      <Banner className="ch-result" variant="blue" icon={InfoFilledIcon} content={t('profile_hint')} />
      <TextAreaField label={t('profile_greeting')} value={form.greeting} maxLength={160} onChange={(e) => setForm({ ...form, greeting: e.target.value })} />
      <FlowSelect label={t('profile_get_started')} value={form.getStartedFlowId} flows={flows} onChange={(id) => setForm({ ...form, getStartedFlowId: id })} />

      <div className="ch-field">
        <Text as="div" typo="13" bold color="txt-black-darker">
          {t('profile_menu')}
        </Text>
        {form.menu.map((m, i) => (
          <div key={i} className="ch-item">
            <div className="ch-form-row">
              <TextInputField label={t('profile_menu_label')} value={m.label} maxLength={30} required onChange={(e) => setMenu(i, { label: e.target.value })} />
              <TextInputField label={t('profile_menu_url')} type="url" value={m.url} placeholder="https://" onChange={(e) => setMenu(i, { url: e.target.value, flowId: undefined })} />
              <FlowSelect label={t('profile_flow')} value={m.flowId} flows={flows} onChange={(id) => setMenu(i, { flowId: id, url: '' })} />
            </div>
            <IconBtn icon={TrashIcon} danger label={`${t('delete')}: ${m.label || t('profile_menu_label')}`} onClick={() => setForm({ ...form, menu: form.menu.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <div>
          <AddButton text={t('profile_add_menu')} disabled={form.menu.length >= MAX_MENU} onClick={() => setForm({ ...form, menu: [...form.menu, { label: '', url: '' }] })} />
        </div>
      </div>

      <div className="ch-field">
        <Text as="div" typo="13" bold color="txt-black-darker">
          {t('profile_ice_breakers')}
        </Text>
        {form.iceBreakers.map((q, i) => (
          <div key={i} className="ch-item">
            <div className="ch-form-row">
              <TextInputField label={t('profile_question')} value={q.question} maxLength={80} required onChange={(e) => setIce(i, { question: e.target.value })} />
              <FlowSelect label={t('profile_flow')} value={q.flowId} flows={flows} onChange={(id) => setIce(i, { flowId: id })} />
            </div>
            <IconBtn
              icon={TrashIcon}
              danger
              label={`${t('delete')}: ${q.question || t('profile_question')}`}
              onClick={() => setForm({ ...form, iceBreakers: form.iceBreakers.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        <div>
          <AddButton text={t('profile_add_ice')} disabled={form.iceBreakers.length >= MAX_ICE} onClick={() => setForm({ ...form, iceBreakers: [...form.iceBreakers, { question: '' }] })} />
        </div>
      </div>

      {hasInstagram && (
        <div className="ch-switch">
          <label className="ch-switch__label" htmlFor="profile-instagram">
            <Text as="span" typo="14" color="txt-black-darkest">
              {t('profile_apply_instagram')}
            </Text>
          </label>
          <Switch id="profile-instagram" checked={form.applyToInstagram} onCheckedChange={(v) => setForm({ ...form, applyToInstagram: v })} />
        </div>
      )}

      {error !== null && <ErrorBanner error={error} />}
      <div className="ch-actions">
        <Button type="submit" text={t('profile_apply')} loading={busy === 'save'} disabled={busy !== null && busy !== 'save'} />
        {initial && (
          <Button
            styleVariant="secondary"
            colorVariant="red"
            leftContent={TrashIcon}
            text={t('profile_remove')}
            loading={busy === 'remove'}
            disabled={busy !== null && busy !== 'remove'}
            onClick={() => setConfirming(true)}
          />
        )}
      </div>
      <ConfirmAction show={confirming} onHide={() => setConfirming(false)} title={t('profile_remove')} confirmText={t('profile_remove')} onConfirm={() => void remove()} />
    </VStack>
  )
}
