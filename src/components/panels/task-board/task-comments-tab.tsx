'use client'

import { Button } from '@/components/ui/button'
import type { Comment } from './task-board-types'
import { MentionTextarea, useMentionTargets } from './mention-textarea'
import { parseCommentContent } from './task-board-utils'

// ─── CommentsTab ──────────────────────────────────────────────────────────────

export interface CommentsTabProps {
  comments: Comment[]
  loadingComments: boolean
  commentText: string
  commentError: string | null
  broadcastMessage: string
  broadcastStatus: string | null
  commentAuthor: string
  mentionTargets: ReturnType<typeof useMentionTargets>
  onCommentTextChange: (v: string) => void
  onBroadcastMessageChange: (v: string) => void
  onAddComment: (e: React.FormEvent) => void
  onBroadcast: (e: React.FormEvent) => void
  onRefresh: () => void
}

export function CommentsTab({
  comments,
  loadingComments,
  commentText,
  commentError,
  broadcastMessage,
  broadcastStatus,
  commentAuthor,
  mentionTargets,
  onCommentTextChange,
  onBroadcastMessageChange,
  onAddComment,
  onBroadcast,
  onRefresh,
}: CommentsTabProps) {
  return (
    <div id="tabpanel-comments" role="tabpanel" aria-label="Comments" className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-lg font-semibold text-foreground">Comments</h4>
        <Button variant="link" size="xs" onClick={onRefresh} className="text-blue-400 hover:text-blue-300">
          Refresh
        </Button>
      </div>

      {commentError && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2 rounded-md text-sm mb-3">
          {commentError}
        </div>
      )}

      {loadingComments ? (
        <div className="text-muted-foreground text-sm">Loading comments...</div>
      ) : comments.length === 0 ? (
        <div className="text-muted-foreground/50 text-sm">No comments yet.</div>
      ) : (
        <div className="space-y-4">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} depth={0} />
          ))}
        </div>
      )}

      <form onSubmit={onAddComment} className="mt-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Posting as</span>
          <span className="font-medium text-foreground">{commentAuthor}</span>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">New Comment</label>
          <MentionTextarea
            value={commentText}
            onChange={onCommentTextChange}
            className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            rows={3}
            mentionTargets={mentionTargets}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Use <span className="font-mono">@</span> to mention users and agents.
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="submit">Add Comment</Button>
        </div>
      </form>

      <NotificationsInfo />
      <BroadcastForm
        broadcastMessage={broadcastMessage}
        broadcastStatus={broadcastStatus}
        mentionTargets={mentionTargets}
        onBroadcastMessageChange={onBroadcastMessageChange}
        onBroadcast={onBroadcast}
      />
    </div>
  )
}

function NotificationsInfo() {
  return (
    <div className="mt-5 bg-blue-500/5 border border-blue-500/15 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
      <div className="font-medium text-blue-300">How notifications work</div>
      <div>
        <strong className="text-foreground">Comments</strong> are persisted on the task and notify
        all subscribers. Subscribers are auto-added when they: create the task, are assigned to it,
        comment on it, or are @mentioned.
      </div>
      <div>
        <strong className="text-foreground">Broadcasts</strong> send a one-time notification to all
        current subscribers without creating a comment record.
      </div>
    </div>
  )
}

function BroadcastForm({
  broadcastMessage,
  broadcastStatus,
  mentionTargets,
  onBroadcastMessageChange,
  onBroadcast,
}: {
  broadcastMessage: string
  broadcastStatus: string | null
  mentionTargets: ReturnType<typeof useMentionTargets>
  onBroadcastMessageChange: (v: string) => void
  onBroadcast: (e: React.FormEvent) => void
}) {
  return (
    <div className="mt-6 border-t border-border pt-4">
      <h5 className="text-sm font-medium text-foreground mb-2">Broadcast to Subscribers</h5>
      {broadcastStatus && (
        <div className="text-xs text-muted-foreground mb-2">{broadcastStatus}</div>
      )}
      <form onSubmit={onBroadcast} className="space-y-2">
        <MentionTextarea
          value={broadcastMessage}
          onChange={onBroadcastMessageChange}
          className="w-full bg-surface-1 text-foreground border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
          rows={2}
          placeholder="Send a message to all task subscribers... (use @ to mention)"
          mentionTargets={mentionTargets}
        />
        <div className="flex justify-end">
          <Button
            type="submit"
            size="sm"
            className="bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30"
          >
            Broadcast
          </Button>
        </div>
      </form>
    </div>
  )
}

function CommentItem({ comment, depth }: { comment: Comment; depth: number }) {
  const { text, meta } = parseCommentContent(comment.content)
  return (
    <div className={`border-l-2 border-border pl-3 ${depth > 0 ? 'ml-4' : ''}`}>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground/80">{comment.author}</span>
          {meta && (
            <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] text-muted-foreground">
              {meta.model}
              {meta.tokens ? ` · ${meta.tokens.toLocaleString()} tok` : ''}
              {meta.durationMs ? ` · ${(meta.durationMs / 1000).toFixed(1)}s` : ''}
            </span>
          )}
        </div>
        <span>{new Date(comment.created_at * 1000).toLocaleString()}</span>
      </div>
      <div className="text-sm text-foreground/90 mt-1 whitespace-pre-wrap">{text}</div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map((reply) => (
            <CommentItem key={reply.id} comment={reply} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}
