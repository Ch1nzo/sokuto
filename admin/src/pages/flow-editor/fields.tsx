import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, FormControl, FormLabel, ListItem, Select, type SelectRef } from '@channel.io/bezier-react'
import { PlusIcon, type BezierIcon } from '@channel.io/bezier-icons'
import type { Step } from '@shared/flows/types'
import type { Key } from '../../lib/i18n'
import { TextInputField } from '../../components'
import { splitList, stepSummary, type TFn } from './model'

/** Comma separated text field bound to a string[]; keeps the raw text locally so typing "a, " is not swallowed. */
export function ListInputField({ label, value, onChange, placeholder, helperText }: { label: ReactNode; value: string[]; onChange: (v: string[]) => void; placeholder?: string; helperText?: ReactNode }) {
  const [text, setText] = useState(value.join(', '))
  useEffect(() => {
    if (splitList(text).join('\u0000') !== value.join('\u0000')) setText(value.join(', '))
  }, [value])
  return (
    <TextInputField
      label={label}
      helperText={helperText}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        onChange(splitList(e.target.value))
      }}
    />
  )
}

type PickOption = { value: string; label: string; disabled?: boolean }

/** Bezier Select with per-option `disabled` (SelectInput has no such option). */
function PickSelect({ value, options, onChange, ...rest }: { value: string; options: PickOption[]; onChange: (v: string) => void; 'aria-label'?: string }) {
  const ref = useRef<SelectRef>(null)
  const current = options.find((o) => o.value === value)
  return (
    <Select ref={ref} text={current?.label ?? value} dropdownStyle={{ maxHeight: 320, overflowY: 'auto' }} {...rest}>
      {options.map((o) => (
        <ListItem
          key={o.value}
          content={o.label}
          active={o.value === value}
          disabled={o.disabled}
          role="option"
          aria-selected={o.value === value}
          aria-disabled={o.disabled || undefined}
          onClick={() => {
            if (o.disabled) return
            onChange(o.value)
            ref.current?.handleHideDropdown()
          }}
        />
      ))}
    </Select>
  )
}

/** Picker for a step pointer: lists `id · type · first 20 chars` plus "(end)" (or "—" for the entry). */
export function StepPicker({
  value,
  onChange,
  steps,
  t,
  selfId,
  allowEnd = true,
  label,
  ariaLabel,
}: {
  value: string | null | undefined
  onChange: (v: string | null) => void
  steps: Step[]
  t: TFn
  selfId?: string
  allowEnd?: boolean
  label?: ReactNode
  ariaLabel?: string
}) {
  const options: PickOption[] = [
    { value: '', label: allowEnd ? t('editor_end') : '—' },
    ...steps.map((s) => ({
      value: s.id,
      label: [s.id, t(`step_${s.type}` as Key), stepSummary(s)].filter(Boolean).join(' · '),
      disabled: s.id === selfId,
    })),
  ]
  const picker = <PickSelect value={value ?? ''} options={options} onChange={(v) => onChange(v || null)} aria-label={label ? undefined : ariaLabel ?? t('editor_next')} />
  if (!label) return picker
  return (
    <FormControl>
      <FormLabel>{label}</FormLabel>
      {picker}
    </FormControl>
  )
}

/** Icon-only Bezier button with an accessible name and a tooltip-like title. */
export function IconBtn({ icon, label, onClick, disabled, danger }: { icon: BezierIcon; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Button
      size="s"
      styleVariant="tertiary"
      colorVariant={danger ? 'red' : 'monochrome-dark'}
      leftContent={icon}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    />
  )
}

/** "+ Add …" small secondary button used under every list in the editor. */
export function AddButton({ text, onClick, disabled }: { text: string; onClick: () => void; disabled?: boolean }) {
  return <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" leftContent={PlusIcon} text={text} disabled={disabled} onClick={onClick} />
}
