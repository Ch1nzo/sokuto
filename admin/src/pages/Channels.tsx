import { useEffect, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { useLang, useT } from '../lib/i18n'

type ChannelsInfo = {
  line: { configured: boolean; displayName?: string; botBasicId?: string }
  meta: { configured: boolean; appId?: string; pageId?: string; pageName?: string; instagramAccountId?: string; instagramUsername?: string }
  webhooks: { line: string; meta: string }
  metaVerifyToken: string
  privacyUrl: string
  dataDeletionUrl: string
}

function Copy({ value }: { value: string }) {
  const t = useT()
  const [done, setDone] = useState(false)
  return (
    <div className="row">
      <code className="code-box" style={{ flex: 1 }}>{value}</code>
      <button
        className="btn small"
        onClick={() => {
          void navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        }}
      >
        {done ? t('channels_copied') : t('channels_copy')}
      </button>
    </div>
  )
}

export default function Channels() {
  const t = useT()
  const { lang } = useLang()
  const [info, setInfo] = useState<ChannelsInfo | null>(null)
  const [line, setLine] = useState({ channelSecret: '', channelAccessToken: '' })
  const [meta, setMeta] = useState({ appId: '', appSecret: '', pageAccessToken: '' })
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.get<ChannelsInfo>('/api/channels').then(setInfo)
  useEffect(() => {
    void load()
  }, [])
  if (!info) return <div className="muted">{t('loading')}</div>

  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    setMsg(null)
    try {
      setMsg({ kind: 'ok', text: await fn() })
      await load()
    } catch (err) {
      setMsg({ kind: 'error', text: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }
  const ja = lang === 'ja'

  return (
    <>
      <div className="page-title"><h1>{t('channels_title')}</h1></div>
      {msg && <div className={`alert ${msg.kind}`}>{msg.text}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('channels_line')}</h2>
          <span className={`badge ${info.line.configured ? 'live' : 'draft'}`}>{info.line.configured ? `${t('channels_connected')} · ${info.line.displayName ?? ''} ${info.line.botBasicId ?? ''}` : t('channels_not_connected')}</span>
        </div>
        <ol className="small muted">
          <li>{ja ? 'LINE Developers コンソール (developers.line.biz) で Messaging API チャネルを作成します。' : 'Create a Messaging API channel in the LINE Developers console (developers.line.biz).'}</li>
          <li>{ja ? '「チャネル基本設定」のチャネルシークレットと、「Messaging API 設定」で発行したチャネルアクセストークン(長期)を下に貼り付けます。' : 'Paste the channel secret (Basic settings) and a long-lived channel access token (Messaging API tab) below.'}</li>
          <li>{ja ? '保存すると Webhook URL は自動で登録されます。LINE Official Account Manager で「応答メッセージ」をオフ、「Webhook」をオンにしてください。' : 'The webhook URL is registered automatically. In LINE Official Account Manager, turn "Auto-reply messages" off and "Webhooks" on.'}</li>
        </ol>
        <a className="small" href="https://github.com/OWNER/sokuto/blob/main/docs/setup-line.md" target="_blank" rel="noreferrer">{t('line_guide')}</a>
        <label>{t('channels_webhook')}</label>
        <Copy value={info.webhooks.line} />
        {!info.line.configured ? (
          <>
            <label>{t('line_secret')}</label>
            <input value={line.channelSecret} onChange={(e) => setLine({ ...line, channelSecret: e.target.value })} autoComplete="off" />
            <label>{t('line_token')}</label>
            <textarea value={line.channelAccessToken} onChange={(e) => setLine({ ...line, channelAccessToken: e.target.value })} />
            <div style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api.post<{ displayName: string; webhookSet: boolean; webhookError?: string }>('/api/channels/line', line)
                    setLine({ channelSecret: '', channelAccessToken: '' })
                    return `${t('channels_connected')}: ${r.displayName}. Webhook ${r.webhookSet ? 'OK' : `NG (${r.webhookError})`}`
                  })
                }
              >
                {t('channels_connect')}
              </button>
            </div>
          </>
        ) : (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={busy} onClick={() => run(async () => JSON.stringify(await api.post('/api/channels/line/test')))}>{t('channels_test')}</button>
            <button className="btn danger" disabled={busy} onClick={() => confirm(t('confirmDelete')) && run(async () => (await api.delete('/api/channels/line'), 'OK'))}>{t('channels_disconnect')}</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('channels_meta')}</h2>
          <span className={`badge ${info.meta.configured ? 'live' : 'draft'}`}>
            {info.meta.configured ? `${t('channels_connected')} · ${info.meta.pageName ?? ''}${info.meta.instagramUsername ? ` · @${info.meta.instagramUsername}` : ''}` : t('channels_not_connected')}
          </span>
        </div>
        <ol className="small muted">
          <li>{ja ? 'developers.facebook.com でアプリを作成(種類: ビジネス / 用途: その他)。Messenger 製品を追加します。' : 'Create an app at developers.facebook.com (Business type), then add the Messenger product.'}</li>
          <li>{ja ? '「アプリ設定 › ベーシック」で アプリ ID と app secret をコピーし、プライバシーポリシー URL とデータ削除 URL に下の URL を設定します。' : 'In App settings › Basic copy the App ID and App secret, and set the privacy policy and data deletion URLs below.'}</li>
          <li>{ja ? 'Messenger › 設定で Facebook ページを接続し、ページアクセストークンを生成して貼り付けます。Instagram も同じページに連携したプロアカウントであれば自動で有効になります。' : 'In Messenger › Settings connect your Page, generate a Page access token and paste it. Instagram works automatically when a professional account is linked to that Page.'}</li>
          <li>{ja ? 'Webhooks の「コールバック URL」と「検証トークン」に下の値を入れ、messages / messaging_postbacks / messaging_referrals / messaging_optins / feed(Instagram: messages / comments)を購読します。' : 'In Webhooks set the callback URL and verify token below and subscribe to messages, messaging_postbacks, messaging_referrals, messaging_optins, feed (Instagram: messages, comments).'}</li>
        </ol>
        <a className="small" href="https://github.com/OWNER/sokuto/blob/main/docs/setup-meta.md" target="_blank" rel="noreferrer">{t('line_guide')}</a>
        <label>{t('channels_webhook')}</label>
        <Copy value={info.webhooks.meta} />
        <label>{t('channels_verify_token')}</label>
        <Copy value={info.metaVerifyToken} />
        <label>{t('meta_privacy_url')}</label>
        <Copy value={info.privacyUrl} />
        <label>{t('meta_deletion_url')}</label>
        <Copy value={info.dataDeletionUrl} />
        {!info.meta.configured ? (
          <>
            <div className="inline-fields">
              <div>
                <label>{t('meta_app_id')}</label>
                <input value={meta.appId} onChange={(e) => setMeta({ ...meta, appId: e.target.value })} autoComplete="off" />
              </div>
              <div>
                <label>{t('meta_app_secret')}</label>
                <input value={meta.appSecret} onChange={(e) => setMeta({ ...meta, appSecret: e.target.value })} autoComplete="off" />
              </div>
            </div>
            <label>{t('meta_page_token')}</label>
            <textarea value={meta.pageAccessToken} onChange={(e) => setMeta({ ...meta, pageAccessToken: e.target.value })} />
            <div style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api.post<{ pageName: string; instagramUsername?: string; subscribed: boolean; subscribeError?: string }>('/api/channels/meta', meta)
                    setMeta({ appId: '', appSecret: '', pageAccessToken: '' })
                    return `${t('channels_connected')}: ${r.pageName}${r.instagramUsername ? ` / @${r.instagramUsername}` : ''}. Subscribe ${r.subscribed ? 'OK' : `NG (${r.subscribeError})`}`
                  })
                }
              >
                {t('channels_connect')}
              </button>
            </div>
          </>
        ) : (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={busy} onClick={() => run(async () => JSON.stringify(await api.post('/api/channels/meta/test')))}>{t('channels_test')}</button>
            <button className="btn danger" disabled={busy} onClick={() => confirm(t('confirmDelete')) && run(async () => (await api.delete('/api/channels/meta'), 'OK'))}>{t('channels_disconnect')}</button>
          </div>
        )}
      </div>
    </>
  )
}
