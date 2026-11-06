import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Banner, Button, Icon, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Text, TextField, VStack, useToast } from '@channel.io/bezier-react'
import { CheckCircleFilledIcon, ErrorTriangleFilledIcon, ImageIcon, PencilIcon, PlusIcon, SearchIcon, ShoppingIcon, TrashIcon, UploadIcon } from '@channel.io/bezier-icons'
import { api, errorMessage } from '../../lib/api'
import { useLang, useT } from '../../lib/i18n'
import {
  Card,
  DataTable,
  Drawer,
  EmptyState,
  ErrorBanner,
  LoadingState,
  ModalCloseButton,
  RelativeTime,
  RowMenu,
  SelectField,
  TextAreaField,
  TextInputField,
  formatNumber,
  type Column,
} from '../../components'
import { ConfirmAction } from '../../components/ConfirmAction'
import { BotFrame, CURRENCIES, SwitchRow, formatPrice, useBot } from './shared'
import type { Product, ProductInput } from './types'

const VISIBLE_TAGS = 3
const CSV_COLUMNS = 'name, description, price, currency, url, imageUrl, tags, sku, inStock'

type Form = { name: string; description: string; price: string; currency: string; url: string; imageUrl: string; tags: string; sku: string; inStock: boolean }

const blank = (): Form => ({ name: '', description: '', price: '', currency: 'JPY', url: '', imageUrl: '', tags: '', sku: '', inStock: true })

const toForm = (p: Product): Form => ({
  name: p.name,
  description: p.description,
  price: p.price === null ? '' : String(p.price),
  currency: p.currency,
  url: p.url ?? '',
  imageUrl: p.imageUrl ?? '',
  tags: p.tags.join(', '),
  sku: p.sku ?? '',
  inStock: p.inStock,
})

/** Full-width digits are fine ("１２８０"); empty = no price. */
const priceText = (s: string) => s.normalize('NFKC').trim()
const priceInvalid = (s: string) => priceText(s) !== '' && !/^\d+$/.test(priceText(s))
const urlInvalid = (s: string) => s.trim() !== '' && !/^https?:\/\/\S+$/i.test(s.trim())

function toBody(f: Form): ProductInput {
  return {
    name: f.name.trim(),
    description: f.description.trim(),
    price: priceText(f.price) === '' ? null : Number(priceText(f.price)),
    currency: f.currency,
    url: f.url.trim() || null,
    imageUrl: f.imageUrl.trim() || null,
    tags: f.tags
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter(Boolean),
    sku: f.sku.trim() || null,
    inStock: f.inStock,
  }
}

/** Product image, or a placeholder when there is none or it fails to load. */
function Thumb({ url, size }: { url: string | null; size: 48 | 64 }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [url])
  return (
    <span className={`bot-thumb bot-thumb--${size}`}>
      {url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Icon source={ImageIcon} size="s" color="txt-black-dark" />}
    </span>
  )
}

type ImportResult = { imported: number; updated: number; errors: { line: number; error: string }[] }

export default function Products() {
  const t = useT()
  const { lang } = useLang()
  const fmt = formatNumber(lang)
  const toast = useToast()
  const { reload: reloadBot } = useBot()
  const [params, setParams] = useSearchParams()
  const debouncedQ = params.get('q') ?? ''
  const [q, setQ] = useState(debouncedQ)
  const [products, setProducts] = useState<Product[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [form, setForm] = useState<Form>(blank)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<unknown>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [importing, setImporting] = useState(false)
  const [csv, setCsv] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<unknown>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(
      () =>
        setParams(
          (prev) => {
            const v = q.trim()
            if ((prev.get('q') ?? '') === v) return prev
            const next = new URLSearchParams(prev)
            if (v) next.set('q', v)
            else next.delete('q')
            return next
          },
          { replace: true },
        ),
      300,
    )
    return () => clearTimeout(timer)
  }, [q, setParams])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .get<{ products: Product[] }>(`/api/bot/products${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ''}`)
      .then((r) => {
        if (!cancelled) {
          setProducts(r.products)
          setError(null)
        }
      })
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [debouncedQ, reload])

  const changed = useCallback(() => {
    setReload((n) => n + 1)
    void reloadBot()
  }, [reloadBot])

  const open = (p: Product | 'new') => {
    setEditing(p)
    setForm(p === 'new' ? blank() : toForm(p))
    setFormError(null)
  }

  const invalid = !form.name.trim() || priceInvalid(form.price) || urlInvalid(form.url) || urlInvalid(form.imageUrl)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing || invalid || busy) return
    setBusy(true)
    setFormError(null)
    try {
      if (editing === 'new') await api.post('/api/bot/products', toBody(form))
      else await api.put(`/api/bot/products/${editing.id}`, toBody(form))
      toast.addToast(editing === 'new' ? t('bot_product_added') : t('saved'), { preset: 'success' })
      setEditing(null)
      changed()
    } catch (err) {
      setFormError(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: Product) => {
    try {
      await api.delete(`/api/bot/products/${p.id}`)
      toast.addToast(t('bot_product_deleted'), { preset: 'success' })
      setEditing(null)
      changed()
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    }
  }

  const runImport = async () => {
    if (!csv.trim() || importBusy) return
    setImportBusy(true)
    setImportError(null)
    try {
      const r = await api.post<ImportResult>('/api/bot/products/import', { csv })
      setResult(r)
      if (r.imported + r.updated > 0) changed()
    } catch (err) {
      setImportError(err)
    } finally {
      setImportBusy(false)
    }
  }

  const openImport = () => {
    setCsv('')
    setResult(null)
    setImportError(null)
    setImporting(true)
  }

  const columns: Column<Product>[] = [
    { key: 'image', header: <span className="visually-hidden">{t('bot_product_image')}</span>, width: 72, hideOnMobile: true, render: (p) => <Thumb url={p.imageUrl} size={48} /> },
    {
      key: 'name',
      header: t('bot_col_name'),
      render: (p) => (
        <span className="bot-product">
          <span className="bot-clamp2 bot-product__name" title={p.name}>
            {p.name}
          </span>
          {p.sku && (
            <span className="bot-trunc bot-product__sku" title={p.sku}>
              {p.sku}
            </span>
          )}
        </span>
      ),
    },
    { key: 'price', header: t('bot_col_price'), numeric: true, nowrap: true, render: (p) => formatPrice(lang, p.price, p.currency) },
    {
      key: 'tags',
      header: t('contacts_tags'),
      hideOnMobile: true,
      render: (p) =>
        p.tags.length === 0 ? (
          <Text typo="13" color="txt-black-dark">
            —
          </Text>
        ) : (
          <span className="bot-tags">
            {p.tags.slice(0, VISIBLE_TAGS).map((tag) => (
              <Badge key={tag} size="s" variant="default" className="bot-tag" title={tag}>
                {tag}
              </Badge>
            ))}
            {p.tags.length > VISIBLE_TAGS && (
              <Badge size="s" variant="monochrome-light" className="bot-tag bot-tag--more" title={p.tags.slice(VISIBLE_TAGS).join('\n')}>
                +{fmt(p.tags.length - VISIBLE_TAGS)}
              </Badge>
            )}
          </span>
        ),
    },
    {
      key: 'stock',
      header: t('bot_col_stock'),
      nowrap: true,
      hideOnMobile: true,
      render: (p) =>
        p.inStock ? (
          <Badge className="bot-badge" size="s" variant="green">
            {t('bot_in_stock')}
          </Badge>
        ) : (
          <Badge className="bot-badge" size="s" variant="monochrome-light">
            {t('bot_out_of_stock')}
          </Badge>
        ),
    },
    { key: 'updated', header: t('bot_col_updated'), nowrap: true, hideOnMobile: true, render: (p) => <RelativeTime value={p.updatedAt} /> },
    {
      key: 'menu',
      header: <span className="visually-hidden">{t('flows_menu')}</span>,
      width: 48,
      render: (p) => (
        <RowMenu
          label={`${t('flows_menu')}: ${p.name}`}
          items={[
            { label: t('bot_edit'), icon: PencilIcon, onSelect: () => open(p) },
            { label: t('delete'), icon: TrashIcon, danger: true, onSelect: () => setDeleting(p) },
          ]}
        />
      ),
    },
  ]

  const empty = debouncedQ ? (
    <EmptyState compact icon={SearchIcon} title={t('bot_product_no_match')} action={<Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" text={t('inbox_search_clear')} onClick={() => setQ('')} />} />
  ) : (
    <EmptyState
      icon={ShoppingIcon}
      title={t('bot_product_empty')}
      description={t('bot_product_empty_desc')}
      action={<Button leftContent={PlusIcon} text={t('bot_product_add')} onClick={() => open('new')} />}
    />
  )

  const editingProduct = editing !== null && editing !== 'new' ? editing : null

  return (
    <BotFrame
      section="products"
      actions={
        <>
          <Button styleVariant="secondary" colorVariant="monochrome-dark" leftContent={UploadIcon} text={t('bot_product_import')} onClick={openImport} />
          <Button leftContent={PlusIcon} text={t('bot_product_add')} onClick={() => open('new')} />
        </>
      }
    >
      <div className="stack">
        <div className="bot-toolbar">
          <div className="bot-toolbar__search">
            <TextField
              type="search"
              size="m"
              leftContent={{ icon: SearchIcon }}
              allowClear
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('bot_product_search')}
              aria-label={t('bot_product_search')}
              name="q"
              autoComplete="off"
            />
          </div>
          {products && (
            <Text typo="13" color="txt-black-dark" className="tabular">
              {t('bot_product_count').replace('{n}', fmt(products.length))}
            </Text>
          )}
        </div>
        {error !== null && <ErrorBanner error={error} onRetry={() => setReload((n) => n + 1)} />}
        <Card flush className={loading && products ? 'bot-table is-loading' : 'bot-table'}>
          {products === null ? (
            error === null && <LoadingState compact />
          ) : (
            <DataTable columns={columns} rows={products} rowKey={(p) => p.id} onRowClick={open} caption={t('bot_nav_products')} empty={empty} />
          )}
        </Card>
      </div>

      <Drawer
        show={editing !== null}
        onHide={() => setEditing(null)}
        title={editing === 'new' ? t('bot_product_add') : t('bot_product_edit')}
        width={520}
        footer={
          <>
            {editingProduct ? <Button styleVariant="secondary" colorVariant="red" leftContent={TrashIcon} text={t('delete')} onClick={() => setDeleting(editingProduct)} /> : <span />}
            <Button type="submit" form="bot-product-form" text={t('save')} loading={busy} disabled={invalid} />
          </>
        }
      >
        <VStack as="form" id="bot-product-form" spacing={16} onSubmit={save}>
          <TextInputField label={t('bot_col_name')} value={form.name} maxLength={100} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextAreaField
            label={t('bot_product_description')}
            helperText={t('bot_product_description_help')}
            value={form.description}
            maxLength={1000}
            maxRows={10}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="bot-form-row">
            <TextInputField
              label={t('bot_col_price')}
              inputMode="numeric"
              placeholder="1280"
              autoComplete="off"
              value={form.price}
              error={priceInvalid(form.price) ? t('bot_product_price_invalid') : undefined}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
            <SelectField label={t('bot_product_currency')} value={form.currency} options={[...new Set([...CURRENCIES, form.currency])].map((c) => ({ value: c, label: c }))} onChange={(v) => setForm({ ...form, currency: v })} />
          </div>
          <TextInputField
            label={t('bot_product_url')}
            helperText={t('bot_product_url_help')}
            type="url"
            inputMode="url"
            placeholder="https://"
            autoComplete="off"
            value={form.url}
            error={urlInvalid(form.url) ? t('bot_url_invalid') : undefined}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
          <div className="bot-image-field">
            <TextInputField
              label={t('bot_product_image')}
              type="url"
              inputMode="url"
              placeholder="https://"
              autoComplete="off"
              value={form.imageUrl}
              error={urlInvalid(form.imageUrl) ? t('bot_url_invalid') : undefined}
              onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
            />
            <Thumb url={urlInvalid(form.imageUrl) ? null : form.imageUrl.trim() || null} size={64} />
          </div>
          <TextInputField label={t('contacts_tags')} helperText={t('bot_product_tags_help')} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <TextInputField label="SKU" helperText={t('bot_product_sku_help')} value={form.sku} autoComplete="off" onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <SwitchRow id="bot-product-stock" label={t('bot_in_stock')} help={t('bot_product_stock_help')} checked={form.inStock} onChange={(v) => setForm({ ...form, inStock: v })} />
          {formError !== null && <ErrorBanner error={formError} />}
        </VStack>
      </Drawer>

      <Modal show={importing} onHide={() => setImporting(false)}>
        <ModalContent width="min(640px, 100vw)" aria-describedby={undefined}>
          <ModalHeader className="modal-head" title={t('bot_product_import')} />
          <ModalBody>
            <VStack spacing={16}>
              <Text as="p" typo="13" color="txt-black-darker">
                {t('bot_import_lead')}
              </Text>
              <code className="bot-code">{CSV_COLUMNS}</code>
              <Text as="p" typo="12" color="txt-black-dark">
                {t('bot_import_help')}
              </Text>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="visually-hidden"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) void file.text().then(setCsv, (err: unknown) => setImportError(err))
                  }}
                />
                <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={UploadIcon} text={t('bot_import_file')} onClick={() => fileRef.current?.click()} />
              </div>
              <TextAreaField label={t('bot_import_paste')} value={csv} minRows={6} maxRows={16} placeholder={`name,price,url\n${t('bot_import_example')}`} onChange={(e) => setCsv(e.target.value)} className="bot-csv" />
              {importError !== null && <ErrorBanner error={importError} />}
              {result && (
                <>
                  <Banner
                    variant={result.errors.length > 0 ? 'orange' : 'green'}
                    icon={result.errors.length > 0 ? ErrorTriangleFilledIcon : CheckCircleFilledIcon}
                    content={t('bot_import_result').replace('{imported}', fmt(result.imported)).replace('{updated}', fmt(result.updated)).replace('{errors}', fmt(result.errors.length))}
                  />
                  {result.errors.length > 0 && (
                    <ul className="bot-import-errors">
                      {result.errors.map((e, i) => (
                        <li key={i}>
                          <span className="tabular">{t('bot_import_line').replace('{n}', fmt(e.line))}</span> {e.error}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </VStack>
          </ModalBody>
          <ModalFooter
            rightContent={<Button leftContent={UploadIcon} text={t('bot_import_run')} loading={importBusy} disabled={!csv.trim()} onClick={() => void runImport()} />}
          />
          <ModalCloseButton />
        </ModalContent>
      </Modal>

      <ConfirmAction
        show={deleting !== null}
        onHide={() => setDeleting(null)}
        onConfirm={() => deleting && void remove(deleting)}
        title={t('bot_product_delete_title')}
        description={deleting?.name}
        confirmText={t('delete')}
      />
    </BotFrame>
  )
}
