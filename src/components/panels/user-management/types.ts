export interface UserRecord {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
  provider?: 'local' | 'google'
  email?: string | null
  avatar_url?: string | null
  is_approved?: number
  created_at: number
  last_login_at: number | null
}

export interface AccessRequest {
  id: number
  provider: string
  email: string
  provider_user_id?: string | null
  display_name?: string | null
  avatar_url?: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_at: number
  last_attempt_at: number
  attempt_count: number
  reviewed_by?: string | null
  reviewed_at?: number | null
  review_note?: string | null
  approved_user_id?: number | null
}

export interface ReviewFormState {
  role: 'admin' | 'operator' | 'viewer'
  note: string
}

export interface CreateFormState {
  username: string
  password: string
  display_name: string
  role: 'admin' | 'operator' | 'viewer'
}

export interface EditFormState {
  display_name: string
  role: '' | 'admin' | 'operator' | 'viewer'
  password: string
}

export const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-500/20 text-red-400',
  operator: 'bg-blue-500/20 text-blue-400',
  viewer: 'bg-gray-500/20 text-gray-400',
}
