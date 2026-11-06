import { useState, type FormEvent } from 'react'
import { Badge, Banner, Button, SegmentedControl, SegmentedControlItem, Text, VStack, useToast } from '@channel.io/bezier-react'
import { CheckCircleFilledIcon, InfoFilledIcon, TrashIcon } from '@channel.io/bezier-icons'
import { api } from '../../lib/api'
import { useT } from '../../lib/i18n'
import { ErrorBanner, SelectField, TextInputField } from '../../components'
import { ConfirmAction } from '../../components/ConfirmAction'
import { FlowSelect, type FlowOption } from './MetaProfileSection'

type CellType = 'flow' | 'uri' | 'message' | 'postback'
type Layout = 1 | 2 | 3 | 4 | 6
type Cell = { label?: string; type: CellType; value: string }

/** Mirrors `LineRichMenu` in src/settings.ts plus the id of the applied menu (`settings` row `richmenu:line`). */
export type LineRichMenu = { imageUrl: string; size: 'full' | 'half'; layout: Layout; chatBarText: string; cells: Cell[]; richMenuId?: string }

/** Same grid as `GRID` in src/channels/line.ts: areas → columns × rows. */
const LAYOUTS: { value: `${Layout}`; label: string }[] = [
  { value: '1', label: '1 (1×1)' },
  { value: '2', label: '2 (2×1)' },
  { value: '3', label: '3 (3×1)' },
  { value: '4', label: '4 (2×2)' },
  { value: '6', label: '6 (3×2)' },
]
const CELL_TYPES: CellType[] = ['flow', 'uri', 'message', 'postback']

const resize = (cells: Cell[], n: number): Cell[] => Array.from({ length: n }, (_, i) => cells[i] ?? { type: 'flow', value: '' })

const EMPTY: LineRichMenu = { imageUrl: '', size: 'half', layout: 3, chatBarText: '', cells: resize([], 3) }

/** LINE default rich menu: image URL + grid of areas, each starting a flow, opening a link or sending text. */
export function LineRichMenuSection({ initial, flows, onSaved }: { initial: LineRichMenu | null; flows: FlowOption[]; onSaved: () => void }) {
  const t = useT()
  const toast = useToast()
  const [form, setForm] = useState<LineRichMenu>(() => initial ?? EMPTY)
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [confirming, setConfirming] = useState(false)

  const setCell = (i: number, patch: Partial<Cell>) => setForm({ ...form, cells: form.cells.map((c, j) => (j === i ? { ...c, ...patch } : c)) })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('save')
    setError(null)
    try {
      await api.put('/api/channels/line/richmenu', form)
      toast.addToast(t('saved'), { preset: 'success' })
      onSaved()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    setBusy('remove')
    setError(null)
    try {
      await api.delete('/api/channels/line/richmenu')
      setForm(EMPTY)
      toast.addToast(t('saved'), { preset: 'success' })
      onSaved()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(null)
    }
  }

  return (
    <VStack as="form" spacing={16} onSubmit={save}>
      <div className="ch-section-head">
        <Text as="h3" typo="15" bold color="txt-black-darkest">
          {t('richmenu_title')}
        </Text>
        {initial?.richMenuId && (
          <Badge size="m" variant="green" icon={CheckCircleFilledIcon}>
            {t('richmenu_applied')}
          </Badge>
        )}
      </div>
      <Banner className="ch-result" variant="blue" icon={InfoFilledIcon} content={t('richmenu_hint')} />
      <TextInputField
        label={t('richmenu_image')}
        helperText={t('richmenu_image_help')}
        type="url"
        placeholder="https://"
        value={form.imageUrl}
        required
        onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
      />
      <SegmentedControl
        type="radiogroup"
        size="m"
        width="100%"
        value={form.size}
        onValueChange={(v: LineRichMenu['size']) => setForm({ ...form, size: v })}
        aria-label={t('richmenu_image_help')}
      >
        <SegmentedControlItem value="full">{t('richmenu_size_full')}</SegmentedControlItem>
        <SegmentedControlItem value="half">{t('richmenu_size_half')}</SegmentedControlItem>
      </SegmentedControl>
      <div className="ch-form-row">
        <SelectField
          label={t('richmenu_layout')}
          value={`${form.layout}` as `${Layout}`}
          options={LAYOUTS}
          onChange={(v) => setForm({ ...form, layout: Number(v) as Layout, cells: resize(form.cells, Number(v)) })}
        />
        <TextInputField label={t('richmenu_chatbar')} value={form.chatBarText} maxLength={14} required onChange={(e) => setForm({ ...form, chatBarText: e.target.value })} />
      </div>
      {form.cells.map((c, i) => (
        <div key={i} className="ch-item">
          <div className="ch-form-row">
            <SelectField
              label={t('richmenu_cell_n').replace('{n}', String(i + 1))}
              value={c.type}
              options={CELL_TYPES.map((v) => ({ value: v, label: t(`richmenu_type_${v}`) }))}
              onChange={(v) => setCell(i, { type: v, value: '' })}
            />
            {c.type === 'flow' ? (
              <FlowSelect label={t('profile_flow')} value={Number(c.value) || undefined} flows={flows} onChange={(id) => setCell(i, { value: id ? String(id) : '' })} />
            ) : (
              <TextInputField
                label={t('richmenu_value')}
                type={c.type === 'uri' ? 'url' : 'text'}
                placeholder={c.type === 'uri' ? 'https://' : undefined}
                value={c.value}
                maxLength={300}
                required
                onChange={(e) => setCell(i, { value: e.target.value })}
              />
            )}
            <TextInputField label={t('richmenu_label')} value={c.label ?? ''} maxLength={20} onChange={(e) => setCell(i, { label: e.target.value })} />
          </div>
        </div>
      ))}
      {error !== null && <ErrorBanner error={error} />}
      <div className="ch-actions">
        <Button type="submit" text={t('richmenu_apply')} loading={busy === 'save'} disabled={busy !== null && busy !== 'save'} />
        {initial && (
          <Button
            styleVariant="secondary"
            colorVariant="red"
            leftContent={TrashIcon}
            text={t('richmenu_remove')}
            loading={busy === 'remove'}
            disabled={busy !== null && busy !== 'remove'}
            onClick={() => setConfirming(true)}
          />
        )}
      </div>
      <ConfirmAction show={confirming} onHide={() => setConfirming(false)} title={t('richmenu_remove')} confirmText={t('richmenu_remove')} onConfirm={() => void remove()} />
    </VStack>
  )
}
