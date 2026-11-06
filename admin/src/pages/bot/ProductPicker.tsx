import { useEffect, useState } from 'react'
import { Badge, Button, Checkbox, Text, TextField } from '@channel.io/bezier-react'
import { SearchIcon, SendIcon, ShoppingIcon } from '@channel.io/bezier-icons'
import { api } from '../../lib/api'
import { useLang, useT } from '../../lib/i18n'
import { Drawer, EmptyState, ErrorBanner, LoadingState, formatNumber } from '../../components'
import { formatPrice } from './shared'
import type { Product } from './types'

/** POST /api/inbox/:id/products accepts 1–10 products. */
const MAX_PICK = 10

/** Inbox drawer: search products and tick up to 10 to send as cards. */
export function ProductPicker({ show, onHide, onSend }: { show: boolean; onHide: () => void; onSend: (products: Product[]) => void }) {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const [q, setQ] = useState('')
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  // Kept across searches, in the order they were picked.
  const [picked, setPicked] = useState<Product[]>([])

  useEffect(() => {
    if (!show) return
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .get<{ products: Product[] }>(`/api/bot/products${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
        .then((r) => {
          if (!cancelled) {
            setProducts(r.products)
            setError(null)
          }
        })
        .catch((err) => !cancelled && setError(err))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q, show])

  const close = () => {
    setPicked([])
    setQ('')
    onHide()
  }

  const toggle = (p: Product, on: boolean) => setPicked((list) => (on ? [...list, p] : list.filter((x) => x.id !== p.id)))
  const full = picked.length >= MAX_PICK

  return (
    <Drawer
      show={show}
      onHide={close}
      title={t('inbox_send_products')}
      description={t('inbox_products_help')}
      width={420}
      sheetOnMobile
      footer={
        <>
          <Text typo="13" color="txt-black-darker" className="tabular" aria-live="polite">
            {t('inbox_products_selected').replace('{n}', fmt(picked.length)).replace('{max}', fmt(MAX_PICK))}
          </Text>
          <Button
            leftContent={SendIcon}
            text={t('inbox_send')}
            disabled={picked.length === 0}
            onClick={() => {
              onSend(picked)
              close()
            }}
          />
        </>
      }
    >
      <div className="ibx-pick">
        <TextField
          type="search"
          size="m"
          leftContent={{ icon: SearchIcon }}
          allowClear
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('bot_product_search')}
          aria-label={t('bot_product_search')}
          autoComplete="off"
        />
        {error !== null && <ErrorBanner error={error} />}
        {products === null ? (
          error === null && <LoadingState compact />
        ) : products.length === 0 ? (
          <EmptyState compact icon={ShoppingIcon} title={q.trim() ? t('bot_product_no_match') : t('bot_product_empty')} />
        ) : (
          <ul className="ibx-pick__list" aria-label={t('bot_nav_products')}>
            {products.map((p) => {
              const on = picked.some((x) => x.id === p.id)
              return (
                <li key={p.id} className="ibx-pick__row">
                  <Checkbox checked={on} disabled={!on && full} onCheckedChange={(v) => toggle(p, v === true)}>
                    <span className="ibx-pick__name" title={p.name}>
                      {p.name}
                    </span>
                  </Checkbox>
                  <span className="ibx-pick__meta">
                    {!p.inStock && (
                      <Badge size="xs" variant="monochrome-light">
                        {t('bot_out_of_stock')}
                      </Badge>
                    )}
                    <span className="tabular">{formatPrice(lang, p.price, p.currency)}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Drawer>
  )
}
