/**
 * Linear GraphQL API client for Mission Control.
 */

export interface LinearTeam {
  id: string
  name: string
  key: string
}

export interface LinearUser {
  id: string
  name: string
  email: string
  displayName?: string
}

export interface LinearWorkflowState {
  id: string
  name: string
  type: string
  color: string
}

export interface LinearLabel {
  id: string
  name: string
  color: string
}

export interface LinearIssue {
  id: string
  identifier: string
  title: string
  description: string | null
  state: LinearWorkflowState
  priority: number
  assignee: LinearUser | null
  labels: { nodes: LinearLabel[] }
  team: LinearTeam
  createdAt: string
  updatedAt: string
  url: string
}

export function getLinearApiKey(): string | null {
  return process.env.LINEAR_API_KEY || null
}

export async function linearFetch<T = any>(
  query: string,
  variables: Record<string, any> = {}
): Promise<T> {
  const apiKey = getLinearApiKey()
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY not configured')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'MissionControl/1.0',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })

    const data = await res.json()

    if (data.errors) {
      throw new Error(`Linear API error: ${data.errors.map((e: any) => e.message).join(', ')}`)
    }

    return data.data
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchTeams(): Promise<LinearTeam[]> {
  const data = await linearFetch<{ teams: { nodes: LinearTeam[] } }>(`
    query Teams {
      teams {
        nodes {
          id
          name
          key
        }
      }
    }
  `)
  return data.teams.nodes
}

export async function fetchTeam(teamId: string): Promise<LinearTeam | null> {
  const data = await linearFetch<{ team: LinearTeam | null }>(`
    query Team($id: String!) {
      team(id: $id) {
        id
        name
        key
      }
    }
  `, { id: teamId })
  return data.team
}

export async function fetchWorkflowStates(teamId: string): Promise<LinearWorkflowState[]> {
  const data = await linearFetch<{ team: { workflowStates: { nodes: LinearWorkflowState[] } } }>(`
    query WorkflowStates($teamId: String!) {
      team(id: $teamId) {
        workflowStates {
          nodes {
            id
            name
            type
            color
          }
        }
      }
    }
  `, { teamId })
  return data.team?.workflowStates.nodes || []
}

export async function fetchIssues(
  teamId: string,
  options?: {
    filter?: any
    first?: number
    after?: string
    orderBy?: string
  }
): Promise<{ issues: LinearIssue[]; hasNextPage: boolean; endCursor?: string }> {
  const filter = options?.filter || {}
  const first = options?.first || 50
  const after = options?.after ? `"${options.after}"` : 'null'
  const orderBy = options?.orderBy || 'updatedAt'

  const data = await linearFetch<{
    team: {
      issues: {
        nodes: LinearIssue[]
        pageInfo: { hasNextPage: boolean; endCursor?: string }
      }
    } | null
  }>(`
    query Issues($teamId: String!, $filter: IssueFilter, $first: Int!, $after: String, $orderBy: PaginationOrderBy) {
      team(id: $teamId) {
        issues(filter: $filter, first: $first, after: $after, orderBy: $orderBy) {
          nodes {
            id
            identifier
            title
            description
            state { id name type color }
            priority
            assignee { id name email displayName }
            labels { nodes { id name color } }
            team { id name key }
            createdAt
            updatedAt
            url
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `, { teamId, filter, first, after, orderBy })

  if (!data.team) {
    return { issues: [], hasNextPage: false }
  }

  return {
    issues: data.team.issues.nodes,
    hasNextPage: data.team.issues.pageInfo.hasNextPage,
    endCursor: data.team.issues.pageInfo.endCursor,
  }
}

export async function fetchIssue(issueId: string): Promise<LinearIssue | null> {
  const data = await linearFetch<{ issue: LinearIssue | null }>(`
    query Issue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        state { id name type color }
        priority
        assignee { id name email displayName }
        labels { nodes { id name color } }
        team { id name key }
        createdAt
        updatedAt
        url
      }
    }
  `, { id: issueId })
  return data.issue
}

export async function createIssue(
  teamId: string,
  input: {
    title: string
    description?: string
    priority?: number
    assigneeId?: string
    labelIds?: string[]
    stateId?: string
  }
): Promise<LinearIssue> {
  const data = await linearFetch<{
    issueCreate: {
      success: boolean
      issue: LinearIssue
    }
  }>(`
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          description
          state { id name type color }
          priority
          assignee { id name email displayName }
          labels { nodes { id name color } }
          team { id name key }
          createdAt
          updatedAt
          url
        }
      }
    }
  `, { input: { teamId, ...input } })

  if (!data.issueCreate.success) {
    throw new Error('Failed to create Linear issue')
  }

  return data.issueCreate.issue
}

export async function updateIssue(
  issueId: string,
  input: {
    title?: string
    description?: string
    priority?: number
    assigneeId?: string
    labelIds?: string[]
    stateId?: string
  }
): Promise<LinearIssue> {
  const data = await linearFetch<{
    issueUpdate: {
      success: boolean
      issue: LinearIssue
    }
  }>(`
    mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) {
        success
        issue {
          id
          identifier
          title
          description
          state { id name type color }
          priority
          assignee { id name email displayName }
          labels { nodes { id name color } }
          team { id name key }
          createdAt
          updatedAt
          url
        }
      }
    }
  `, { id: issueId, input })

  if (!data.issueUpdate.success) {
    throw new Error('Failed to update Linear issue')
  }

  return data.issueUpdate.issue
}

export async function createComment(issueId: string, body: string): Promise<void> {
  await linearFetch(`
    mutation CommentCreate($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
      }
    }
  `, { input: { issueId, body } })
}
