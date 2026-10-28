'use client'

import { useMemo } from 'react'
import { useMissionControl } from '@/store'
import { useNavigateToPanel } from '@/lib/navigation'
import { Button } from '@/components/ui/button'

export function ProjectsOverviewPanel() {
  const { projects, tasks, setActiveProject } = useMissionControl()
  const navigateToPanel = useNavigateToPanel()

  const rows = useMemo(() => projects.map((project) => {
    const projectTasks = tasks.filter((task) => task.project_id === project.id)
    const approvals = projectTasks.filter((task) =>
      ['awaiting_owner', 'review', 'quality_review'].includes(task.status)
    ).length
    const running = projectTasks.filter((task) =>
      ['assigned', 'in_progress'].includes(task.status)
    ).length
    const failed = projectTasks.filter((task) => task.status === 'failed').length

    return { project, total: projectTasks.length, approvals, running, failed }
  }), [projects, tasks])

  return (
    <div className="p-5 space-y-5">
      <section className="rounded-2xl border border-border bg-card px-5 py-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">AI Ops Hub</div>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">Projects</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Shufuro, ProductBaton과 이후 프로젝트의 작업·Agent·Workflow·Skill 연결 상태를 관리합니다.
        </p>
      </section>

      {rows.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <div className="text-base font-medium text-foreground">아직 프로젝트가 없습니다.</div>
          <p className="mt-2 text-sm text-muted-foreground">
            초기 설정 후 Shufuro와 ProductBaton을 첫 프로젝트로 등록합니다.
          </p>
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rows.map(({ project, total, approvals, running, failed }) => (
            <section key={project.id} className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: project.color || '#64748b' }}
                    />
                    <h2 className="text-lg font-semibold text-foreground">{project.name}</h2>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {project.description || project.slug}
                  </p>
                </div>
                <span className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
                  {project.ticket_prefix}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-4 gap-2">
                {[
                  ['전체', total],
                  ['승인', approvals],
                  ['실행', running],
                  ['실패', failed],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-muted/30 px-3 py-3 text-center">
                    <div className="text-lg font-semibold text-foreground">{value}</div>
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setActiveProject(project)
                    navigateToPanel('tasks')
                  }}
                >
                  작업 열기
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveProject(project)
                    navigateToPanel('marketing')
                  }}
                >
                  Marketing
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveProject(project)
                    navigateToPanel('development')
                  }}
                >
                  Development
                </Button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
