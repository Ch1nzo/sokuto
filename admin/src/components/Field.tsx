import { useRef, type ReactNode } from 'react'
import {
  FormControl,
  FormErrorMessage,
  FormHelperText,
  FormLabel,
  ListItem,
  Select,
  TextArea,
  TextField,
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

/** The bare select control (no label), for toolbars / filters. Wrap with FormControl yourself if needed. */
export function SelectInput<V extends string>({
  value,
  options,
  onChange,
  placeholder,
  ...rest
}: { value: V; options: SelectOption<V>[]; onChange: (value: V) => void; placeholder?: string; 'aria-label'?: string }) {
  const ref = useRef<SelectRef>(null)
  const current = options.find((o) => o.value === value)
  return (
    <Select ref={ref} text={current?.label} placeholder={placeholder} dropdownStyle={{ maxHeight: 320, overflowY: 'auto' }} {...rest}>
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
