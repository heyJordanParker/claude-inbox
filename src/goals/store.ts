import { documentText, heading, type Fields } from '../items/markdown.js'
import { inWriteTurn, readFresh, reasonOf, save, type Check, type Stamps, type Store } from '../items/store.js'
import type { Goals } from './goal.js'
import { goalsMarkdown, parseGoals } from './markdown.js'

export class Invalid extends Error {}

export function validateSession(session: string): string {
  if (!/^[\w-]+$/.test(session)) throw new Invalid(`${JSON.stringify(session)} is not a session id, which holds only letters, digits, - and _.`)
  return session
}

const goalsFolder = (store: Store): string => `${store.folder}/goals`

const goalsId = (session: string): string => `goals/${session}`

function goalsPath(store: Store, session: string): string {
  return `${goalsFolder(store)}/${validateSession(session)}.md`
}

async function storedGoals(store: Store, session: string): Promise<Goals | undefined> {
  const path = goalsPath(store, session)
  return (await store.disk.exists(path)) ? parseGoals(session, await store.disk.read(path)) : undefined
}

export async function readGoals(store: Store, known: Stamps = new Map(), isWanted?: (session: string) => boolean) {
  const { read, unreadable, stamps } = await readFresh(store, goalsFolder(store), known, async (session) => parseGoals(session, await store.disk.read(goalsPath(store, session))), { changedPrefix: 'goals/', isWanted })
  return { goals: read.map(([, goals]) => goals), unreadable, stamps }
}

function reworded<Each extends { readonly id: string }>(name: string, fresh: readonly Each[], stored: readonly Each[], wordsOf: (each: Each) => Fields): string[] {
  const before = new Map(stored.map((each) => [each.id, wordsOf(each)]))
  return fresh.flatMap((each) => {
    const was = before.get(each.id) ?? {}
    const changed = Object.entries(wordsOf(each)).filter(([key, words]) => words !== undefined && JSON.stringify(words) !== JSON.stringify(was[key]))
    return changed.length === 0 ? [] : [heading(2, name, { id: each.id, ...Object.fromEntries(changed) })]
  })
}

function addedWords(goals: Goals, stored: Goals | undefined): string[] {
  return [
    ...reworded('requirement', goals.requirements, stored?.requirements ?? [], ({ capability, line }) => ({ capability, line })),
    ...reworded('filing', goals.filings, stored?.filings ?? [], (each) => ('reason' in each ? { reason: each.reason } : {})),
    ...reworded('task', goals.tasks, stored?.tasks ?? [], (each) => ({ title: each.title, evidence: 'evidence' in each ? each.evidence : undefined, reason: 'reason' in each ? each.reason : undefined })),
  ]
}

export type Lock = {
  readonly makeFolder: (path: string) => Promise<void>
  readonly take: (path: string, token: string) => Promise<boolean>
  readonly heldSince: (path: string) => Promise<number | undefined>
  readonly tokens: (path: string) => Promise<readonly { readonly name: string; readonly modifiedAt: number }[]>
  readonly remove: (path: string) => Promise<boolean>
  readonly wait: (ms: number) => Promise<void>
}

const lockMs = 10_000

const lockRetryMs = 20

const isStale = (modifiedAt: number): boolean => Date.now() - modifiedAt > lockMs

async function brokeStale(lock: Lock, path: string): Promise<boolean> {
  const tokens = await lock.tokens(path)
  const stamps = tokens.length === 0 ? [await lock.heldSince(path)] : tokens.map((each) => each.modifiedAt)
  if (stamps.some((stamp) => stamp !== undefined && !isStale(stamp))) return false
  for (const token of tokens) if (!(await lock.remove(`${path}/${token.name}`))) return true
  await lock.remove(path)
  return true
}

async function released(lock: Lock, path: string, token: string): Promise<string | undefined> {
  try {
    if (await lock.remove(`${path}/${token}`)) return (await lock.remove(path)) ? undefined : `rm could not remove the lock ${path}, so the next write waits until it is ${lockMs / 1000} s old.`
    if ((await lock.tokens(path)).some((each) => each.name === token)) return `rm could not remove the token ${token} from the lock ${path}, so the next write waits until it is ${lockMs / 1000} s old.`
    return `This write held the lock ${path} over ${lockMs / 1000} s, so another writer broke it as stale, and that writer's write can have replaced this one.`
  } catch (error) {
    return `The lock ${path} could not be released: ${reasonOf(error)}`
  }
}

async function locked<Done>(store: Store, lock: Lock, session: string, told: string[], write: () => Promise<Done>): Promise<Done> {
  const path = `${goalsPath(store, session)}.lock`
  const token = Math.random().toString(36).slice(2)
  await lock.makeFolder(goalsFolder(store))
  const since = Date.now()
  while (!(await lock.take(path, token))) {
    if (Date.now() - since > 2 * lockMs) throw new Error(`The lock ${path} could not be taken in ${(2 * lockMs) / 1000} s, though a lock older than ${lockMs / 1000} s is broken, so the goals of session ${session} stay as they were.`)
    if (!(await brokeStale(lock, path))) await lock.wait(lockRetryMs)
  }
  const done = await write().catch(async (error: unknown) => {
    await released(lock, path, token)
    throw error
  })
  const warning = await released(lock, path, token)
  if (warning !== undefined) told.push(`The goals of session ${session} were written. ${warning}`)
  return done
}

export async function updateGoals(store: Store, lock: Lock, session: string, change: (fresh: Goals | undefined) => Goals, told: string[], check?: Check): Promise<Goals> {
  if (check !== undefined) {
    const stored = await storedGoals(store, session)
    const added = addedWords(change(stored), stored)
    if (added.length > 0) await check(goalsId(session), documentText({ session }, added))
  }
  return locked(store, lock, session, told, () =>
    inWriteTurn(store, async () => {
      const goals = { ...change(await storedGoals(store, session)), updatedAt: new Date().toISOString() }
      await save(store, goalsPath(store, session), goalsId(session), goalsMarkdown(goals), goals.updatedAt)
      return goals
    }),
  )
}
