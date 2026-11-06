import { useState, type FormEvent } from 'react'
import { Button, SegmentedControl, SegmentedControlItem, Text, VStack } from '@channel.io/bezier-react'
import { api, errorMessage } from '../lib/api'
import { useLang, useT, type Lang } from '../lib/i18n'
import { ErrorBanner, SokutoMark, TextInputField } from '../components'

export default function Login({ setupRequired, onDone }: { setupRequired: boolean; onDone: () => void }) {
  const t = useT()
  const { lang, setLang } = useLang()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (setupRequired && password !== confirm) return setError(t('password_mismatch'))
    setBusy(true)
    try {
      await api.post(setupRequired ? '/api/auth/setup' : '/api/auth/login', { password })
      onDone()
    } catch (err) {
      setError(setupRequired ? errorMessage(err) : t('login_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-brand">
        <SokutoMark size={32} />
        <Text typo="18" bold color="txt-black-darkest" translate="no">
          {t('appName')}
        </Text>
      </div>

      <div className="auth-card">
        <VStack spacing={6}>
          <Text as="h1" typo="18" bold color="txt-black-darkest">
            {setupRequired ? t('setup_title') : t('login_title')}
          </Text>
          {setupRequired && (
            <Text as="p" typo="14" color="txt-black-darker">
              {t('setup_lead')}
            </Text>
          )}
        </VStack>

        <VStack as="form" spacing={16} onSubmit={submit}>
          {/* Hidden username helps password managers associate the credentials. */}
          <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden />
          <TextInputField
            label={t('password')}
            name="password"
            type="password"
            size="l"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete={setupRequired ? 'new-password' : 'current-password'}
            minLength={8}
            required
          />
          {setupRequired && (
            <TextInputField
              label={t('password_confirm')}
              name="password-confirm"
              type="password"
              size="l"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          )}
          {error && <ErrorBanner error={error} />}
          <Button type="submit" size="l" text={setupRequired ? t('create') : t('login')} loading={busy} className="auth-card__submit" />
        </VStack>
      </div>

      <SegmentedControl type="radiogroup" size="xs" width={160} value={lang} onValueChange={(v: Lang) => setLang(v)} aria-label={t('settings_language')}>
        <SegmentedControlItem value="ja">日本語</SegmentedControlItem>
        <SegmentedControlItem value="en">English</SegmentedControlItem>
      </SegmentedControl>
    </main>
  )
}
