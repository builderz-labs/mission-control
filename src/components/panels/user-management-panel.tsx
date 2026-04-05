'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useMissionControl } from '@/store'
import { useUserManagement } from './user-management/use-user-management'
import { AccessRequestsTable } from './user-management/access-requests-table'
import { CreateUserForm } from './user-management/create-user-form'
import { UserTable } from './user-management/user-table'
import { type CreateFormState, type EditFormState, type ReviewFormState } from './user-management/types'

const DEFAULT_CREATE_FORM: CreateFormState = { username: '', password: '', display_name: '', role: 'operator' }
const DEFAULT_EDIT_FORM: EditFormState = { display_name: '', role: '', password: '' }
const DEFAULT_REVIEW_FORM: ReviewFormState = { role: 'viewer', note: '' }

export function UserManagementPanel(): React.JSX.Element {
  const t = useTranslations('userManagement')
  const { currentUser } = useMissionControl()
  const {
    users, loading, error, feedback, pendingRequests,
    creating, saving, processingRequestId,
    handleCreate, handleEdit, handleDelete, submitReview,
  } = useUserManagement()

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateFormState>(DEFAULT_CREATE_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<EditFormState>(DEFAULT_EDIT_FORM)
  const [reviewingRequestId, setReviewingRequestId] = useState<number | null>(null)
  const [reviewForm, setReviewForm] = useState<ReviewFormState>(DEFAULT_REVIEW_FORM)

  const formatDate = (ts: number | null | undefined): string => {
    if (!ts) return t('never')
    return new Date(ts * 1000).toLocaleString()
  }

  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 text-center">
        <div className="text-lg font-semibold text-foreground mb-2">{t('accessDenied')}</div>
        <p className="text-sm text-muted-foreground">{t('adminRequired')}</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mx-auto mb-2" />
        <span className="text-sm text-muted-foreground">{t('loadingUsers')}</span>
      </div>
    )
  }

  if (error) {
    return <div className="p-8 text-center"><div className="text-sm text-red-400">{error}</div></div>
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('usersTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('usersSummary', { count: users.length, pending: pendingRequests.length })}</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          {showCreate ? t('cancel') : t('addLocalUser')}
        </Button>
      </div>

      {feedback && (
        <div className={`px-3 py-2 rounded-md text-sm border ${feedback.ok ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
          {feedback.text}
        </div>
      )}

      {pendingRequests.length > 0 && (
        <AccessRequestsTable
          pendingRequests={pendingRequests}
          processingRequestId={processingRequestId}
          reviewingRequestId={reviewingRequestId}
          reviewForm={reviewForm}
          onSetReviewingId={setReviewingRequestId}
          onSetReviewForm={setReviewForm}
          onSubmitReview={(id, action) => submitReview(id, action, reviewForm, () => {
            setReviewingRequestId(null)
            setReviewForm(DEFAULT_REVIEW_FORM)
          })}
          formatDate={formatDate}
        />
      )}

      {showCreate && (
        <CreateUserForm
          createForm={createForm}
          creating={creating}
          onChangeForm={setCreateForm}
          onCreate={() => handleCreate(createForm, () => {
            setShowCreate(false)
            setCreateForm(DEFAULT_CREATE_FORM)
          })}
        />
      )}

      {users.length === 0 && pendingRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm font-medium text-foreground">No users yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Click &ldquo;Add Local User&rdquo; to create an account, or share your access request link to invite team members.
          </p>
        </div>
      ) : (
        <UserTable
          users={users}
          currentUserId={currentUser?.id}
          editingId={editingId}
          editForm={editForm}
          saving={saving}
          onStartEdit={(u) => { setEditingId(u.id); setEditForm({ display_name: u.display_name, role: u.role, password: '' }) }}
          onChangeEditForm={setEditForm}
          onSaveEdit={() => {
            if (!editingId) return Promise.resolve()
            return handleEdit(editingId, editForm, () => setEditingId(null))
          }}
          onCancelEdit={() => setEditingId(null)}
          onDelete={(u) => handleDelete(u, currentUser?.id)}
          formatDate={formatDate}
        />
      )}
    </div>
  )
}
