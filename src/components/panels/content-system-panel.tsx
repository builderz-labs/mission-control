'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch } from '@/lib/api-client'

// ATHENA Content System — per-brand visualization.
// Reads /api/content (the ATHENA-git JSON mirror) and shows every brand's
// identity, visual system, voice, audience, pillars/mix, sources, channels and
// all the on/off toggles, with plain-English explanations.

type Row = Record<string, unknown>
interface ContentResp {
  ok: boolean
  error?: string
  mirrorDir?: string
  syncedAt?: string | null
  brands: Row[]
  channels: Row[]
  pipeline?: unknown
  automations: Row[]
  queue: Row[]
}

const s = (v: unknown): string => (v === null || v === undefined ? '' : Array.isArray(v) ? v.map(String).join(', ') : String(v))
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? String(v).split(',').map(x => x.trim()).filter(Boolean) : [])

function parseColors(raw: string): { hex: string; label: string }[] {
  const out: { hex: string; label: string }[] = []
  const re = /#([0-9a-fA-F]{3,8})\s*([^;,#]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) out.push({ hex: `#${m[1]}`, label: (m[2] || '').trim() })
  return out
}

function modeTone(v: string): string {
  const x = v.toLowerCase()
  if (x === 'live') return 'bg-green-500/15 text-green-400 border-green-500/30'
  if (x.includes('dry')) return 'bg-blue-500/15 text-blue-400 border-blue-500/30'
  if (x.includes('review')) return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
  if (x === 'off' || x === 'paused' || x === 'parked') return 'bg-muted-foreground/10 text-muted-foreground border-border'
  if (x.includes('block') || x.includes('broken')) return 'bg-red-500/15 text-red-400 border-red-500/30'
  return 'bg-secondary text-foreground border-border'
}

function Chip({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium ${modeTone(value)}`}>
      <span className="opacity-60">{label}</span>
      <span>{value}</span>
    </span>
  )
}

function Swatches({ raw, max = 8 }: { raw: string; max?: number }) {
  const colors = parseColors(raw)
  if (colors.length === 0) return <span className="text-xs text-muted-foreground/50">no colors set</span>
  return (
    <div className="flex flex-wrap gap-2">
      {colors.slice(0, max).map((c, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 pl-1 pr-2 py-1">
          <span className="w-5 h-5 rounded shrink-0 border border-black/20" style={{ backgroundColor: c.hex }} />
          <span className="text-[11px] font-mono text-foreground">{c.hex}</span>
          {c.label && <span className="text-[11px] text-muted-foreground">{c.label}</span>}
        </div>
      ))}
    </div>
  )
}

function Field({ label, value }: { label: string; value: unknown }) {
  const v = s(value)
  if (!v) return null
  return (
    <div className="py-1.5 border-b border-border/40 last:border-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</div>
      <div className="text-sm text-foreground whitespace-pre-wrap break-words">{v}</div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground mb-2">{hint}</div>
      {children}
    </div>
  )
}

const PLATFORM_EMOJI: Record<string, string> = { Instagram: '📸', TikTok: '🎵', Substack: '📰', Threads: '🧵', X: '✖️', LinkedIn: '💼', Facebook: '👍', Bluesky: '🦋', YouTube: '▶️', Pinterest: '📌', Email: '✉️' }

export function ContentSystemPanel() {
  const [data, setData] = useState<ContentResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'live' | 'needs-review'>('all')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<ContentResp>('/api/content')
      .then(d => { setData(d); if (d.brands?.length && !selected) setSelected(s(d.brands[0].Name)) })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Failed to load content system'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const brands = data?.brands ?? []
  const channels = data?.channels ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return brands.filter(b => {
      if (q && !s(b.Name).toLowerCase().includes(q) && !s(b['Plain Description']).toLowerCase().includes(q)) return false
      if (filter === 'enabled' && s(b['ATHENA Enabled']).toLowerCase() !== 'true') return false
      if (filter === 'live' && s(b['Content Engine Mode']) !== 'Live') return false
      if (filter === 'needs-review' && s(b['Lifecycle Status']) !== 'Needs Review') return false
      return true
    })
  }, [brands, query, filter])

  const sel = useMemo(() => brands.find(b => s(b.Name) === selected) || null, [brands, selected])
  const selChannels = useMemo(() => channels.filter(c => s(c.Brand) === s(sel?.Name)), [channels, sel])

  const stats = useMemo(() => ({
    total: brands.length,
    enabled: brands.filter(b => s(b['ATHENA Enabled']).toLowerCase() === 'true').length,
    live: brands.filter(b => s(b['Content Engine Mode']) === 'Live').length,
    liveChannels: channels.filter(c => s(c['Channel Status']) === 'Live').length,
  }), [brands, channels])

  if (loading) return <div className="p-8 text-sm text-muted-foreground">Loading ATHENA content system…</div>
  if (err) return <div className="p-8 text-sm text-red-400">Could not load content system: {err}</div>
  if (data && !data.ok) return (
    <div className="p-8 text-sm text-muted-foreground">
      <p className="text-foreground font-medium mb-1">Content mirror not found.</p>
      <p>{data.error}</p>
      <p className="mt-2 text-xs">Run <code className="bg-secondary px-1 rounded">node content-system/sync.mjs</code> in the ATHENA-git repo, or set <code className="bg-secondary px-1 rounded">ATHENA_GIT_PATH</code>.</p>
    </div>
  )

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-foreground">🎛️ Content System — Brands</h1>
          <p className="text-xs text-muted-foreground">Every brand&apos;s full profile, visual system, voice, sources and toggles. Source of truth: Notion (ATHENA). {data?.syncedAt ? `Synced ${new Date(data.syncedAt).toLocaleString()}` : ''}</p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">Brands <b className="text-foreground">{stats.total}</b></span>
          <span className="text-muted-foreground">Enabled <b className="text-green-400">{stats.enabled}</b></span>
          <span className="text-muted-foreground">Engine Live <b className="text-green-400">{stats.live}</b></span>
          <span className="text-muted-foreground">Live channels <b className="text-green-400">{stats.liveChannels}</b></span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search brands…"
          className="h-8 px-3 rounded-md bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 w-56" />
        {(['all', 'enabled', 'live', 'needs-review'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`h-8 px-3 rounded-md border text-xs ${filter === f ? 'bg-primary/15 text-primary border-primary/30' : 'border-border text-muted-foreground hover:text-foreground'}`}>{f}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Brand list */}
        <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
          {filtered.map(b => {
            const name = s(b.Name)
            const colors = parseColors(s(b['Hex Colors'])).slice(0, 5)
            const isSel = name === selected
            return (
              <button key={name} onClick={() => setSelected(name)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${isSel ? 'border-primary/50 bg-primary/5' : 'border-border bg-card hover:border-border/80 hover:bg-secondary/30'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{name}</span>
                  <span className="flex gap-0.5 shrink-0">{colors.map((c, i) => <span key={i} className="w-3 h-3 rounded-sm border border-black/20" style={{ backgroundColor: c.hex }} />)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Chip label="" value={s(b['Content Engine Mode']) || 'Off'} />
                  {s(b['ATHENA Enabled']).toLowerCase() === 'true' && <Chip label="" value="Enabled" />}
                  <span className="text-[10px] text-muted-foreground">{arr(b['Channels']).length} ch</span>
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && <div className="text-xs text-muted-foreground p-3">No brands match.</div>}
        </div>

        {/* Brand detail */}
        {sel ? (
          <div className="space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="text-xl font-semibold text-foreground">{s(sel.Name)}</div>
                  <div className="text-sm text-muted-foreground">{s(sel['Plain Description'])}</div>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  <Chip label="engine" value={s(sel['Content Engine Mode']) || 'Off'} />
                  <Chip label="images" value={s(sel['Image Autopilot Status']) || 'Off'} />
                  <Chip label="enabled" value={s(sel['ATHENA Enabled']).toLowerCase() === 'true' ? 'Yes' : 'No'} />
                  <Chip label="" value={s(sel['Lifecycle Status'])} />
                  <Chip label="" value={s(sel['Priority Batch'])} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <Section title="🎨 Visual identity" hint="Colors, fonts and look. The renderer uses these so every post stays on-brand.">
                <div className="mb-2"><Swatches raw={s(sel['Hex Colors'])} /></div>
                <Field label="Fonts" value={sel['Fonts']} />
                <Field label="Visual style" value={sel['Visual Style']} />
                <Field label="Default image size" value={sel['Default Image Size']} />
                <Field label="Logo policy" value={sel['Logo Policy']} />
              </Section>

              <Section title="🖼️ How images are made" hint="Render (HTML templates) or AI (Kie / PoYo). Set per brand and per content type.">
                <div className="flex gap-1.5 flex-wrap mb-2">
                  <Chip label="mode" value={s(sel['Image Mode'])} />
                  <Chip label="provider" value={s(sel['Image Provider'])} />
                  <Chip label="model" value={s(sel['Image Model'])} />
                </div>
                <Field label="Image style rules" value={sel['Image Style Rules']} />
                <Field label="Carousel layout rules" value={sel['Carousel Layout Rules']} />
              </Section>

              <Section title="🗣️ Voice & writing" hint="How this brand talks. The writer follows this exactly, including words to avoid.">
                <Field label="Brand voice" value={sel['Brand Voice']} />
                <Field label="Tone words" value={sel['Tone Words']} />
                <Field label="Reading level" value={sel['Reading Level']} />
                <Field label="Hook style" value={sel['Hook Style']} />
                <Field label="CTA style" value={sel['CTA Style']} />
                <Field label="Banned words" value={sel['Banned Words']} />
              </Section>

              <Section title="👥 Audience" hint="Who this brand serves and what they care about.">
                <Field label="Target audience" value={sel['Target Audience']} />
                <Field label="Audience pain points" value={sel['Audience Pain Points']} />
                <Field label="Brand promise" value={sel['Brand Promise']} />
              </Section>

              <Section title="🧱 Content pillars & mix" hint="The recurring themes and the blend of formats this brand posts.">
                <Field label="Content pillars" value={sel['Content Pillars']} />
                <Field label="Content mix" value={sel['Content Mix']} />
                <Field label="SEO keywords" value={sel['SEO Keywords']} />
              </Section>

              <Section title="🔎 Sources — how it finds content & ideas" hint="Where this brand pulls ideas from, freshness rules, and what it must never use.">
                <Field label="Approved source types" value={sel['Approved Source Types']} />
                <Field label="Source discovery rules" value={sel['Source Discovery Rules']} />
                <Field label="Freshness rules" value={sel['Freshness Rules']} />
                <Field label="Banned sources" value={sel['Banned Sources']} />
                <Field label="Online research allowed" value={sel['Online Research Allowed']} />
                <Field label="Real image sources" value={sel['Real Image Sources']} />
                <Field label="Evidence rules" value={sel['Evidence Rules']} />
              </Section>
            </div>

            <Section title="📡 Channels" hint="Each platform this brand posts to, its connection status, and how it routes out.">
              {selChannels.length === 0 ? <div className="text-xs text-muted-foreground">No channel rows yet. Brand-level channels: {arr(sel['Channels']).join(', ') || 'none'}.</div> : (
                <div className="space-y-1.5">
                  {selChannels.map((c, i) => (
                    <div key={i} className="flex items-center gap-2 flex-wrap rounded-md border border-border/60 bg-secondary/30 px-2.5 py-1.5">
                      <span className="text-sm w-28 shrink-0">{PLATFORM_EMOJI[s(c.Platform)] || '•'} {s(c.Platform)}</span>
                      <Chip label="" value={s(c['Channel Status'])} />
                      {s(c['Handle URL']) && <a href={s(c['Handle URL'])} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate">{s(c['Handle URL'])}</a>}
                      {s(c['Device Route']) && <span className="text-[10px] text-muted-foreground">via {s(c['Device Route'])}</span>}
                      {s(c['Cadence']) && <span className="text-[10px] text-muted-foreground">· {s(c['Cadence'])}</span>}
                      {s(c['Bundle Team ID']) && /^[0-9a-f-]{20,}$/.test(s(c['Bundle Team ID'])) && <span className="text-[10px] text-muted-foreground font-mono">bundle ✓</span>}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="🎚️ Toggles & approval gates" hint="Master switches and review state. Nothing posts on its own until you approve it.">
              <div className="flex gap-1.5 flex-wrap">
                <Chip label="ATHENA Enabled" value={s(sel['ATHENA Enabled']).toLowerCase() === 'true' ? 'Yes' : 'No'} />
                <Chip label="Engine" value={s(sel['Content Engine Mode']) || 'Off'} />
                <Chip label="Images" value={s(sel['Image Autopilot Status']) || 'Off'} />
                <Chip label="Liz Approved" value={s(sel['Liz Approved']).toLowerCase() === 'true' ? 'Yes' : 'No'} />
                <Chip label="Brand kit" value={s(sel['Brand Kit Approval'])} />
                <Chip label="Color" value={s(sel['Color Approval'])} />
                <Chip label="Font" value={s(sel['Font Approval'])} />
                <Chip label="Logo" value={s(sel['Logo Approval'])} />
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">Toggle editing writes back to Notion (coming with the write-back wire-up).</div>
            </Section>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {s(sel['_url']) && <a href={s(sel['_url'])} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open in Notion ↗</a>}
              {s(sel['Legacy CLEO URL']) && <a href={s(sel['Legacy CLEO URL'])} target="_blank" rel="noreferrer" className="hover:underline">Legacy CLEO record ↗</a>}
              {s(sel['Primary Website']) && <a href={s(sel['Primary Website'])} target="_blank" rel="noreferrer" className="hover:underline">{s(sel['Primary Website'])}</a>}
            </div>
          </div>
        ) : <div className="text-sm text-muted-foreground p-4">Select a brand.</div>}
      </div>
    </div>
  )
}
