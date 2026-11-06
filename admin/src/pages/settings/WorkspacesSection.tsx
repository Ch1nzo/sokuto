import { useState, type FormEvent } from 'react'
import { Badge, Button, Text, TextField, VStack, useToast } from '@channel.io/bezier-react'
import { PencilIcon, PlusIcon, TrashIcon } from '@channel.io/bezier-icons'
import { ApiError, api, errorMessage } from '../../lib/api'
import { useLang, useT } from '../../lib/i18n'
import { switchWorkspace, useWorkspaces, type Workspace } from '../../lib/workspace'
import { AddWorkspaceModal, Card, ErrorBanner, LoadingState, WorkspaceAvatar, formatDateTime } from '../../components'
import { ConfirmAction } from '../../components/ConfirmAction'
import { IconBtn } from '../flow-editor/fields'

/** Settings › Workspaces: list (name, created, current/default), switch, inline rename, add, delete. */
export function WorkspacesSection() {
  const t = useT()
  const { lang } = useLang()
  const toast = useToast()
  const { workspaces, current, error, reload } = useWorkspaces()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [renameError, setRenameError] = useState<unknown>(null)
  // Kept after the modal closes so its title does not blank out during the exit animation.
  const [toDelete, setToDelete] = useState<Workspace | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState<number | null>(null)

  const startRename = (w: Workspace) => {
    setRenameError(null)
    setEditing({ id: w.id, name: w.name })
  }

  const rename = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    const name = editing.name.trim()
    if (!name) return setRenameError(t('workspace_name_invalid'))
    setSaving(true)
    setRenameError(null)
    try {
      await api.put(`/api/workspaces/${editing.id}`, { name })
      await reload()
      setEditing(null)
      toast.addToast(t('saved'), { preset: 'success' })
    } catch (err) {
      setRenameError(err instanceof ApiError && err.code === 'invalid_name' ? t('workspace_name_invalid') : err)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (w: Workspace) => {
    setDeleting(w.id)
    try {
      await api.delete(`/api/workspaces/${w.id}`)
      // Deleting the workspace this tab is in: continue in the default one.
      if (w.id === current?.id) return switchWorkspace(1)
      await reload()
      toast.addToast(t('workspace_deleted'), { preset: 'success' })
    } catch (err) {
      toast.addToast(errorMessage(err), { preset: 'error' })
    } finally {
      setDeleting(null)
    }
  }

  return (
    <Card title={t('settings_workspaces')} actions={<Button size="s" leftContent={PlusIcon} text={t('workspace_add')} onClick={() => setAdding(true)} />}>
      <VStack spacing={8}>
        <Text as="p" typo="13" color="txt-black-dark">
          {t('workspace_lead')} {t('workspace_default_locked')}
        </Text>
        {workspaces.length === 0 ? (
          error !== null ? (
            <ErrorBanner error={error} onRetry={() => void reload()} />
          ) : (
            <LoadingState compact />
          )
        ) : (
          <ul className="st-ws-list">
            {workspaces.map((w) => {
              const isCurrent = w.id === current?.id
              return (
                <li key={w.id} className="st-ws">
                  <WorkspaceAvatar workspace={w} size={32} />
                  {editing?.id === w.id ? (
                    <form className="st-ws__edit" onSubmit={rename}>
                      <TextField
                        size="m"
                        name="workspace-name"
                        autoComplete="off"
                        autoFocus
                        maxLength={60}
                        aria-label={t('workspace_name')}
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                      />
                      <div className="st-ws__edit-actions">
                        <Button type="submit" size="m" text={t('save')} loading={saving} />
                        <Button styleVariant="tertiary" colorVariant="monochrome-dark" size="m" text={t('cancel')} onClick={() => setEditing(null)} />
                      </div>
                      {renameError !== null && (
                        <div className="st-ws__error">
                          <ErrorBanner error={renameError} />
                        </div>
                      )}
                    </form>
                  ) : (
                    <>
                      <div className="st-ws__text">
                        <div className="st-ws__title">
                          <Text typo="14" bold color="txt-black-darkest" truncated title={w.name} className="st-ws__name">
                            {w.name}
                          </Text>
                          {isCurrent && (
                            <Badge size="s" variant="blue">
                              {t('workspace_current')}
                            </Badge>
                          )}
                          {w.id === 1 && (
                            <Badge size="s" variant="default">
                              {t('workspace_default')}
                            </Badge>
                          )}
                        </div>
                        <Text typo="12" color="txt-black-dark">
                          {t('workspace_created_at').replace('{date}', formatDateTime(lang, w.createdAt))}
                        </Text>
                      </div>
                      <div className="st-ws__actions">
                        {!isCurrent && (
                          <Button size="s" styleVariant="secondary" colorVariant="monochrome-dark" text={t('workspace_switch')} onClick={() => switchWorkspace(w.id)} />
                        )}
                        <IconBtn icon={PencilIcon} label={`${t('workspace_rename')}: ${w.name}`} onClick={() => startRename(w)} />
                        {w.id !== 1 && (
                          <IconBtn
                            icon={TrashIcon}
                            danger
                            label={`${t('delete')}: ${w.name}`}
                            disabled={deleting !== null}
                            onClick={() => {
                              setToDelete(w)
                              setConfirming(true)
                            }}
                          />
                        )}
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </VStack>

      <AddWorkspaceModal
        show={adding}
        onHide={() => setAdding(false)}
        onCreated={() => {
          setAdding(false)
          void reload()
          toast.addToast(t('workspace_added'), { preset: 'success' })
        }}
      />
      <ConfirmAction
        show={confirming}
        onHide={() => setConfirming(false)}
        title={t('workspace_delete_title').replace('{name}', toDelete?.name ?? '')}
        description={t('workspace_delete_confirm')}
        confirmText={t('delete')}
        onConfirm={() => toDelete && void remove(toDelete)}
      />
    </Card>
  )
}
