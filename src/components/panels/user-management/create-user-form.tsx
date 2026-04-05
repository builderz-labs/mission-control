'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type CreateFormState } from './types'

interface CreateUserFormProps {
  createForm: CreateFormState
  creating: boolean
  onChangeForm: (form: CreateFormState) => void
  onCreate: () => Promise<void>
}

export function CreateUserForm({
  createForm,
  creating,
  onChangeForm,
  onCreate,
}: CreateUserFormProps): React.JSX.Element {
  const t = useTranslations('userManagement')

  return (
    <div className="p-4 rounded-lg bg-secondary/50 border border-border space-y-3">
      <h3 className="text-sm font-medium text-foreground">{t('newLocalUser')}</h3>
      <div className="grid grid-cols-2 gap-3">
        <input
          value={createForm.username}
          onChange={(e) => onChangeForm({ ...createForm, username: e.target.value })}
          placeholder={t('username')}
          className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
        />
        <input
          type="password"
          value={createForm.password}
          onChange={(e) => onChangeForm({ ...createForm, password: e.target.value })}
          placeholder={t('password')}
          className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
        />
        <input
          value={createForm.display_name}
          onChange={(e) => onChangeForm({ ...createForm, display_name: e.target.value })}
          placeholder={t('displayName')}
          className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
        />
        <select
          value={createForm.role}
          onChange={(e) => onChangeForm({ ...createForm, role: e.target.value as CreateFormState['role'] })}
          className="h-9 px-3 rounded-md bg-secondary border border-border text-sm text-foreground"
        >
          <option value="viewer">{t('roleViewer')}</option>
          <option value="operator">{t('roleOperator')}</option>
          <option value="admin">{t('roleAdmin')}</option>
        </select>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={onCreate}
          disabled={!createForm.username || !createForm.password || creating}
          size="sm"
        >
          {creating ? t('creating') : t('createUser')}
        </Button>
      </div>
    </div>
  )
}
