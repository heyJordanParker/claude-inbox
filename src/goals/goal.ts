import { isWithAgent, personOf, statusOf, type PersonFiles, type Summary } from '../items/item.js'

export type Source = 'prompt' | 'answer' | 'view'

export type Quote = { readonly words: string; readonly source: Source; readonly id: string; readonly at: string }

export type Requirement = { readonly id: string; readonly capability: string; readonly line: string; readonly quotes: readonly Quote[] }

export type Filing = { readonly id: string; readonly source: Source; readonly requirements: readonly string[] } | { readonly id: string; readonly source: Source; readonly reason: string }

type TaskFields = {
  readonly id: string
  readonly title: string
  readonly serves: readonly string[]
  readonly after?: string
  readonly waitsOn?: string
  readonly cmodTask?: string
  readonly corrections: readonly Quote[]
} & ({ readonly template?: string; readonly isRequired: false } | { readonly template: string; readonly isRequired: true })

export type Task = TaskFields &
  (
    | { readonly state: 'planned' }
    | { readonly state: 'active'; readonly owner: string; readonly startedAt: string }
    | { readonly state: 'done'; readonly owner: string; readonly startedAt: string; readonly evidence: readonly string[]; readonly endedAt: string }
    | { readonly state: 'dropped'; readonly owner?: string; readonly startedAt?: string; readonly reason: string; readonly endedAt: string }
  )

export type TaskState = Task['state']

export type Goals = {
  readonly format: 1
  readonly session: string
  readonly project: string
  readonly requirements: readonly Requirement[]
  readonly filings: readonly Filing[]
  readonly tasks: readonly Task[]
  readonly updatedAt: string
}

export type Unfiled = { readonly id: string; readonly source: Source; readonly text: string; readonly at: string }

export type ShownState = TaskState | 'waiting on you' | 'waiting after'

export type Counts = { readonly met: number; readonly requirements: number; readonly done: number; readonly tasks: number; readonly waitingOnYou: number }

export function emptyGoals(session: string, project: string): Goals {
  return { format: 1, session, project, requirements: [], filings: [], tasks: [], updatedAt: new Date().toISOString() }
}

export function isClosed(task: Task): task is Extract<Task, { readonly state: 'done' | 'dropped' }> {
  return task.state === 'done' || task.state === 'dropped'
}

export function waitingOn<Each extends Summary>(task: Task, items: readonly Each[], person: PersonFiles): Each | undefined {
  if (isClosed(task)) return undefined
  const item = items.find((each) => each.id === task.waitsOn)
  return item !== undefined && statusOf(item, personOf(person, item)) === 'open' && !isWithAgent(item, personOf(person, item)) ? item : undefined
}

export function shownState(task: Task, goals: Goals, items: readonly Summary[], person: PersonFiles): ShownState {
  if (isClosed(task)) return task.state
  if (waitingOn(task, items, person) !== undefined) return 'waiting on you'
  const before = task.after === undefined ? undefined : goals.tasks.find((each) => each.id === task.after)
  if (before !== undefined && !isClosed(before)) return 'waiting after'
  return task.state
}

export function isMet(requirement: Requirement, goals: Goals): boolean {
  const serving = goals.tasks.filter((task) => task.serves.includes(requirement.id) && task.state !== 'dropped')
  return serving.length > 0 && serving.every((task) => task.state === 'done')
}

export function counts(goals: Goals, items: readonly Summary[], person: PersonFiles): Counts {
  const tasks = goals.tasks.filter((task) => task.state !== 'dropped')
  return {
    met: goals.requirements.filter((requirement) => isMet(requirement, goals)).length,
    requirements: goals.requirements.length,
    done: tasks.filter((task) => task.state === 'done').length,
    tasks: tasks.length,
    waitingOnYou: tasks.filter((task) => shownState(task, goals, items, person) === 'waiting on you').length,
  }
}

export function nextId(prefix: 'r' | 't', taken: readonly { readonly id: string }[]): string {
  return `${prefix}${Math.max(0, ...taken.map(({ id }) => Number(id.slice(1)) || 0)) + 1}`
}
