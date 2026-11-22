import type { InterfaceMethods, Provided } from '../../node_modules/@cmodjs/core/mod.js'
import type { Connection } from '../../node_modules/@cmodjs/core/rpc.js'
import type { Goals } from '../../src/goals/goal.js'
import { readProgress, type Progress } from '../../src/goals/progress.js'
import { readGoals } from '../../src/goals/store.js'
import type { Stamps, Store } from '../../src/items/store.js'

export type Change = { readonly session: string; readonly part: 'goals' | 'progress' | 'goal' }

export type Provide = (methods: InterfaceMethods<'inbox/Goals'>) => Promise<Provided<'inbox/Goals'>>

type SessionChange = { readonly session: string; readonly part: string }

export function relayGoalChanges(connection: Pick<Connection, 'listen'>, provided: Provided<'inbox/Goals'>): Provided<'inbox/Goals'> {
  const heard = connection.listen('cmod/Sessions', 'Change', (payload) => {
    const { session, part } = payload as SessionChange
    if (part === 'goal') provided.tell('Change', { session, part })
  })
  return {
    ...provided,
    remove() {
      heard.remove()
      provided.remove()
    },
  }
}

type GoalsReader = {
  read(): Promise<Change[]>
  readProgress(): Promise<Change[]>
  readonly methods: InterfaceMethods<'inbox/Goals'>
}

export function goalsReaderOf(store: Store): GoalsReader {
  const goals = new Map<string, Goals>()
  const progress = new Map<string, Progress>()
  let goalStamps: Stamps = new Map()
  let progressStamps: Stamps = new Map()
  let reading: Promise<Change[]> = Promise.resolve([])
  let lastFailure: string | undefined
  const readOnce = async (isGoalsRead: boolean): Promise<Change[]> => {
    const fresh = await Promise.all([isGoalsRead ? readGoals(store, goalStamps) : { goals: [], unreadable: [], stamps: goalStamps }, readProgress(store, progressStamps)]).catch((error: unknown) => {
      const failure = String(error)
      if (failure !== lastFailure) console.error('inbox serve could not read the goals and progress files, so the ones read before stay:', error)
      lastFailure = failure
    })
    if (fresh === undefined) return []
    lastFailure = undefined
    const [freshGoals, freshProgress] = fresh
    const changes: Change[] = [
      ...freshGoals.goals.filter((each) => goalStamps.get(each.session) !== freshGoals.stamps.get(each.session)).map((each): Change => ({ session: each.session, part: 'goals' })),
      ...freshProgress.progress.filter((each) => progressStamps.get(each.session) !== freshProgress.stamps.get(each.session)).map((each): Change => ({ session: each.session, part: 'progress' })),
    ]
    goalStamps = freshGoals.stamps
    progressStamps = freshProgress.stamps
    for (const each of freshGoals.goals) goals.set(each.session, each)
    for (const each of freshProgress.progress) progress.set(each.session, each)
    for (const session of goals.keys()) if (!goalStamps.has(session)) goals.delete(session)
    for (const session of progress.keys()) if (!progressStamps.has(session)) progress.delete(session)
    for (const { id, reason } of freshGoals.unreadable) console.error(`inbox serve skipped goals/${id}.md, which does not read as goals: ${reason}`)
    for (const { id, reason } of freshProgress.unreadable) console.error(`inbox serve skipped progress/${id}.json, which does not read as progress: ${reason}`)
    return changes
  }
  const inTurn = (isGoalsRead: boolean): Promise<Change[]> => {
    reading = reading.then(() => readOnce(isGoalsRead))
    return reading
  }
  return {
    read: () => inTurn(true),
    readProgress: () => inTurn(false),
    methods: {
      goals: (session) => ({ goals: goals.get(session), progress: progress.get(session) }),
      sessions: () => [...new Set([...goals.keys(), ...progress.keys()])].sort(),
    },
  }
}
