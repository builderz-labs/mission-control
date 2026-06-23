'use client'

import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Publish to BOOM — operator UI for POST /api/boom-push.
 * Writes a guest-portal INFO TOPIC to a listing via Atlas's browser-free paster.
 *
 * BOOM-aware: the parent-topic dropdown is populated from BOOM's real taxonomy
 * (GET /api/boom-topics), and typing a listing ID shows that listing's CURRENT
 * guidebook (GET /api/boom-listing-topics) so the operator edits with eyes open
 * instead of blind-writing into a single "General info" bucket. Topics only.
 */

type Phase = 'idle' | 'sending' | 'done' | 'error'

interface Result {
  ok?: boolean
  posted?: boolean
  verified?: boolean
  skipped?: boolean
  error?: string
  note?: string
  entry_id?: string
}

interface TopicDef {
  id?: number
  topic: string
  sub_topic: string
}

interface ListingItem {
  id?: number
  topic: string
  sub_topic: string
  body: string
  audience: { guests: boolean; ai: boolean; owners: boolean }
}

const DEFAULT_TOPIC = 'General info'

export default function BoomPublishPage() {
  const [listingId, setListingId] = useState('')
  const [topic, setTopic] = useState(DEFAULT_TOPIC)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [guests, setGuests] = useState(true)
  const [ai, setAi] = useState(true)
  const [owners, setOwners] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<Result | null>(null)

  // BOOM taxonomy (parent topics) — loaded once
  const [defs, setDefs] = useState<TopicDef[]>([])
  const [defsLoading, setDefsLoading] = useState(true)
  const [defsError, setDefsError] = useState('')

  // Existing items on the entered listing
  const [existing, setExisting] = useState<ListingItem[] | null>(null)
  const [existingLoading, setExistingLoading] = useState(false)
  const [existingError, setExistingError] = useState('')

  // Load BOOM's parent-topic taxonomy once on mount
  useEffect(() => {
    let cancelled = false
    fetch('/api/boom-topics')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (data.ok && Array.isArray(data.defs)) setDefs(data.defs)
        else setDefsError(data.error || 'Could not load BOOM topics')
      })
      .catch((e) => !cancelled && setDefsError(String(e)))
      .finally(() => !cancelled && setDefsLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  // Unique parent topics, sorted
  const parentTopics = useMemo(() => {
    const set = new Set<string>()
    for (const d of defs) if (d.topic) set.add(d.topic)
    set.add(DEFAULT_TOPIC)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [defs])

  // Sub-topics already defined under the chosen parent (suggestions)
  const subTopicSuggestions = useMemo(() => {
    const set = new Set<string>()
    for (const d of defs) if (d.topic === topic && d.sub_topic) set.add(d.sub_topic)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [defs, topic])

  // Fetch existing topics for the listing (on blur / explicit load)
  async function loadExisting() {
    const id = Number(listingId)
    if (!Number.isInteger(id) || id <= 0) return
    setExistingLoading(true)
    setExistingError('')
    setExisting(null)
    try {
      const res = await fetch(`/api/boom-listing-topics?listingId=${id}`)
      const data = await res.json()
      if (data.ok && Array.isArray(data.items)) setExisting(data.items)
      else setExistingError(data.error || 'Could not load listing topics')
    } catch (e) {
      setExistingError(String(e))
    } finally {
      setExistingLoading(false)
    }
  }

  // Click an existing item → load it into the form for editing
  function editItem(it: ListingItem) {
    setTopic(it.topic || DEFAULT_TOPIC)
    setTitle(it.sub_topic || '')
    setBody(it.body || '')
    setGuests(it.audience.guests)
    setAi(it.audience.ai)
    setOwners(it.audience.owners)
    setResult(null)
    setPhase('idle')
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setPhase('sending')
    setResult(null)
    try {
      const res = await fetch('/api/boom-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId: Number(listingId),
          topic,
          title,
          body,
          audience: { guests, ai, owners },
        }),
      })
      const data: Result = await res.json().catch(() => ({}))
      setResult(data)
      setPhase(res.ok && data.posted ? 'done' : 'error')
      if (res.ok && data.posted) loadExisting() // refresh the preview
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'request failed' })
      setPhase('error')
    }
  }

  const busy = phase === 'sending'
  const label = (s: string) => <span className="text-sm text-zinc-300">{s}</span>
  const input =
    'w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-zinc-100 ' +
    'placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500'

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-xl font-semibold mb-1">Publish to BOOM</h1>
        <p className="text-sm text-zinc-400 mb-6">
          Write a guest-portal info topic to a listing. No clicking — Atlas writes it
          via BOOM&apos;s API and verifies it. Pick the real BOOM topic, see what&apos;s
          already on the listing, then add or edit. Topics only (not FAQs).
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            {label('BOOM listing ID')}
            <div className="flex gap-2">
              <input
                className={input}
                inputMode="numeric"
                placeholder="e.g. 14447"
                value={listingId}
                onChange={(e) => setListingId(e.target.value)}
                onBlur={loadExisting}
                required
              />
              <Button type="button" variant="secondary" onClick={loadExisting} disabled={!listingId || existingLoading}>
                {existingLoading ? 'Loading…' : 'View current'}
              </Button>
            </div>
          </div>

          {/* Existing topics preview */}
          {existingError && (
            <div className="rounded-md border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              {existingError}
            </div>
          )}
          {existing && (
            <div className="rounded-md border border-zinc-700 bg-zinc-900/60 p-3">
              <p className="text-xs text-zinc-400 mb-2">
                {existing.length} topic{existing.length === 1 ? '' : 's'} currently on this listing — click to edit
              </p>
              {existing.length === 0 ? (
                <p className="text-xs text-zinc-500 italic">No guidebook topics yet.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {existing.map((it, i) => (
                    <button
                      key={it.id ?? i}
                      type="button"
                      onClick={() => editItem(it)}
                      className="w-full text-left rounded px-2 py-1.5 hover:bg-zinc-800 transition-colors"
                    >
                      <span className="text-xs text-emerald-400">{it.topic || '—'}</span>
                      <span className="text-xs text-zinc-500"> › </span>
                      <span className="text-xs text-zinc-200">{it.sub_topic || '—'}</span>
                      {it.body && <span className="text-2xs text-zinc-500 block truncate">{it.body}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            {label('Topic (BOOM category)')}
            {defsLoading ? (
              <div className={input + ' text-zinc-500'}>Loading BOOM topics…</div>
            ) : defsError ? (
              <>
                <input
                  className={input}
                  placeholder="e.g. Check-in"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  required
                />
                <p className="text-2xs text-amber-400 mt-1">
                  Couldn&apos;t load BOOM topic list ({defsError}) — type the topic manually.
                </p>
              </>
            ) : (
              <select className={input} value={topic} onChange={(e) => setTopic(e.target.value)} required>
                {parentTopics.map((tp) => (
                  <option key={tp} value={tp}>
                    {tp}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            {label('Topic title (sub-topic / leaf)')}
            <input
              className={input}
              placeholder="e.g. Parking"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              list="subtopic-suggestions"
              required
            />
            {subTopicSuggestions.length > 0 && (
              <datalist id="subtopic-suggestions">
                {subTopicSuggestions.map((st) => (
                  <option key={st} value={st} />
                ))}
              </datalist>
            )}
          </div>

          <div>
            {label('Body (guest-visible text)')}
            <textarea
              className={input + ' min-h-[120px] resize-y'}
              placeholder="e.g. On-street parking is free after 6pm."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
            />
          </div>
          <div className="flex gap-5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={guests} onChange={(e) => setGuests(e.target.checked)} />
              Guests
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} />
              AI
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={owners} onChange={(e) => setOwners(e.target.checked)} />
              Owners
            </label>
          </div>

          <Button type="submit" disabled={busy}>
            {busy ? 'Publishing…' : 'Publish to BOOM'}
          </Button>
        </form>

        {result && (
          <div
            className={
              'mt-6 rounded-md border px-4 py-3 text-sm ' +
              (phase === 'done'
                ? 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
                : 'border-amber-700 bg-amber-950/40 text-amber-200')
            }
          >
            {phase === 'done' ? (
              <>
                ✅ Published{result.verified ? ' and verified' : ' (verification pending)'}
                {result.skipped ? ' — already up to date' : ''}
                {result.entry_id ? ` · item ${result.entry_id}` : ''}
              </>
            ) : (
              <>⚠️ Not published: {result.error || result.note || 'Atlas declined or is not armed'}</>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
