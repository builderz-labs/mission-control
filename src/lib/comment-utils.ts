/**
 * Comment tree utilities shared between API responses and UI panels.
 */

export interface CommentNode {
  replies?: CommentNode[] | null
}

/**
 * Count every comment in a threaded comment tree (top-level + all nested
 * replies, recursively). The task-card badge uses a flat SQL COUNT(*) over the
 * comments table, so the UI's comments-tab badge must count the full tree —
 * not just `comments.length` (top-level threads) — to match it (issue #664).
 */
export function countCommentsDeep(comments: CommentNode[] | null | undefined): number {
  if (!comments || comments.length === 0) return 0
  return comments.reduce((sum, c) => sum + 1 + countCommentsDeep(c.replies), 0)
}
