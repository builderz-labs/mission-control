'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type UserRecord, type EditFormState, ROLE_COLORS } from './types'

interface UserTableProps {
  users: UserRecord[]
  currentUserId: number | undefined
  editingId: number | null
  editForm: EditFormState
  saving: boolean
  onStartEdit: (u: UserRecord) => void
  onChangeEditForm: (form: EditFormState) => void
  onSaveEdit: () => Promise<void>
  onCancelEdit: () => void
  onDelete: (u: UserRecord) => Promise<void>
  formatDate: (ts: number | null | undefined) => string
}

export function UserTable({
  users,
  currentUserId,
  editingId,
  editForm,
  saving,
  onStartEdit,
  onChangeEditForm,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  formatDate,
}: UserTableProps): React.JSX.Element {
  const t = useTranslations('userManagement')

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-secondary/50 border-b border-border">
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t('colUser')}</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t('colProvider')}</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">{t('colRole')}</th>
            <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground hidden md:table-cell">{t('colLastLogin')}</th>
            <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground">{t('colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/20 transition-smooth">
              {editingId === u.id ? (
                <EditRow
                  u={u}
                  editForm={editForm}
                  saving={saving}
                  currentUserId={currentUserId}
                  onChangeEditForm={onChangeEditForm}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                />
              ) : (
                <ViewRow
                  u={u}
                  currentUserId={currentUserId}
                  onStartEdit={onStartEdit}
                  onDelete={onDelete}
                  formatDate={formatDate}
                />
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface EditRowProps {
  u: UserRecord
  editForm: EditFormState
  saving: boolean
  currentUserId: number | undefined
  onChangeEditForm: (form: EditFormState) => void
  onSaveEdit: () => Promise<void>
  onCancelEdit: () => void
}

function EditRow({ u, editForm, saving, currentUserId, onChangeEditForm, onSaveEdit, onCancelEdit }: EditRowProps): React.JSX.Element {
  const t = useTranslations('userManagement')
  const isLocal = (u.provider || 'local') === 'local'

  return (
    <>
      <td className="px-4 py-2.5">
        <input
          value={editForm.display_name}
          onChange={(e) => onChangeEditForm({ ...editForm, display_name: e.target.value })}
          className="h-8 px-2 rounded bg-secondary border border-border text-sm text-foreground w-full"
        />
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">{u.provider || 'local'}</td>
      <td className="px-4 py-2.5">
        <select
          value={editForm.role}
          onChange={(e) => onChangeEditForm({ ...editForm, role: e.target.value as EditFormState['role'] })}
          className="h-8 px-2 rounded bg-secondary border border-border text-sm text-foreground"
          disabled={u.id === currentUserId}
        >
          <option value="viewer">{t('roleViewer')}</option>
          <option value="operator">{t('roleOperator')}</option>
          <option value="admin">{t('roleAdmin')}</option>
        </select>
      </td>
      <td className="px-4 py-2.5 hidden md:table-cell">
        <input
          type="password"
          value={editForm.password}
          onChange={(e) => onChangeEditForm({ ...editForm, password: e.target.value })}
          placeholder={t('newPasswordOptional')}
          className="h-8 px-2 rounded bg-secondary border border-border text-sm text-foreground w-full"
          disabled={!isLocal}
        />
      </td>
      <td className="px-4 py-2.5 text-right space-x-2">
        <Button onClick={onSaveEdit} disabled={saving} size="xs">{t('save')}</Button>
        <Button onClick={onCancelEdit} variant="outline" size="xs">{t('cancel')}</Button>
      </td>
    </>
  )
}

interface ViewRowProps {
  u: UserRecord
  currentUserId: number | undefined
  onStartEdit: (u: UserRecord) => void
  onDelete: (u: UserRecord) => Promise<void>
  formatDate: (ts: number | null | undefined) => string
}

function ViewRow({ u, currentUserId, onStartEdit, onDelete, formatDate }: ViewRowProps): React.JSX.Element {
  const t = useTranslations('userManagement')
  // Initials fallback: first letter of each word in display name, up to 2
  const initials = u.display_name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary overflow-hidden">
            {u.avatar_url ? (
              <Image
                src={u.avatar_url}
                alt={u.display_name}
                width={28}
                height={28}
                unoptimized
                className="w-7 h-7 object-cover"
              />
            ) : initials}
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">{u.display_name}</div>
            <div className="text-xs text-muted-foreground">{u.email || u.username}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs">
        <span className={`px-2 py-0.5 rounded-full ${u.provider === 'google' ? 'bg-blue-500/20 text-blue-300' : 'bg-gray-500/20 text-gray-300'}`}>
          {u.provider || 'local'}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role] || ''}`}>
          {u.role}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
        {formatDate(u.last_login_at)}
      </td>
      <td className="px-4 py-2.5 text-right space-x-2">
        <Button onClick={() => onStartEdit(u)} variant="outline" size="xs">{t('edit')}</Button>
        {u.id !== currentUserId && (
          <Button onClick={() => onDelete(u)} variant="destructive" size="xs">{t('delete')}</Button>
        )}
      </td>
    </>
  )
}
