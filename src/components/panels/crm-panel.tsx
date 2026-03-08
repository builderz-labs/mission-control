'use client'

import { useCallback, useEffect, useState } from 'react'

interface CrmContact {
  id: number
  name: string
  email: string | null
  phone: string | null
  company: string | null
  type: string
  warmth: string
  notes: string | null
  created_at: string
  updated_at: string
}

interface CrmStats {
  total_contacts: number
  by_type: Record<string, number>
  by_warmth: Record<string, number>
  recent_contacts: number
}

const WARMTH_COLORS: Record<string, string> = {
  hot: 'bg-red-500/20 text-red-400 border-red-500/30',
  warm: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  cold: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

const TYPE_COLORS: Record<string, string> = {
  personal: 'bg-purple-500/20 text-purple-400',
  professional: 'bg-sky-500/20 text-sky-400',
  investor: 'bg-emerald-500/20 text-emerald-400',
  vendor: 'bg-amber-500/20 text-amber-400',
  other: 'bg-zinc-500/20 text-zinc-400',
}

export function CrmPanel() {
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<CrmStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [warmthFilter, setWarmthFilter] = useState('')
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (typeFilter) params.set('type', typeFilter)
      if (warmthFilter) params.set('warmth', warmthFilter)
      const res = await fetch(`/api/crm?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setContacts(data.contacts)
      setTotal(data.total)
      if (data.contacts.length === 0 && !search && !typeFilter && !warmthFilter) {
        setUnavailable(true)
      } else {
        setUnavailable(false)
      }
    } catch {
      setContacts([])
      setTotal(0)
      setUnavailable(true)
    } finally {
      setLoading(false)
    }
  }, [search, typeFilter, warmthFilter])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/crm/stats')
      if (!res.ok) return
      setStats(await res.json())
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchContacts()
    fetchStats()
  }, [fetchContacts, fetchStats])

  const openContact = async (contact: CrmContact) => {
    setSelectedContact(contact)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/crm/contacts/${contact.id}`)
      if (res.ok) {
        const data = await res.json()
        setSelectedContact(data.contact)
        setSelectedTags(data.tags)
      }
    } catch {
      // use what we have
      setSelectedTags([])
    } finally {
      setDetailLoading(false)
    }
  }

  if (unavailable && !loading && contacts.length === 0) {
    return (
      <div className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Contacts</h2>
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-muted mx-auto mb-3 flex items-center justify-center">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-muted-foreground">
              <circle cx="8" cy="5" r="3" />
              <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">
            CRM database not found. Configure your CRM at ~/.openclaw/shared/crm.db
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Contacts</h2>

      {/* Stats summary */}
      {stats && stats.total_contacts > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total" value={stats.total_contacts} />
          <StatCard label="Hot" value={stats.by_warmth?.hot || 0} color="text-red-400" />
          <StatCard label="Warm" value={stats.by_warmth?.warm || 0} color="text-orange-400" />
          <StatCard label="Cold" value={stats.by_warmth?.cold || 0} color="text-blue-400" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All types</option>
          <option value="personal">Personal</option>
          <option value="professional">Professional</option>
          <option value="investor">Investor</option>
          <option value="vendor">Vendor</option>
          <option value="other">Other</option>
        </select>
        <select
          value={warmthFilter}
          onChange={(e) => setWarmthFilter(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All warmth</option>
          <option value="hot">Hot</option>
          <option value="warm">Warm</option>
          <option value="cold">Cold</option>
        </select>
      </div>

      {/* Contact list */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-sm text-muted-foreground">Loading contacts...</div>
        ) : contacts.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No contacts found</div>
        ) : (
          <div className="divide-y divide-border">
            {contacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => openContact(contact)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-secondary/50 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {contact.name?.charAt(0)?.toUpperCase() || '?'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{contact.name}</div>
                  {contact.company && (
                    <div className="text-xs text-muted-foreground truncate">{contact.company}</div>
                  )}
                </div>
                <span className={`text-2xs px-1.5 py-0.5 rounded-full ${TYPE_COLORS[contact.type] || TYPE_COLORS.other}`}>
                  {contact.type}
                </span>
                <span className={`text-2xs px-1.5 py-0.5 rounded-full border ${WARMTH_COLORS[contact.warmth] || WARMTH_COLORS.cold}`}>
                  {contact.warmth}
                </span>
              </button>
            ))}
          </div>
        )}
        {total > contacts.length && (
          <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
            Showing {contacts.length} of {total} contacts
          </div>
        )}
      </div>

      {/* Contact detail modal */}
      {selectedContact && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setSelectedContact(null)} />
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-card border-l border-border shadow-xl overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-foreground">{selectedContact.name}</h3>
                <button
                  onClick={() => setSelectedContact(null)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="w-4 h-4">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>

              {detailLoading ? (
                <div className="text-sm text-muted-foreground">Loading...</div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_COLORS[selectedContact.type] || TYPE_COLORS.other}`}>
                      {selectedContact.type}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${WARMTH_COLORS[selectedContact.warmth] || WARMTH_COLORS.cold}`}>
                      {selectedContact.warmth}
                    </span>
                  </div>

                  <div className="space-y-3 text-sm">
                    {selectedContact.email && (
                      <DetailRow label="Email" value={selectedContact.email} />
                    )}
                    {selectedContact.phone && (
                      <DetailRow label="Phone" value={selectedContact.phone} />
                    )}
                    {selectedContact.company && (
                      <DetailRow label="Company" value={selectedContact.company} />
                    )}
                  </div>

                  {selectedTags.length > 0 && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">Tags</div>
                      <div className="flex flex-wrap gap-1.5">
                        {selectedTags.map((tag) => (
                          <span key={tag} className="text-2xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedContact.notes && (
                    <div>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">Notes</div>
                      <div className="text-sm text-foreground whitespace-pre-wrap bg-muted/50 rounded-lg p-3">
                        {selectedContact.notes}
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground pt-2 border-t border-border space-y-1">
                    <div>Created: {new Date(selectedContact.created_at).toLocaleString()}</div>
                    <div>Updated: {new Date(selectedContact.updated_at).toLocaleString()}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className={`text-xl font-bold ${color || 'text-foreground'}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-foreground">{value}</div>
    </div>
  )
}
