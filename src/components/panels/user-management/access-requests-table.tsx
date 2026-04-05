'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { type AccessRequest, type ReviewFormState } from './types'

interface AccessRequestsTableProps {
  pendingRequests: AccessRequest[]
  processingRequestId: number | null
  reviewingRequestId: number | null
  reviewForm: ReviewFormState
  onSetReviewingId: (id: number | null) => void
  onSetReviewForm: (form: ReviewFormState) => void
  onSubmitReview: (requestId: number, action: 'approve' | 'reject') => Promise<void>
  formatDate: (ts: number | null | undefined) => string
}

export function AccessRequestsTable({
  pendingRequests,
  processingRequestId,
  reviewingRequestId,
  reviewForm,
  onSetReviewingId,
  onSetReviewForm,
  onSubmitReview,
  formatDate,
}: AccessRequestsTableProps): React.JSX.Element {
  const t = useTranslations('userManagement')

  return (
    <div className="border border-amber-500/30 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-sm font-medium text-amber-200">
          {t('pendingRequests', { count: pendingRequests.length })}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/40 border-b border-border">
              <th className="text-left px-3 py-2 text-xs text-muted-foreground">{t('identity')}</th>
              <th className="text-left px-3 py-2 text-xs text-muted-foreground">{t('attempts')}</th>
              <th className="text-left px-3 py-2 text-xs text-muted-foreground">{t('lastAttempt')}</th>
              <th className="text-right px-3 py-2 text-xs text-muted-foreground">{t('action')}</th>
            </tr>
          </thead>
          <tbody>
            {pendingRequests.map((req) => (
              <tr key={req.id} className="border-b border-border/40 last:border-0">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    {req.avatar_url ? (
                      <Image
                        src={req.avatar_url}
                        alt=""
                        width={32}
                        height={32}
                        unoptimized
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded-full shrink-0"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
                        {(req.display_name || req.email)?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                    <div>
                      <div className="font-medium text-foreground">{req.display_name || req.email}</div>
                      <div className="text-xs text-muted-foreground">{req.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{req.attempt_count}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(req.last_attempt_at)}</td>
                <td className="px-3 py-2 text-right">
                  {reviewingRequestId === req.id ? (
                    <InlineReviewControls
                      req={req}
                      reviewForm={reviewForm}
                      processingRequestId={processingRequestId}
                      onSetReviewForm={onSetReviewForm}
                      onSetReviewingId={onSetReviewingId}
                      onSubmitReview={onSubmitReview}
                    />
                  ) : (
                    <div className="inline-flex gap-2">
                      <Button
                        onClick={() => { onSetReviewingId(req.id); onSetReviewForm({ role: 'viewer', note: '' }) }}
                        disabled={processingRequestId === req.id}
                        variant="success"
                        size="xs"
                      >
                        {t('review')}
                      </Button>
                      <Button
                        onClick={() => onSubmitReview(req.id, 'reject')}
                        disabled={processingRequestId === req.id}
                        variant="destructive"
                        size="xs"
                      >
                        {t('reject')}
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface InlineReviewControlsProps {
  req: AccessRequest
  reviewForm: ReviewFormState
  processingRequestId: number | null
  onSetReviewForm: (form: ReviewFormState) => void
  onSetReviewingId: (id: number | null) => void
  onSubmitReview: (requestId: number, action: 'approve' | 'reject') => Promise<void>
}

function InlineReviewControls({
  req,
  reviewForm,
  processingRequestId,
  onSetReviewForm,
  onSetReviewingId,
  onSubmitReview,
}: InlineReviewControlsProps): React.JSX.Element {
  const t = useTranslations('userManagement')

  return (
    <div className="flex items-center gap-2 justify-end">
      <select
        value={reviewForm.role}
        onChange={(e) => onSetReviewForm({ ...reviewForm, role: e.target.value as ReviewFormState['role'] })}
        className="h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground"
      >
        <option value="viewer">{t('roleViewer')}</option>
        <option value="operator">{t('roleOperator')}</option>
        <option value="admin">{t('roleAdmin')}</option>
      </select>
      <input
        value={reviewForm.note}
        onChange={(e) => onSetReviewForm({ ...reviewForm, note: e.target.value })}
        placeholder={t('noteOptional')}
        className="h-7 px-2 rounded bg-secondary border border-border text-xs text-foreground w-32"
      />
      <Button
        onClick={() => onSubmitReview(req.id, 'approve')}
        disabled={processingRequestId === req.id}
        variant="success"
        size="xs"
      >
        {processingRequestId === req.id ? '...' : t('confirm')}
      </Button>
      <Button
        onClick={() => onSubmitReview(req.id, 'reject')}
        disabled={processingRequestId === req.id}
        variant="destructive"
        size="xs"
      >
        {t('reject')}
      </Button>
      <Button
        onClick={() => { onSetReviewingId(null); onSetReviewForm({ role: 'viewer', note: '' }) }}
        variant="ghost"
        size="xs"
      >
        {t('cancel')}
      </Button>
    </div>
  )
}
