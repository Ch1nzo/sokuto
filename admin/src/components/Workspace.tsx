import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  ButtonGroup,
  Divider,
  Icon,
  ListItem,
  Modal,
  ModalBody,
  ModalClose,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  VStack,
  type SelectRef,
} from '@channel.io/bezier-react'
import { CheckIcon, PlusIcon, SettingsIcon } from '@channel.io/bezier-icons'
import { ApiError, api } from '../lib/api'
import { useT } from '../lib/i18n'
import { switchWorkspace, useWorkspaces, type Workspace } from '../lib/workspace'
import { ErrorBanner } from './ErrorBanner'
import { TextInputField } from './Field'

const TINTS = ['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'cobalt', 'navy'] as const
const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null

/** First user-perceived character ("🍣" stays whole, "café" → "C"). */
export function workspaceInitial(name: string): string {
  const s = name.trim()
  const first = graphemes ? graphemes.segment(s)[Symbol.iterator]().next().value?.segment : Array.from(s)[0]
  return (first ?? '?').toLocaleUpperCase()
}

/** Rounded square with the workspace's initial; the tint follows the id so workspaces stay recognizable. */
export function WorkspaceAvatar({ workspace, size = 24 }: { workspace: Workspace; size?: number }) {
  const tint = TINTS[(workspace.id - 1) % TINTS.length]
  return (
    <span
      className="ws-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), color: `var(--bgtxt-${tint}-normal)`, background: `var(--bgtxt-${tint}-lightest)` }}
    >
      {workspaceInitial(workspace.name)}
    </span>
  )
}

/** "Add workspace" dialog: name (1–60 chars, the API limit) → POST /api/workspaces → `onCreated`. */
export function AddWorkspaceModal({ show, onHide, onCreated }: { show: boolean; onHide: () => void; onCreated: (w: Workspace) => void }) {
  const t = useT()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    if (!show) return
    setName('')
    setError(null)
  }, [show])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError(t('workspace_name_invalid'))
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ workspace: Workspace }>('/api/workspaces', { name: trimmed })
      onCreated(r.workspace)
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_name' ? t('workspace_name_invalid') : err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal show={show} onHide={onHide}>
      <ModalContent width="min(440px, calc(100vw - 32px))">
        <ModalHeader title={t('workspace_add')} description={t('workspace_lead')} />
        <ModalBody>
          <VStack as="form" id="ws-add-form" spacing={16} onSubmit={submit}>
            <TextInputField
              label={t('workspace_name')}
              name="workspace-name"
              autoComplete="off"
              placeholder={t('workspace_name_placeholder')}
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            {error !== null && <ErrorBanner error={error} />}
          </VStack>
        </ModalBody>
        <ModalFooter
          rightContent={
            <ButtonGroup>
              <ModalClose>
                <Button styleVariant="secondary" colorVariant="monochrome-light" text={t('cancel')} />
              </ModalClose>
              <Button type="submit" form="ws-add-form" text={t('create')} loading={busy} />
            </ButtonGroup>
          }
        />
      </ModalContent>
    </Modal>
  )
}

/** Shell workspace switcher (Channel.io style): current workspace + dropdown of all workspaces, add, manage. */
export function WorkspaceSwitcher() {
  const t = useT()
  const navigate = useNavigate()
  const { workspaces, current } = useWorkspaces()
  const ref = useRef<SelectRef>(null)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  const pick = (fn: () => void) => () => {
    ref.current?.handleHideDropdown()
    fn()
  }

  return (
    <>
      <Select
        ref={ref}
        className="ws-switcher"
        aria-label={current ? `${t('workspace_switch_label')}: ${current.name}` : t('workspace_switch_label')}
        aria-expanded={open}
        title={current?.name}
        text={
          current && (
            <span className="ws-switcher__current">
              <WorkspaceAvatar workspace={current} />
              <span className="ws-switcher__name">{current.name}</span>
            </span>
          )
        }
        placeholder={t('workspace')}
        dropdownContainer={typeof document === 'undefined' ? undefined : document.body}
        dropdownClassName="ws-switcher__menu select-dropdown"
        onClickTrigger={() => setOpen(true)}
        onHideDropdown={() => setOpen(false)}
      >
        {/* Only the list scrolls, so "add" and "manage" stay visible with many workspaces. */}
        <div className="ws-switcher__list">
          {workspaces.map((w) => {
            const isCurrent = w.id === current?.id
            return (
              <ListItem
                key={w.id}
                content={w.name}
                title={w.name}
                leftContent={<WorkspaceAvatar workspace={w} />}
                rightContent={isCurrent ? <Icon source={CheckIcon} size="s" color="bgtxt-blue-normal" /> : undefined}
                active={isCurrent}
                aria-current={isCurrent ? 'true' : undefined}
                onClick={pick(() => !isCurrent && switchWorkspace(w.id))}
              />
            )
          })}
        </div>
        <Divider />
        <ListItem content={t('workspace_add')} leftContent={PlusIcon} onClick={pick(() => setAdding(true))} />
        <ListItem content={t('workspace_manage')} leftContent={SettingsIcon} onClick={pick(() => navigate('/settings#workspaces'))} />
      </Select>
      <AddWorkspaceModal show={adding} onHide={() => setAdding(false)} onCreated={(w) => switchWorkspace(w.id)} />
    </>
  )
}
