import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Banner, Button, Icon, Text, VStack, useToast } from '@channel.io/bezier-react'
import {
  CancelSmallIcon,
  CheckCircleFilledIcon,
  ErrorTriangleFilledIcon,
  LinkOffIcon,
  OpenInNewIcon,
  RefreshIcon,
  ViewIcon,
  ViewOffIcon,
} from '@channel.io/bezier-icons'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'
import { Card, CopyBox, ErrorBanner, LoadingState, PageHeader, TextInputField, type TextInputFieldProps } from '../components'
import { ConfirmAction } from '../components/ConfirmAction'
import './channels.css'

type ChannelsInfo = {
  line: { configured: boolean; displayName?: string; botBasicId?: string }
  meta: { configured: boolean; appId?: string; pageId?: string; pageName?: string; instagramAccountId?: string; instagramUsername?: string }
  webhooks: { line: string; meta: string }
  metaVerifyToken: string
  privacyUrl: string
  dataDeletionUrl: string
}

type Kind = 'line' | 'meta'
type Result = { kind: 'success' | 'warning' | 'error'; text: string }
type Busy = `${Kind}-${'connect' | 'test' | 'disconnect'}` | null

const GUIDE_URL: Record<Kind, string> = {
  line: 'https://github.com/Ch1nzo/sokuto/blob/main/docs/setup-line.md',
  meta: 'https://github.com/Ch1nzo/sokuto/blob/main/docs/setup-meta.md',
}

/** Password-style TextField with a show/hide toggle on the right. */
function SecretField(props: Omit<TextInputFieldProps, 'type' | 'rightContent'>) {
  const t = useT()
  const [shown, setShown] = useState(false)
  return (
    <TextInputField
      {...props}
      type={shown ? 'text' : 'password'}
      autoComplete="off"
      spellCheck={false}
      rightContent={
        <Button
          size="xs"
          styleVariant="tertiary"
          colorVariant="monochrome-dark"
          leftContent={shown ? ViewOffIcon : ViewIcon}
          aria-label={shown ? t('secret_hide') : t('secret_show')}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
        />
      }
    />
  )
}

function LabeledCopy({ label, value }: { label: string; value: string }) {
  return (
    <div className="ch-field">
      <Text as="div" typo="13" bold color="txt-black-darker">
        {label}
      </Text>
      <CopyBox value={value} label={label} />
    </div>
  )
}

function Guide({ steps, href }: { steps: string[]; href: string }) {
  const t = useT()
  return (
    <div className="ch-guide">
      <div className="ch-guide__head">
        <Text as="h3" typo="13" bold color="txt-black-darker">
          {t('channels_steps')}
        </Text>
        <a className="ch-guide__link" href={href} target="_blank" rel="noreferrer">
          {t('line_guide')}
          <Icon source={OpenInNewIcon} size="xs" />
        </a>
      </div>
      <ol className="ch-guide__steps">
        {steps.map((s, i) => (
          <li key={i}>
            <span className="ch-guide__num" aria-hidden>
              {i + 1}
            </span>
            <span className="ch-guide__text">{s}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ResultBanner({ result, onClose }: { result: Result; onClose: () => void }) {
  const variant = result.kind === 'success' ? 'green' : result.kind === 'warning' ? 'orange' : 'red'
  return (
    <Banner
      className="ch-result"
      variant={variant}
      icon={result.kind === 'success' ? CheckCircleFilledIcon : ErrorTriangleFilledIcon}
      content={result.text}
      role={result.kind === 'error' ? 'alert' : 'status'}
      actionIcon={CancelSmallIcon}
      onClickAction={onClose}
    />
  )
}

function StatusBadge({ connected }: { connected: boolean }) {
  const t = useT()
  return connected ? (
    <Badge size="m" variant="green" icon={CheckCircleFilledIcon}>
      {t('channels_connected')}
    </Badge>
  ) : (
    <Badge size="m" variant="monochrome-light">
      {t('channels_not_connected')}
    </Badge>
  )
}

export default function Channels() {
  const t = useT()
  const { lang } = useLang()
  const toast = useToast()
  const [info, setInfo] = useState<ChannelsInfo | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [line, setLine] = useState({ channelSecret: '', channelAccessToken: '' })
  const [meta, setMeta] = useState({ appId: '', appSecret: '', pageAccessToken: '' })
  const [results, setResults] = useState<Partial<Record<Kind, Result>>>({})
  const [busy, setBusy] = useState<Busy>(null)
  const [confirming, setConfirming] = useState<Kind | null>(null)
  // Keeps the modal title stable while it animates out after `confirming` is cleared.
  const [confirmKind, setConfirmKind] = useState<Kind>('line')

  const load = useCallback(async () => {
    try {
      setInfo(await api.get<ChannelsInfo>('/api/channels'))
      setLoadError(null)
    } catch (err) {
      setLoadError(err)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!info) {
    return loadError ? (
      <div className="stack">
        <PageHeader title={t('channels_title')} />
        <ErrorBanner error={loadError} onRetry={() => void load()} />
      </div>
    ) : (
      <LoadingState />
    )
  }

  const setResult = (kind: Kind, r: Result | undefined) => setResults((prev) => ({ ...prev, [kind]: r }))

  /** Runs an action for one channel; shows its outcome in that channel's card and reloads the status. */
  const run = async (kind: Kind, action: 'connect' | 'test' | 'disconnect', fn: () => Promise<Result | null>) => {
    setBusy(`${kind}-${action}`)
    setResult(kind, undefined)
    try {
      const r = await fn()
      if (r) setResult(kind, r)
      await load()
    } catch (err) {
      setResult(kind, { kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(null)
    }
  }

  const connectLine = (e: FormEvent) => {
    e.preventDefault()
    void run('line', 'connect', async () => {
      const r = await api.post<{ displayName: string; webhookSet: boolean; webhookError?: string }>('/api/channels/line', line)
      setLine({ channelSecret: '', channelAccessToken: '' })
      return {
        kind: r.webhookSet ? 'success' : 'warning',
        text: `${t('channels_connected')}: ${r.displayName}. Webhook ${r.webhookSet ? 'OK' : `NG (${r.webhookError ?? ''})`}`,
      }
    })
  }

  const connectMeta = (e: FormEvent) => {
    e.preventDefault()
    void run('meta', 'connect', async () => {
      const r = await api.post<{ pageName: string; instagramUsername?: string; subscribed: boolean; subscribeError?: string }>('/api/channels/meta', meta)
      setMeta({ appId: '', appSecret: '', pageAccessToken: '' })
      return {
        kind: r.subscribed ? 'success' : 'warning',
        text: `${t('channels_connected')}: ${r.pageName}${r.instagramUsername ? ` / @${r.instagramUsername}` : ''}. Subscribe ${r.subscribed ? 'OK' : `NG (${r.subscribeError ?? ''})`}`,
      }
    })
  }

  const testLine = () =>
    run('line', 'test', async () => {
      const r = await api.post<{ webhookSet: boolean; webhookError?: string; ok: boolean; detail?: string }>('/api/channels/line/test')
      const ok = r.webhookSet && r.ok
      const lines = [
        ok ? t('channels_test_ok') : t('channels_test_failed'),
        `Webhook: ${r.webhookSet ? 'OK' : `NG${r.webhookError ? ` (${r.webhookError})` : ''}`}`,
        `Test: ${r.ok ? 'OK' : `NG${r.detail ? ` (${r.detail})` : ''}`}`,
      ]
      return { kind: ok ? 'success' : 'error', text: lines.join('\n') }
    })

  const testMeta = () =>
    run('meta', 'test', async () => {
      const r = await api.post<{ tokenValid: boolean; tokenError?: string; subscribed: boolean; subscribeError?: string }>('/api/channels/meta/test')
      const ok = r.tokenValid && r.subscribed
      const lines = [
        ok ? t('channels_test_ok') : t('channels_test_failed'),
        `Token: ${r.tokenValid ? 'OK' : `NG${r.tokenError ? ` (${r.tokenError})` : ''}`}`,
        `Subscribe: ${r.subscribed ? 'OK' : `NG${r.subscribeError ? ` (${r.subscribeError})` : ''}`}`,
      ]
      return { kind: ok ? 'success' : 'error', text: lines.join('\n') }
    })

  const disconnect = (kind: Kind) =>
    run(kind, 'disconnect', async () => {
      await api.delete(`/api/channels/${kind}`)
      toast.addToast(t('channels_disconnected'), { preset: 'success' })
      return null
    })

  const ja = lang === 'ja'
  const lineSteps = ja
    ? [
        'LINE Developers コンソール (developers.line.biz) で Messaging API チャネルを作成します。',
        '「チャネル基本設定」のチャネルシークレットと、「Messaging API 設定」で発行したチャネルアクセストークン(長期)を下に貼り付けます。',
        '保存すると Webhook URL は自動で登録されます。LINE Official Account Manager で「応答メッセージ」をオフ、「Webhook」をオンにしてください。',
      ]
    : [
        'Create a Messaging API channel in the LINE Developers console (developers.line.biz).',
        'Paste the channel secret (Basic settings) and a long-lived channel access token (Messaging API tab) below.',
        'The webhook URL is registered automatically. In LINE Official Account Manager, turn "Auto-reply messages" off and "Webhooks" on.',
      ]
  const metaSteps = ja
    ? [
        'developers.facebook.com でアプリを作成(種類: ビジネス / 用途: その他)。Messenger 製品を追加します。',
        '「アプリ設定 › ベーシック」で アプリ ID と app secret をコピーし、プライバシーポリシー URL とデータ削除 URL に下の URL を設定します。',
        'Messenger › 設定で Facebook ページを接続し、ページアクセストークンを生成して貼り付けます。Instagram も同じページに連携したプロアカウントであれば自動で有効になります。',
        'Webhooks の「コールバック URL」と「検証トークン」に下の値を入れ、messages / messaging_postbacks / messaging_referrals / messaging_optins / feed(Instagram: messages / comments)を購読します。',
      ]
    : [
        'Create an app at developers.facebook.com (Business type), then add the Messenger product.',
        'In App settings › Basic copy the App ID and App secret, and set the privacy policy and data deletion URLs below.',
        'In Messenger › Settings connect your Page, generate a Page access token and paste it. Instagram works automatically when a professional account is linked to that Page.',
        'In Webhooks set the callback URL and verify token below and subscribe to messages, messaging_postbacks, messaging_referrals, messaging_optins, feed (Instagram: messages, comments).',
      ]

  const connectedActions = (kind: Kind, onTest: () => void) => (
    <div className="ch-actions">
      <Button
        styleVariant="secondary"
        colorVariant="monochrome-dark"
        leftContent={RefreshIcon}
        text={t('channels_test')}
        loading={busy === `${kind}-test`}
        disabled={busy !== null && busy !== `${kind}-test`}
        onClick={onTest}
      />
      <Button
        styleVariant="secondary"
        colorVariant="red"
        leftContent={LinkOffIcon}
        text={t('channels_disconnect')}
        loading={busy === `${kind}-disconnect`}
        disabled={busy !== null && busy !== `${kind}-disconnect`}
        onClick={() => {
          setConfirmKind(kind)
          setConfirming(kind)
        }}
      />
    </div>
  )

  const account = (parts: (string | undefined)[]): ReactNode => {
    const text = parts.filter(Boolean).join(' · ')
    return text ? (
      <Text as="p" typo="14" color="txt-black-darker" className="ch-account">
        {text}
      </Text>
    ) : null
  }

  return (
    <div className="stack">
      <PageHeader title={t('channels_title')} />

      <div className="ch-grid">
        <Card title={t('channels_line')} actions={<StatusBadge connected={info.line.configured} />}>
          <VStack spacing={16}>
            {info.line.configured && account([info.line.displayName, info.line.botBasicId])}
            <Guide steps={lineSteps} href={GUIDE_URL.line} />
            <LabeledCopy label={t('channels_webhook')} value={info.webhooks.line} />
            {results.line && <ResultBanner result={results.line} onClose={() => setResult('line', undefined)} />}
            {!info.line.configured ? (
              <VStack as="form" spacing={16} onSubmit={connectLine}>
                <SecretField
                  label={t('line_secret')}
                  value={line.channelSecret}
                  onChange={(e) => setLine({ ...line, channelSecret: e.target.value })}
                  required
                />
                <SecretField
                  label={t('line_token')}
                  value={line.channelAccessToken}
                  onChange={(e) => setLine({ ...line, channelAccessToken: e.target.value })}
                  required
                />
                <div className="ch-actions">
                  <Button
                    type="submit"
                    text={t('channels_connect')}
                    loading={busy === 'line-connect'}
                    disabled={!line.channelSecret.trim() || !line.channelAccessToken.trim() || (busy !== null && busy !== 'line-connect')}
                  />
                </div>
              </VStack>
            ) : (
              connectedActions('line', () => void testLine())
            )}
          </VStack>
        </Card>

        <Card title={t('channels_meta')} actions={<StatusBadge connected={info.meta.configured} />}>
          <VStack spacing={16}>
            {info.meta.configured && account([info.meta.pageName, info.meta.instagramUsername ? `@${info.meta.instagramUsername}` : undefined])}
            <Guide steps={metaSteps} href={GUIDE_URL.meta} />
            <LabeledCopy label={t('channels_webhook')} value={info.webhooks.meta} />
            <LabeledCopy label={t('channels_verify_token')} value={info.metaVerifyToken} />
            <LabeledCopy label={t('meta_privacy_url')} value={info.privacyUrl} />
            <LabeledCopy label={t('meta_deletion_url')} value={info.dataDeletionUrl} />
            {results.meta && <ResultBanner result={results.meta} onClose={() => setResult('meta', undefined)} />}
            {!info.meta.configured ? (
              <VStack as="form" spacing={16} onSubmit={connectMeta}>
                <div className="ch-form-row">
                  <TextInputField
                    label={t('meta_app_id')}
                    value={meta.appId}
                    onChange={(e) => setMeta({ ...meta, appId: e.target.value })}
                    autoComplete="off"
                    inputMode="numeric"
                    required
                  />
                  <SecretField
                    label={t('meta_app_secret')}
                    value={meta.appSecret}
                    onChange={(e) => setMeta({ ...meta, appSecret: e.target.value })}
                    required
                  />
                </div>
                <SecretField
                  label={t('meta_page_token')}
                  value={meta.pageAccessToken}
                  onChange={(e) => setMeta({ ...meta, pageAccessToken: e.target.value })}
                  required
                />
                <div className="ch-actions">
                  <Button
                    type="submit"
                    text={t('channels_connect')}
                    loading={busy === 'meta-connect'}
                    disabled={!meta.appId.trim() || !meta.appSecret.trim() || !meta.pageAccessToken.trim() || (busy !== null && busy !== 'meta-connect')}
                  />
                </div>
              </VStack>
            ) : (
              connectedActions('meta', () => void testMeta())
            )}
          </VStack>
        </Card>
      </div>

      <ConfirmAction
        show={confirming !== null}
        onHide={() => setConfirming(null)}
        title={`${confirmKind === 'meta' ? t('channels_meta') : t('channels_line')}: ${t('channels_disconnect')}`}
        description={t('channels_disconnect_confirm')}
        confirmText={t('channels_disconnect')}
        onConfirm={() => void disconnect(confirmKind)}
      />
    </div>
  )
}
