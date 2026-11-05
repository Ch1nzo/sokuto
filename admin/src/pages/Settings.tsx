import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Badge,
  Banner,
  Button,
  SegmentedControl,
  SegmentedControlItem,
  Switch,
  Text,
  TextField,
  VStack,
  useToast,
} from '@channel.io/bezier-react'
import { CheckCircleFilledIcon, ErrorTriangleFilledIcon, InfoFilledIcon, KeyIcon, LinkCopyIcon, TrashIcon } from '@channel.io/bezier-icons'
import { ApiError, api, errorMessage } from '../lib/api'
import { useLang, useT, type Lang } from '../lib/i18n'
import { useTheme, type ThemePref } from '../lib/theme'
import { Card, CopyBox, ErrorBanner, LoadingState, PageHeader, SelectField, TextAreaField, TextInputField } from '../components'
import { ConfirmAction } from '../components/ConfirmAction'
import { AddButton, IconBtn } from './flow-editor/fields'
import './settings.css'

type General = {
  botName: string
  language: Lang
  timezone: string
  paused: boolean
  handoffKeywords: string[]
  handoffReply: string
  botFields: Record<string, string>
}

type SettingsResponse = { general: General; mcp: { configured: boolean; url: string } }

type Form = { botName: string; language: Lang; timezone: string; paused: boolean; keywords: string; handoffReply: string }

const MAX_BOT_FIELDS = 50
const BOT_FIELD_KEY = /^[\w-]{1,40}$/

const FALLBACK_TIMEZONES = ['Asia/Tokyo', 'Asia/Seoul', 'Asia/Shanghai', 'Asia/Singapore', 'UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles']

function timezoneList(current: string): string[] {
  let zones: string[] = FALLBACK_TIMEZONES
  try {
    if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone')
  } catch {
    /* old browser: fallback list */
  }
  if (!zones.includes('UTC')) zones = ['UTC', ...zones]
  return current && !zones.includes(current) ? [current, ...zones] : zones
}

function toForm(g: General): Form {
  return {
    botName: g.botName,
    language: g.language,
    timezone: g.timezone,
    paused: g.paused,
    keywords: g.handoffKeywords.join(', '),
    handoffReply: g.handoffReply,
  }
}

/** Multi-line monospace snippet with a label and a Copy button. */
function CodeSnippet({ label, value }: { label: string; value: string }) {
  const t = useT()
  const toast = useToast()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      toast.addToast(t('copied'), { preset: 'success' })
    } catch {
      toast.addToast(t('copy_failed'), { preset: 'error' })
    }
  }
  return (
    <div className="st-code">
      <div className="st-code__head">
        <Text typo="13" bold color="txt-black-darker">
          {label}
        </Text>
        <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={LinkCopyIcon} text={t('copy')} onClick={copy} />
      </div>
      <pre className="st-code__value" aria-label={label}>
        {value}
      </pre>
    </div>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="st-field">
      <Text as="div" typo="13" bold color="txt-black-darker">
        {label}
      </Text>
      {children}
    </div>
  )
}

export default function Settings() {
  const t = useT()
  const { setLang } = useLang()
  const { pref, setPref } = useTheme()
  const toast = useToast()
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [savingGeneral, setSavingGeneral] = useState(false)
  const [generalError, setGeneralError] = useState<unknown>(null)
  const [botRows, setBotRows] = useState<Array<[string, string]>>([])
  const [savingBot, setSavingBot] = useState(false)
  const [botError, setBotError] = useState<unknown>(null)
  const [token, setToken] = useState<{ token: string; url: string } | null>(null)
  const [mcpBusy, setMcpBusy] = useState<'rotate' | 'revoke' | null>(null)
  const [mcpError, setMcpError] = useState<unknown>(null)
  const [mcpConfirm, setMcpConfirm] = useState<'rotate' | 'revoke' | null>(null)
  const [mcpConfirmKind, setMcpConfirmKind] = useState<'rotate' | 'revoke'>('rotate')
  const [pw, setPw] = useState({ current: '', password: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api.get<SettingsResponse>('/api/settings')
      setData(r)
      setForm(toForm(r.general))
      setBotRows(Object.entries(r.general.botFields ?? {}))
      setLoadError(null)
    } catch (err) {
      setLoadError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const timezones = useMemo(() => timezoneList(form?.timezone ?? '').map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), [form?.timezone])

  if (!data || !form) {
    return loadError ? (
      <div className="stack">
        <PageHeader title={t('settings_title')} />
        <ErrorBanner error={loadError} onRetry={() => void load()} />
      </div>
    ) : (
      <LoadingState />
    )
  }

  const saveGeneral = async (e: FormEvent) => {
    e.preventDefault()
    setSavingGeneral(true)
    setGeneralError(null)
    try {
      const r = await api.put<{ general: General }>('/api/settings', {
        botName: form.botName,
        language: form.language,
        timezone: form.timezone,
        paused: form.paused,
        handoffKeywords: form.keywords
          .split(/[,、]/)
          .map((s) => s.trim())
          .filter(Boolean),
        handoffReply: form.handoffReply,
      })
      setData({ ...data, general: r.general })
      setForm(toForm(r.general))
      setLang(r.general.language)
      toast.addToast(t('saved'), { preset: 'success' })
    } catch (err) {
      setGeneralError(err)
    } finally {
      setSavingGeneral(false)
    }
  }

  const saveBotFields = async (e: FormEvent) => {
    e.preventDefault()
    setSavingBot(true)
    setBotError(null)
    try {
      const botFields = Object.fromEntries(botRows.map(([k, v]) => [k.trim(), v] as const).filter(([k]) => k))
      const r = await api.put<{ general: General }>('/api/settings', { botFields })
      setData({ ...data, general: r.general })
      setBotRows(Object.entries(r.general.botFields))
      toast.addToast(t('saved'), { preset: 'success' })
    } catch (err) {
      setBotError(err)
    } finally {
      setSavingBot(false)
    }
  }

  const setBotRow = (i: number, row: [string, string]) => setBotRows(botRows.map((r, j) => (j === i ? row : r)))

  const rotate = async () => {
    setMcpBusy('rotate')
    setMcpError(null)
    try {
      const r = await api.post<{ token: string; url: string }>('/api/settings/mcp/rotate')
      setToken(r)
      setData({ ...data, mcp: { configured: true, url: r.url } })
    } catch (err) {
      setMcpError(err)
    } finally {
      setMcpBusy(null)
    }
  }

  const revoke = async () => {
    setMcpBusy('revoke')
    setMcpError(null)
    try {
      await api.delete('/api/settings/mcp')
      setToken(null)
      setData({ ...data, mcp: { ...data.mcp, configured: false } })
      toast.addToast(t('settings_mcp_not_configured'), { preset: 'success' })
    } catch (err) {
      setMcpError(err)
    } finally {
      setMcpBusy(null)
    }
  }

  const askMcp = (kind: 'rotate' | 'revoke') => {
    setMcpConfirmKind(kind)
    setMcpConfirm(kind)
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPwBusy(true)
    setPwError(null)
    try {
      await api.post('/api/auth/password', pw)
      setPw({ current: '', password: '' })
      toast.addToast(t('saved'), { preset: 'success' })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_password') setPwError(t('login_failed'))
      else if (err instanceof ApiError && err.code === 'password_too_short') setPwError(t('settings_password_min'))
      else setPwError(errorMessage(err))
    } finally {
      setPwBusy(false)
    }
  }

  const mcpUrl = token?.url ?? data.mcp.url
  const jsonSnippet = token
    ? JSON.stringify({ mcpServers: { sokuto: { url: mcpUrl, headers: { Authorization: `Bearer ${token.token}` } } } }, null, 2)
    : ''
  const cliSnippet = token ? `claude mcp add --transport http sokuto ${mcpUrl} --header "Authorization: Bearer ${token.token}"` : ''
  const pwTooShort = pw.password.length > 0 && pw.password.length < 8

  return (
    <div className="stack">
      <PageHeader title={t('settings_title')} />

      <Card title={t('settings_general')}>
        <VStack as="form" spacing={16} onSubmit={saveGeneral}>
          <div className="st-form-row">
            <TextInputField label={t('settings_bot_name')} value={form.botName} onChange={(e) => setForm({ ...form, botName: e.target.value })} required />
            <SelectField<Lang>
              label={t('settings_language')}
              value={form.language}
              options={[
                { value: 'ja', label: '日本語' },
                { value: 'en', label: 'English' },
              ]}
              onChange={(v) => setForm({ ...form, language: v })}
            />
          </div>
          <div className="st-form-row">
            <SelectField label={t('settings_timezone')} value={form.timezone} options={timezones} onChange={(v) => setForm({ ...form, timezone: v })} />
          </div>
          <div className="st-switch">
            <label className="st-switch__text" htmlFor="settings-paused">
              <Text as="span" typo="14" bold color="txt-black-darkest">
                {t('settings_paused')}
              </Text>
              <Text as="span" typo="13" color="txt-black-dark">
                {t('settings_paused_help')}
              </Text>
            </label>
            <Switch id="settings-paused" checked={form.paused} onCheckedChange={(v) => setForm({ ...form, paused: v })} />
          </div>
          <TextInputField
            label={t('settings_handoff_keywords')}
            helperText={t('settings_handoff_keywords_help')}
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          />
          <TextAreaField label={t('settings_handoff_reply')} value={form.handoffReply} onChange={(e) => setForm({ ...form, handoffReply: e.target.value })} maxRows={10} />
          {generalError !== null && <ErrorBanner error={generalError} />}
          <div className="st-actions">
            <Button type="submit" text={t('save')} loading={savingGeneral} />
          </div>
        </VStack>
      </Card>

      <Card title={t('settings_bot_fields')}>
        <VStack as="form" spacing={16} onSubmit={saveBotFields}>
          <Text as="p" typo="13" color="txt-black-dark">
            {t('settings_bot_fields_help')}
          </Text>
          {botRows.map(([k, v], i) => (
            <div key={i} className="st-kv-row">
              <TextField
                size="m"
                value={k}
                maxLength={40}
                hasError={k.trim() !== '' && !BOT_FIELD_KEY.test(k.trim())}
                placeholder={t('settings_bot_field_key')}
                aria-label={t('settings_bot_field_key')}
                onChange={(e) => setBotRow(i, [e.target.value, v])}
              />
              <TextField
                size="m"
                value={v}
                maxLength={2000}
                placeholder={t('settings_bot_field_value')}
                aria-label={t('settings_bot_field_value')}
                onChange={(e) => setBotRow(i, [k, e.target.value])}
              />
              <IconBtn icon={TrashIcon} danger label={`${t('delete')}: ${k || t('settings_bot_field_key')}`} onClick={() => setBotRows(botRows.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <AddButton text={t('settings_add_bot_field')} disabled={botRows.length >= MAX_BOT_FIELDS} onClick={() => setBotRows([...botRows, ['', '']])} />
          </div>
          {botError !== null && <ErrorBanner error={botError} />}
          <div className="st-actions">
            <Button type="submit" text={t('save')} loading={savingBot} />
          </div>
        </VStack>
      </Card>

      <Card title={t('theme')}>
        <div className="st-theme">
          <SegmentedControl type="radiogroup" size="m" width={300} value={pref} onValueChange={(v: ThemePref) => setPref(v)} aria-label={t('theme')}>
            <SegmentedControlItem value="light">{t('theme_light')}</SegmentedControlItem>
            <SegmentedControlItem value="dark">{t('theme_dark')}</SegmentedControlItem>
            <SegmentedControlItem value="system">{t('theme_system')}</SegmentedControlItem>
          </SegmentedControl>
          <Text as="p" typo="13" color="txt-black-dark">
            {t('settings_theme_help')}
          </Text>
        </div>
      </Card>

      <Card
        title={t('settings_mcp')}
        actions={
          data.mcp.configured ? (
            <Badge size="m" variant="green" icon={CheckCircleFilledIcon}>
              {t('settings_mcp_configured')}
            </Badge>
          ) : (
            <Badge size="m" variant="monochrome-light">
              {t('settings_mcp_not_configured')}
            </Badge>
          )
        }
      >
        <VStack spacing={16}>
          <Text as="p" typo="14" color="txt-black-darker">
            {t('settings_mcp_lead')}
          </Text>
          <Labeled label={t('settings_mcp_url')}>
            <CopyBox value={mcpUrl} label={t('settings_mcp_url')} />
          </Labeled>
          {token && (
            <>
              <Banner variant="orange" icon={ErrorTriangleFilledIcon} content={t('settings_mcp_token_once')} />
              <Labeled label={t('settings_mcp_token')}>
                <CopyBox value={token.token} label={t('settings_mcp_token')} />
              </Labeled>
              <Banner className="st-wrap" variant="blue" icon={InfoFilledIcon} content={t('settings_mcp_how')} />
              <CodeSnippet label="Claude Desktop / JSON" value={jsonSnippet} />
              <CodeSnippet label="Claude Code" value={cliSnippet} />
            </>
          )}
          {mcpError !== null && <ErrorBanner error={mcpError} />}
          <div className="st-actions">
            <Button
              leftContent={KeyIcon}
              styleVariant={data.mcp.configured ? 'secondary' : 'primary'}
              colorVariant={data.mcp.configured ? 'monochrome-dark' : 'blue'}
              text={data.mcp.configured ? t('settings_mcp_regenerate') : t('settings_mcp_generate')}
              loading={mcpBusy === 'rotate'}
              disabled={mcpBusy === 'revoke'}
              onClick={() => (data.mcp.configured ? askMcp('rotate') : void rotate())}
            />
            {data.mcp.configured && (
              <Button
                leftContent={TrashIcon}
                styleVariant="secondary"
                colorVariant="red"
                text={t('settings_mcp_revoke')}
                loading={mcpBusy === 'revoke'}
                disabled={mcpBusy === 'rotate'}
                onClick={() => askMcp('revoke')}
              />
            )}
          </div>
        </VStack>
      </Card>

      <Card title={t('settings_password')}>
        <VStack as="form" spacing={16} onSubmit={changePassword}>
          {/* Hidden username helps password managers associate the credentials. */}
          <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
          <div className="st-form-row">
            <TextInputField
              label={t('settings_current_password')}
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              required
            />
            <TextInputField
              label={t('settings_new_password')}
              type="password"
              autoComplete="new-password"
              minLength={8}
              helperText={t('settings_password_min')}
              error={pwTooShort ? t('settings_password_min') : undefined}
              value={pw.password}
              onChange={(e) => setPw({ ...pw, password: e.target.value })}
              required
            />
          </div>
          {pwError && <ErrorBanner error={pwError} />}
          <div className="st-actions">
            <Button type="submit" text={t('save')} loading={pwBusy} disabled={!pw.current || pw.password.length < 8} />
          </div>
        </VStack>
      </Card>

      <ConfirmAction
        show={mcpConfirm !== null}
        onHide={() => setMcpConfirm(null)}
        title={mcpConfirmKind === 'rotate' ? `${t('settings_mcp_regenerate')}?` : `${t('settings_mcp_revoke')}?`}
        description={mcpConfirmKind === 'rotate' ? t('settings_mcp_regenerate_confirm') : t('settings_mcp_revoke_confirm')}
        confirmText={mcpConfirmKind === 'rotate' ? t('settings_mcp_regenerate') : t('settings_mcp_revoke')}
        destructive={mcpConfirmKind === 'revoke'}
        onConfirm={() => void (mcpConfirmKind === 'rotate' ? rotate() : revoke())}
      />
    </div>
  )
}
