export const STAGES = [
  { id: 'spec', label: 'Spec' },
  { id: 'test', label: 'Test' },
  { id: 'build', label: 'Build' },
  { id: 'validate', label: 'Validate' },
  { id: 'pr-review', label: 'PR review' },
  { id: 'done', label: 'Done' }
] as const

export type StageId = (typeof STAGES)[number]['id']

export interface Project {
  id: string
  name: string
  /** The folder where agents work on this project. */
  path?: string
  createdAt: string
}

export interface StageChange {
  stage: StageId
  at: string
}

export interface WorkItem {
  id: string
  projectId: string
  title: string
  description: string
  stage: StageId
  history: StageChange[]
  createdAt: string
}

export interface Workspace {
  version: 1
  projects: Project[]
  workItems: WorkItem[]
}

export type Action =
  | { type: 'project-added'; id: string; name: string; path?: string; at: string }
  | { type: 'project-folder-set'; id: string; path: string }
  | { type: 'project-deleted'; id: string }
  | {
      type: 'item-added'
      id: string
      projectId: string
      title: string
      description: string
      at: string
    }
  | { type: 'item-moved'; id: string; stage: StageId; at: string }
  | { type: 'item-deleted'; id: string }

export const emptyWorkspace: Workspace = { version: 1, projects: [], workItems: [] }

export function reduce(state: Workspace, action: Action): Workspace {
  switch (action.type) {
    case 'project-added':
      return {
        ...state,
        projects: [
          ...state.projects,
          {
            id: action.id,
            name: action.name,
            ...(action.path ? { path: action.path } : {}),
            createdAt: action.at
          }
        ]
      }
    case 'project-folder-set':
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.id === action.id ? { ...project, path: action.path } : project
        )
      }
    case 'project-deleted':
      return {
        ...state,
        projects: state.projects.filter((project) => project.id !== action.id),
        workItems: state.workItems.filter((item) => item.projectId !== action.id)
      }
    case 'item-added': {
      if (!state.projects.some((project) => project.id === action.projectId)) return state
      const item: WorkItem = {
        id: action.id,
        projectId: action.projectId,
        title: action.title,
        description: action.description,
        stage: 'spec',
        history: [{ stage: 'spec', at: action.at }],
        createdAt: action.at
      }
      return { ...state, workItems: [...state.workItems, item] }
    }
    case 'item-moved':
      return {
        ...state,
        workItems: state.workItems.map((item) =>
          item.id !== action.id || item.stage === action.stage
            ? item
            : {
                ...item,
                stage: action.stage,
                history: [...item.history, { stage: action.stage, at: action.at }]
              }
        )
      }
    case 'item-deleted':
      return { ...state, workItems: state.workItems.filter((item) => item.id !== action.id) }
  }
}

/** The first line is the title. The other lines are the description. */
export function parseRequest(text: string): { title: string; description: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const [first = '', ...rest] = trimmed.split(/\r?\n/)
  return { title: first.trim(), description: rest.join('\n').trim() }
}

export function isWorkspace(value: unknown): value is Workspace {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Workspace>
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.projects) &&
    Array.isArray(candidate.workItems)
  )
}
