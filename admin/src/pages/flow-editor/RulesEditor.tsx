import { HStack, SegmentedControl, SegmentedControlItem, Text, TextField, VStack } from '@channel.io/bezier-react'
import { CancelIcon } from '@channel.io/bezier-icons'
import type { ConditionRule } from '@shared/flows/types'
import { SelectInput } from '../../components'
import { AddButton, IconBtn } from './fields'
import { OPS_WITHOUT_VALUE, RULE_OPS, type TFn } from './model'

type Mode = 'all' | 'any'

/** Rule rows + all/any switch, shared by condition steps and segments (Contacts). Needs `flow-editor.css`. */
export function RulesEditor({ value, onChange, t }: { value: { rules: ConditionRule[]; mode?: Mode }; onChange: (patch: { rules?: ConditionRule[]; mode?: Mode }) => void; t: TFn }) {
  const { rules } = value
  const setRule = (i: number, r: ConditionRule) => onChange({ rules: rules.map((x, j) => (j === i ? r : x)) })
  return (
    <VStack spacing={8}>
      <Text typo="13" bold color="txt-black-darker">
        {t('editor_rules')}
      </Text>
      {rules.map((r, i) => {
        const noValue = OPS_WITHOUT_VALUE.includes(r.op)
        return (
          <div className={noValue ? 'fe-rule fe-rule--novalue' : 'fe-rule'} key={i}>
            {/* Wrapper divs carry the grid classes: TextField puts className on its inner <input>. */}
            <div className="fe-rule__field">
              <TextField value={r.field} placeholder="tag / channel / last_input / field" aria-label={t('editor_rule_field')} onChange={(e) => setRule(i, { ...r, field: e.target.value })} />
            </div>
            <div className="fe-rule__op">
              <SelectInput
                aria-label={t('editor_rule_op')}
                value={r.op}
                options={RULE_OPS.map((op) => ({ value: op, label: op }))}
                onChange={(op) => setRule(i, OPS_WITHOUT_VALUE.includes(op) ? { field: r.field, op } : { ...r, op, value: r.value ?? '' })}
              />
            </div>
            {!noValue && (
              <div className="fe-rule__value">
                <TextField value={r.value ?? ''} aria-label={t('editor_value')} placeholder={t('editor_value')} onChange={(e) => setRule(i, { ...r, value: e.target.value })} />
              </div>
            )}
            <div className="fe-rule__remove">
              <IconBtn icon={CancelIcon} label={t('delete')} disabled={rules.length <= 1} onClick={() => onChange({ rules: rules.filter((_, j) => j !== i) })} />
            </div>
          </div>
        )
      })}
      <HStack spacing={8} justify="between" wrap>
        <AddButton text={t('editor_add_rule')} onClick={() => onChange({ rules: [...rules, { field: '', op: 'equals', value: '' }] })} />
        <SegmentedControl type="radiogroup" size="s" width={260} value={value.mode ?? 'all'} onValueChange={(mode: Mode) => onChange({ mode })} aria-label={t('editor_rules')}>
          <SegmentedControlItem value="all">{t('editor_mode_all')}</SegmentedControlItem>
          <SegmentedControlItem value="any">{t('editor_mode_any')}</SegmentedControlItem>
        </SegmentedControl>
      </HStack>
      <Text typo="12" color="txt-black-dark" className="fe-wrap">
        {t('editor_rule_fields_help')}
      </Text>
    </VStack>
  )
}
