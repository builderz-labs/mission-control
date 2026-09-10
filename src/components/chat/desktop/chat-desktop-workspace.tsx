'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMissionControl } from '@/store'
import { projectSlugOf } from '@/lib/chat-session-identity'
import { conversationsToItems, gitLensByProject, toHomeSessions, withOptimisticUser } from '@/lib/chat-desktop-data'
import { buildSidebarRows, type SidebarRow } from '@/lib/group-sessions'
import { extractPlanMarkdown } from '@/lib/session-plan'
import { useNavigateToPanel } from '@/lib/navigation'
import { useChatConversations } from '../use-chat-conversations'
import { useChatDesktopPrefs } from '../use-chat-desktop-prefs'
import { useChatGithub } from '../use-chat-github'
import { useDesktopSend } from '../use-desktop-send'
import { projectFromRow, sendDesktopPrompt } from '../use-desktop-actions'
import { useFolderOrder } from '../use-folder-order'
import { usePermissionMode } from '../use-permission-mode'
import { useChatUsage } from '../use-chat-usage'
import { useLiveNow } from '../use-live-now'
import { useSessionTranscript } from '../use-session-transcript'
import { ChatComposer } from '../composer/chat-composer'
import { ChatWelcome } from '../home/chat-welcome'
import { ChatSessionPane } from '../session/chat-session-pane'
import { SessionPlanPanel } from '../session/session-plan-panel'
import { SessionArtifactPanel } from '../session/session-artifact-panel'
import { useSessionArtifact } from '../use-session-artifact'
import { ChatMobileBar } from './chat-mobile-bar'
import { ChatShell } from './chat-shell'
import { ChatSidebar } from './chat-sidebar'
import { useRailResize } from './use-rail-resize'

export function ChatDesktopWorkspace() {
  const { currentUser, projects, setActiveConversation, activeConversation, conversations, setActiveProject } = useMissionControl()
  const navigate = useNavigateToPanel()
  const { agents, reload } = useChatConversations()
  const prefs = useChatDesktopPrefs(currentUser?.id)
  const folders = useFolderOrder(currentUser?.id)
  const permission = usePermissionMode()
  const rail = useRailResize(currentUser?.id)
  const github = useChatGithub()
  const now = useLiveNow()
  const selected = conversations.find((conv) => conv.id === activeConversation)
  const transcript = useSessionTranscript(selected?.session)
  const sender = useDesktopSend(transcript.refresh)
  const usage = useChatUsage(
    selected?.session?.sessionKind || 'claude-code',
    selected?.session?.tokens,
    selected?.session?.model,
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [planOpen, setPlanOpen] = useState(true)
  const [prHidden, setPrHidden] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [pendingUser, setPendingUser] = useState<string | null>(null)
  const pulls = github.pullRequests
  const paneMessages = withOptimisticUser(transcript.messages, pendingUser)
  const { artifact, html } = useSessionArtifact(selected?.session?.sessionKind, selected?.session?.sessionId, paneMessages)

  useEffect(() => { setPrHidden(false); setPendingUser(null) }, [selected?.id])
  useEffect(() => {
    if (pendingUser && withOptimisticUser(transcript.messages, pendingUser) === transcript.messages) setPendingUser(null)
  }, [transcript.messages, pendingUser])

  const items = useMemo(() => conversationsToItems(conversations, pulls), [conversations, pulls])
  const rows = useMemo(() => buildSidebarRows(
    items,
    projects.map((p) => ({ name: p.name, slug: p.slug })),
    prefs.filters,
    prefs.pins,
    folders.folderOrder,
  ), [items, projects, prefs.filters, prefs.pins, folders.folderOrder])
  const sessionsByProject = useMemo(() => gitLensByProject(items, rows), [items, rows])
  const homeSessions = useMemo(() => toHomeSessions(items), [items])
  const selectedSlug = selectedKey?.slice((selectedKey.indexOf(':') + 1)) || ''
  const selectedProject = projects.find((p) => p.slug === selectedSlug || p.name === selectedSlug) || null
  const selectedLeaf = selected?.session?.workingDir ? projectSlugOf(selected.session.workingDir) : selectedSlug
  const pr = pulls.find((item) => selectedLeaf && item.repo.toLowerCase().includes(selectedLeaf))
  const sendOpts = {
    model: prefs.modelAlias,
    fast: prefs.fastMode,
    effort: prefs.effort,
    permissionMode: permission.mode,
  }

  const onSelectRow = (row: SidebarRow) => {
    setSelectedKey((prev) => (prev === row.key ? null : row.key))
    setActiveProject(projectFromRow(projects, row))
  }
  const onNewInGroup = (row: SidebarRow) => {
    setSelectedKey(row.key)
    setActiveConversation(null)
    setActiveProject(projectFromRow(projects, row))
  }

  const plan = extractPlanMarkdown(transcript.messages)
  return (
    <ChatShell
      sidebarWidth={rail.width}
      resizeHandle={rail.handleProps}
      sidebar={(
        <ChatSidebar
          pinned={rows.pinned}
          rest={rows.rest}
          selectedKey={selectedKey}
          filters={prefs.filters}
          onFiltersChange={prefs.setFilters}
          onSelect={onSelectRow}
          onNew={() => { setActiveConversation(null); if (selectedProject) setActiveProject(selectedProject) }}
          onNewInGroup={onNewInGroup}
          onSearch={(search) => prefs.setFilters({ ...prefs.filters, search })}
          onNavigate={(panel) => { if (selectedProject) setActiveProject(selectedProject); navigate(panel) }}
          onCustomize={() => setCustomizeOpen((open) => !open)}
          sessionsByProject={sessionsByProject}
          activeSessionId={activeConversation}
          onSelectSession={setActiveConversation}
          pins={prefs.pins}
          onTogglePin={(slug) => prefs.setPins(prefs.pins.includes(slug) ? prefs.pins.filter((pin) => pin !== slug) : [...prefs.pins, slug])}
          folderOrder={folders.folderOrder}
          onReorder={folders.setFolderOrder}
          now={now}
        />
      )}
      main={(
        <>
          <ChatMobileBar onNew={() => setActiveConversation(null)} />
          {customizeOpen && (
            <div className="border-b border-[var(--chat-border)] px-6 py-2 text-[12px] text-[var(--chat-muted)]">
              {selectedSlug ? `Project ${selectedSlug} · model ${prefs.modelAlias}` : 'Select a project to customize'}
            </div>
          )}
          {selected?.session ? (
            <ChatSessionPane
              conversation={selected}
              project={selectedLeaf}
              messages={paneMessages}
              loading={transcript.loading}
              error={transcript.error || sender.error}
              busy={sender.busy}
              pr={pr}
              prHidden={prHidden}
              onDismissPr={() => setPrHidden(true)}
              onHandoff={(id, kind) => {
                void reload()
                if (id && !id.startsWith('pending:')) {
                  setActiveConversation(id.startsWith('session:') ? id : `session:${kind || selected.session?.sessionKind}:${id}`)
                }
              }}
            />
          ) : (
            <ChatWelcome
              displayName={currentUser?.display_name || currentUser?.username || ''}
              sessions={homeSessions}
              pullRequests={pulls}
              activity={github.activity}
              onSelectSession={setActiveConversation}
              now={now}
            />
          )}
          <ChatComposer
            placeholder={selected?.session ? 'Type / for commands' : 'Ask Mission Control'}
            disabled={sender.busy}
            isSending={sender.busy}
            environment="Local"
            project={selectedLeaf}
            folder=""
            modelAlias={prefs.modelAlias}
            onModelAlias={prefs.setModelAlias}
            fastMode={prefs.fastMode}
            onFastMode={prefs.setFastMode}
            effort={prefs.effort}
            onEffort={prefs.setEffort}
            sessionKind={selected?.session?.sessionKind || 'claude-code'}
            permissionMode={permission.mode}
            onPermissionMode={permission.allowed ? permission.setMode : undefined}
            usage={usage}
            onSend={(text) => sendDesktopPrompt({
              text,
              selected,
              selectedKey,
              items,
              conversations,
              agents,
              opts: sendOpts,
              setPendingUser,
              setActiveConversation,
              sendSession: sender.sendSession,
              sendAgent: sender.sendAgent,
            })}
          />
        </>
      )}
      plan={artifact && planOpen ? (
        <SessionArtifactPanel artifact={artifact} html={html} markdown={plan} onClose={() => setPlanOpen(false)} />
      ) : selected?.session && planOpen && plan ? (
        <SessionPlanPanel title={selected.name || 'Plan'} markdown={plan} onClose={() => setPlanOpen(false)} />
      ) : undefined}
    />
  )
}
