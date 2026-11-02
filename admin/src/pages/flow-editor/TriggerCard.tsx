import { HStack, VStack } from '@channel.io/bezier-react'
import { TrashIcon } from '@channel.io/bezier-icons'
import type { Trigger } from '@shared/flows/types'
import type { Key } from '../../lib/i18n'
import { SelectField, TextInputField } from '../../components'
import { AddButton, IconBtn, ListInputField } from './fields'
import { MATCH_TYPES, TRIGGER_TYPES, defaultTrigger, type MatchType, type TFn, type TriggerType } from './model'

export function TriggerCard({ trigger, index, onChange, onRemove, t }: { trigger: Trigger; index: number; onChange: (tr: Trigger) => void; onRemove: () => void; t: TFn }) {
  return (
    <div className="fe-item">
      <HStack spacing={8} align="end">
        <div className="fe-grow">
          <SelectField
            label={t('editor_trigger_n').replace('{n}', String(index + 1))}
            value={trigger.type}
            options={TRIGGER_TYPES.map((type) => ({ value: type, label: t(`trigger_${type}` as Key) }))}
            onChange={(type: TriggerType) => onChange(defaultTrigger(type))}
          />
        </div>
        <IconBtn icon={TrashIcon} danger label={t('delete')} onClick={onRemove} />
      </HStack>
      {trigger.type === 'keyword' && (
        <div className="fe-grid-2">
          <ListInputField label={t('editor_keywords')} value={trigger.keywords} onChange={(keywords) => onChange({ ...trigger, keywords })} />
          <SelectField
            label={t('editor_match')}
            value={trigger.match ?? 'contains'}
            options={MATCH_TYPES.map((m) => ({ value: m, label: t(`editor_match_${m}` as Key) }))}
            onChange={(match: MatchType) => onChange({ ...trigger, match })}
          />
        </div>
      )}
      {trigger.type === 'comment' && (
        <div className="fe-grid-2">
          <ListInputField label={t('editor_keywords')} value={trigger.keywords ?? []} onChange={(keywords) => onChange({ ...trigger, keywords })} />
          <ListInputField label={t('editor_post_ids')} value={trigger.postIds ?? []} onChange={(postIds) => onChange({ ...trigger, postIds })} />
        </div>
      )}
      {trigger.type === 'ref' && <TextInputField label={t('editor_ref')} value={trigger.ref} onChange={(e) => onChange({ ...trigger, ref: e.target.value })} />}
      {trigger.type === 'postback' && <TextInputField label={t('editor_payload')} value={trigger.payload} onChange={(e) => onChange({ ...trigger, payload: e.target.value })} />}
    </div>
  )
}

export function TriggerList({ triggers, onChange, t }: { triggers: Trigger[]; onChange: (fn: (ts: Trigger[]) => Trigger[]) => void; t: TFn }) {
  return (
    <VStack spacing={12}>
      {triggers.map((tr, i) => (
        <TriggerCard
          key={i}
          index={i}
          trigger={tr}
          t={t}
          onChange={(ntr) => onChange((ts) => ts.map((x, j) => (j === i ? ntr : x)))}
          onRemove={() => onChange((ts) => ts.filter((_, j) => j !== i))}
        />
      ))}
      <div>
        <AddButton text={t('editor_add_trigger')} onClick={() => onChange((ts) => [...ts, defaultTrigger('keyword')])} />
      </div>
    </VStack>
  )
}
