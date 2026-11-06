import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  useModalContainerContext,
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  ListItem,
  Select,
  TextArea,
  TextField,
  type SelectProps,
  type SelectRef,
  type TextAreaProps,
  type TextFieldProps,
} from '@channel.io/bezier-react'

type FieldChrome = {
  label: ReactNode
  /** Grey text under the control. */
  helperText?: ReactNode
  /** Red text under the control; also sets `hasError` on the control. Hides `helperText`. */
  error?: ReactNode
  /** Tooltip "?" next to the label. */
  help?: ReactNode
  required?: boolean
  disabled?: boolean
  readOnly?: boolean
  className?: string
}

function Chrome({ label, helperText, error, help, required, disabled, readOnly, className, children }: FieldChrome & { children: ReactNode }) {
  return (
    <FormControl className={className} hasError={!!error} required={required} disabled={disabled} readOnly={readOnly}>
      <FormLabel help={help}>{label}</FormLabel>
      {children}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : helperText ? <FormHelperText>{helperText}</FormHelperText> : null}
    </FormControl>
  )
}

export type TextInputFieldProps = FieldChrome &
  Omit<TextFieldProps, 'hasError' | 'required' | 'disabled' | 'readOnly' | 'className'>

/** Label + Bezier TextField + helper/error text. Pass `value` + `onChange` like an <input>. */
export function TextInputField({ label, helperText, error, help, required, disabled, readOnly, className, ...input }: TextInputFieldProps) {
  return (
    <Chrome {...{ label, helperText, error, help, required, disabled, readOnly, className }}>
      <TextField {...input} />
    </Chrome>
  )
}

export type TextAreaFieldProps = FieldChrome &
  Omit<TextAreaProps, 'hasError' | 'required' | 'disabled' | 'readOnly' | 'className'>

/** Label + auto-growing Bezier TextArea (`minRows`/`maxRows` must be 3 | 6 | 10 | 16 | 24 | 36). */
export function TextAreaField({ label, helperText, error, help, required, disabled, readOnly, className, minRows = 3, ...input }: TextAreaFieldProps) {
  return (
    <Chrome {...{ label, helperText, error, help, required, disabled, readOnly, className }}>
      <TextArea minRows={minRows} {...input} />
    </Chrome>
  )
}

export type SelectOption<V extends string> = { value: V; label: string }

export type SelectFieldProps<V extends string> = FieldChrome & {
  value: V
  options: SelectOption<V>[]
  onChange: (value: V) => void
  placeholder?: string
}

/**
 * Label + Bezier Select (a button that opens a dropdown of ListItems; it is NOT a native <select>).
 * The dropdown closes after picking an option.
 */
export function SelectField<V extends string>({ value, options, onChange, placeholder, ...chrome }: SelectFieldProps<V>) {
  return (
    <Chrome {...chrome}>
      <SelectInput value={value} options={options} onChange={onChange} placeholder={placeholder} />
    </Chrome>
  )
}

/**
 * Where Select dropdowns render. Inside a Bezier modal they stay in the modal (outside clicks would close it);
 * elsewhere they go to <body>, so a card's z-index or an ancestor's overflow can never hide or clip them.
 */
export function useDropdownContainer(): HTMLElement | undefined {
  const modal = useModalContainerContext()
  return modal ?? (typeof document === 'undefined' ? undefined : document.body)
}

/** True when a list of `height` px would run past the bottom of the viewport and there is more room above. */
export function dropsUp(trigger: Element, height: number): boolean {
  const { top, bottom } = trigger.getBoundingClientRect()
  const below = window.innerHeight - bottom
  return below < height && top > below
}

/** Dropdown props for a Bezier Select of `count` options: rendered in the body (or modal), opening upward near the bottom. */
export function useSelectDropdown(count: number) {
  const [up, setUp] = useState(false)
  return {
    dropdownContainer: useDropdownContainer(),
    dropdownStyle: { maxHeight: 320, overflowY: 'auto' },
    dropdownPosition: up ? 'top-left' : 'bottom-left',
    // Options are 30px tall, the list caps at 320px and scrolls, 6px gap to the trigger.
    onClickTrigger: (e: MouseEvent) => setUp(dropsUp(e.currentTarget, Math.min(320, count * 30) + 6)),
  } satisfies Partial<SelectProps>
}

/** The bare select control (no label), for toolbars / filters. Wrap with FormControl yourself if needed. */
export function SelectInput<V extends string>({
  value,
  options,
  onChange,
  placeholder,
  ...rest
}: { value: V; options: SelectOption<V>[]; onChange: (value: V) => void; placeholder?: string; 'aria-label'?: string; dropdownPosition?: SelectProps['dropdownPosition']; className?: string; leftContent?: SelectProps['leftContent']; title?: string }) {
  const ref = useRef<SelectRef>(null)
  const current = options.find((o) => o.value === value)
  return (
    <Select ref={ref} text={current?.label} placeholder={placeholder} {...useSelectDropdown(options.length)} {...rest}>
      {options.map((o) => (
        <ListItem
          key={o.value}
          content={o.label}
          active={o.value === value}
          role="option"
          aria-selected={o.value === value}
          onClick={() => {
            onChange(o.value)
            ref.current?.handleHideDropdown()
          }}
        />
      ))}
    </Select>
  )
}
