import { fs, messageOf, Note, process, Prompt, providers, sessions, type Mod, type Session, type Subscription, type Task as CmodTask, type TaskStatus } from '../node_modules/@cmodjs/core/mod.js'
import type { Program } from '../node_modules/@cmodjs/core/jobs/program.js'
import { counts, emptyGoals, type Counts, type Goals, type Task, type Unfiled } from './goals/goal.js'
import { progressPath, storedProgress, type Progress } from './goals/progress.js'
import { readGoals, updateGoals, type Lock } from './goals/store.js'
import { advanced, marksIn, unheard, type Told } from './items/heard.js'
import { deliveriesOf, isInScope, isUnnamed, narrowestScope, ofKind, personOf, queue, repositoryOf, scopes, senderOf, sendersFor, sendersOf, type Author, type Deliveries, type Item, type Person, type Scope, type Sender, type Summary } from './items/item.js'
import { createItem, deliveryStart, readerOf, storeIn, updateItem, type Check, type Reader, type Reread, type Stamps, type Store } from './items/store.js'
import type { InboxState } from './state.js'

export function author(): Author {
  const { id, agentType } = sessions.current
  return { session: id, ...(agentType === undefined ? {} : { agent: agentType }) }
}

export function storeOf(mod: Mod<InboxState>): Store {
  return storeIn(mod.dataFolder, fs)
}

export function remember(mod: Mod<InboxState>, items: readonly Item[]): void {
  const newest = new Map(mod.state.memory.items.map((item) => [item.id, item]))
  for (const item of items) {
    const known = newest.get(item.id)
    if (known === undefined || known.updatedAt <= item.updatedAt) newest.set(item.id, item)
  }
  mod.state.memory.items = [...newest.values()]
}

export function rememberPerson(mod: Mod<InboxState>, id: string, person: Person): void {
  mod.state.memory.person = { ...mod.state.memory.person, [id]: person }
}

export function personIn(mod: Mod<InboxState>, item: Summary): Person {
  return personOf(mod.state.memory.person, item)
}

export function deliveriesIn(mod: Mod<InboxState>): Deliveries {
  return deliveriesOf(mod.state.memory.items)
}

export function senderIn(mod: Mod<InboxState>, item: Item, author: Author): Sender {
  return senderOf(author, item.project, mod.state.memory.senders)
}

async function learnRepositories(mod: Mod<InboxState>, projects: readonly string[]): Promise<void> {
  const known = mod.state.memory.repositories
  const fresh = [...new Set(projects)].filter((project) => known[project] === undefined)
  if (fresh.length === 0) return
  const learned = await Promise.all(fresh.map(async (project) => [project, await repositoryOf(process.run, project, (line) => mod.log(line))] as const))
  mod.state.memory.repositories = { ...mod.state.memory.repositories, ...Object.fromEntries(learned) }
}

async function goalTextsOf(mod: Mod<InboxState>, listed: readonly Session[]): Promise<Record<string, string>> {
  const texts = await Promise.all(
    listed.map((each) =>
      each.goal.text().then(
        (text) => [[each.id, text] as const],
        (error: unknown) => {
          mod.log(`could not read the goal of session ${each.id}: ${messageOf(error)}`)
          return []
        },
      ),
    ),
  )
  return Object.fromEntries(texts.flat())
}

const learning = new WeakMap<Mod<InboxState>, Promise<void>>()

export function learnSessions(mod: Mod<InboxState>): Promise<void> {
  const running = learning.get(mod)
  if (running !== undefined) return running
  const learned = sessions
    .list({ everyProject: true })
    .then(async (listed) => {
      const listedSenders = sendersOf(listed)
      mod.state.memory.senders = { ...listedSenders, ...sendersFor(mod.state.memory.items, listedSenders) }
      const runningSessions = listed.filter((each) => each.isRunning)
      const [texts] = await Promise.all([goalTextsOf(mod, runningSessions.filter((each) => mod.state.memory.goalTexts[each.id] === undefined)), loadGoals(mod, false)])
      const runningIds = new Set(runningSessions.map((each) => each.id))
      mod.state.memory.goalTexts = { ...texts, ...Object.fromEntries(Object.entries(mod.state.memory.goalTexts).filter(([session]) => runningIds.has(session))) }
    })
    .catch((error: unknown) => mod.log(`could not list the sessions, so items keep the session titles and goals read before: ${messageOf(error)}`))
    .finally(() => learning.delete(mod))
  learning.set(mod, learned)
  return learned
}

async function rereadGoalText(mod: Mod<InboxState>, session: string): Promise<void> {
  if (mod.state.memory.goalTexts[session] === undefined) return
  const texts = await goalTextsOf(mod, [await sessions.get(session)])
  if (mod.state.memory.goalTexts[session] !== undefined) mod.state.memory.goalTexts = { ...mod.state.memory.goalTexts, ...texts }
}

const surfaced = new WeakMap<Mod<InboxState>, Promise<boolean>>()

export function hasSurfaces(mod: Mod<InboxState>): Promise<boolean> {
  const known = surfaced.get(mod)
  if (known !== undefined) return known
  const read = sessions.current.surfaces().then(
    (shown) => shown.length > 0,
    (error: unknown) => {
      mod.log(`could not read which Claude apps show this session, so it files none of the user's words, refuses no stop, and never starts the inbox program: ${messageOf(error)}`)
      return false
    },
  )
  surfaced.set(mod, read)
  return read
}

export function hearGoalChanges(mod: Mod<InboxState>, program: Pick<Program, 'provider'>): Promise<void> {
  let heard: readonly Subscription[] = []
  const reread = ({ session }: { readonly session: string }) => rereadGoalText(mod, session).catch((error: unknown) => mod.log(`could not reread the goal of session ${session}: ${messageOf(error)}`))
  const listen = async (): Promise<void> => {
    const found = await providers('cmod/Sessions')
    for (const each of heard) each.remove()
    heard = found.map((provider) => provider.onChange({ part: 'goal' }, reread))
  }
  const listenHere = async (): Promise<void> => {
    if (!(await hasSurfaces(mod))) return
    const own = await program.provider('inbox/Goals')
    own.onChange({ part: 'goal' }, reread)
  }
  const failed = (error: unknown) => mod.log(`could not hear the goal changes of other sessions, so each keeps the goal text read when it was first listed running: ${messageOf(error)}`)
  return providers('cmod/Providers')
    .then(async ([watch]) => {
      watch?.onChange({ interface: 'cmod/Sessions' }, () => listen().catch(failed))
      await Promise.all([listen(), listenHere()])
    })
    .catch(failed)
}

const readers = new WeakMap<Mod<InboxState>, Reader>()

function readerIn(mod: Mod<InboxState>): Reader {
  const known = readers.get(mod)
  if (known !== undefined) return known
  const reader = readerOf(storeOf(mod))
  readers.set(mod, reader)
  return reader
}

async function remembered(mod: Mod<InboxState>, fresh: Reread): Promise<void> {
  remember(mod, fresh.items)
  mod.state.memory.items = mod.state.memory.items.filter((item) => !fresh.gone.items.includes(item.id))
  mod.state.memory.person = Object.fromEntries(Object.entries({ ...mod.state.memory.person, ...fresh.person }).filter(([id]) => !fresh.gone.person.includes(id)))
  await learnRepositories(mod, [sessions.current.project, ...fresh.items.map((item) => item.project)])
  if (isUnnamed(mod.state.memory.items, mod.state.memory.senders)) void learnSessions(mod)
  for (const line of fresh.skipped) mod.log(`skipped ${line}`)
  void deliver(mod)
}

function newest<Each extends { readonly session: string }>(known: Readonly<Record<string, Each>>, fresh: readonly Each[], at: (each: Each) => string): Readonly<Record<string, Each>> {
  const kept = { ...known }
  for (const each of fresh) {
    const before = kept[each.session]
    if (before === undefined || at(before) <= at(each)) kept[each.session] = each
  }
  return kept
}

export function rememberProgress(mod: Mod<InboxState>, progress: Progress): void {
  const known = mod.state.memory.progress
  if (progress.session === sessions.current.id && (known?.session !== progress.session || known.at <= progress.at)) mod.state.memory.progress = progress
}

function ownsActiveTaskIn(goals: Goals): boolean {
  return goals.tasks.some((task) => task.state === 'active' && task.owner === sessions.current.id)
}

export function rememberGoals(mod: Mod<InboxState>, goals: readonly Goals[], known = mod.state.memory.goals): void {
  const remembered = newest(known, goals, (each) => each.updatedAt)
  mod.state.memory.goals = remembered
  const { takenFrom } = mod.state.session
  const kept = takenFrom.filter((session) => {
    const read = remembered[session]
    return read === undefined || ownsActiveTaskIn(read)
  })
  const taken = Object.values(remembered)
    .filter((each) => each.session !== sessions.current.id && !kept.includes(each.session) && ownsActiveTaskIn(each))
    .map((each) => each.session)
  if (kept.length !== takenFrom.length || taken.length > 0) mod.state.session.takenFrom = [...kept, ...taken]
}

export function loadsFilesOf(mod: Mod<InboxState>, session: string): boolean {
  return session === sessions.current.id || mod.state.session.takenFrom.includes(session) || mod.state.memory.senders[session]?.isRunning === true
}

const goalStamps = new WeakMap<Mod<InboxState>, Stamps>()

export async function loadGoals(mod: Mod<InboxState>, isEveryFile: boolean): Promise<void> {
  await copyForkedGoals(mod)
  const fresh = await readGoals(storeOf(mod), isEveryFile ? undefined : goalStamps.get(mod), (session) => loadsFilesOf(mod, session)).catch((error: unknown) => mod.log(`could not read the goals files, so the inbox keeps the goals it read before: ${messageOf(error)}`))
  if (fresh === undefined) return
  goalStamps.set(mod, fresh.stamps)
  rememberGoals(mod, fresh.goals, isEveryFile ? {} : undefined)
  for (const { id, reason } of fresh.unreadable) mod.log(`skipped goals/${id}.md, which does not read as goals: ${reason}`)
}

async function loadProgress(mod: Mod<InboxState>, session: string): Promise<void> {
  try {
    const progress = await storedProgress(storeOf(mod), session)
    if (progress !== undefined) rememberProgress(mod, progress)
  } catch (error) {
    mod.log(`could not read progress/${session}.json, so the inbox keeps the progress it read before: ${messageOf(error)}`)
  }
}

const progressWatches = new WeakMap<Mod<InboxState>, { readonly path: string; readonly watch: Subscription }>()

export function followProgress(mod: Mod<InboxState>): Promise<void> {
  const session = sessions.current.id
  const path = progressPath(storeOf(mod), session)
  const followed = progressWatches.get(mod)
  if (followed?.path !== path) {
    followed?.watch.remove()
    progressWatches.set(mod, { path, watch: fs.onChange({ path }, () => loadProgress(mod, session)) })
  }
  return loadProgress(mod, session)
}

export async function load(mod: Mod<InboxState>): Promise<void> {
  await Promise.all([readerIn(mod).read().then((fresh) => remembered(mod, fresh)), loadGoals(mod, false).then(() => handBackEnded(mod))])
}

export async function loadAll(mod: Mod<InboxState>): Promise<void> {
  await Promise.all([readerIn(mod).readAll().then((fresh) => remembered(mod, fresh)), followProgress(mod), loadGoals(mod, true).then(() => handBackEnded(mod))])
}

export function goalsIn(mod: Mod<InboxState>, session = sessions.current.id): Goals | undefined {
  return mod.state.memory.goals[session]
}

export function goalTextIn(mod: Mod<InboxState>, session = sessions.current.id): string {
  return (mod.state.memory.goalTexts[session] ?? '').trim()
}

export async function loadGoalsOf(mod: Mod<InboxState>, session: string): Promise<Goals | undefined> {
  const { goals, unreadable } = await readGoals(storeOf(mod), new Map(), (each) => each === session)
  const [failed] = unreadable
  if (failed !== undefined) throw new Error(`goals/${session}.md does not read as goals: ${failed.reason}`)
  rememberGoals(mod, goals)
  return goalsIn(mod, session)
}

export function countsIn(mod: Mod<InboxState>, session = sessions.current.id): Counts {
  return counts(goalsIn(mod, session) ?? emptyGoals(session, ''), mod.state.memory.items, mod.state.memory.person)
}

export async function ran(argv: readonly string[]): Promise<void> {
  const done = await process.run(argv)
  if (done.exitCode !== 0) throw new Error(`${argv.join(' ')} exited ${done.exitCode}: ${done.stderr.trim()}`)
}

const isRun = async (argv: readonly string[]): Promise<boolean> => (await process.run(argv)).exitCode === 0

function lockOf(mod: Mod<InboxState>): Lock {
  return {
    makeFolder: (path) => ran(['mkdir', '-p', path]),
    take: async (path, token) => {
      if (!(await isRun(['mkdir', path]))) return false
      await ran(['touch', `${path}/${token}`])
      return true
    },
    heldSince: (path) =>
      fs.stat(path).then(
        (stat) => stat.modifiedAt,
        async (error: unknown) => {
          if (await fs.exists(path)) throw error
          return undefined
        },
      ),
    tokens: (path) =>
      fs.list(path).then(
        (entries) => entries.filter((each) => each.isFile),
        async (error: unknown) => {
          if (await fs.exists(path)) throw error
          return []
        },
      ),
    remove: (path) => isRun(['rm', '-d', path]),
    wait: (ms) =>
      new Promise((resolve) => {
        mod.after(ms, () => resolve())
      }),
  }
}

export async function changeGoals(mod: Mod<InboxState>, session: string, update: (fresh: Goals | undefined) => Goals, check?: Check, told?: string[]): Promise<Goals> {
  const toasted: string[] = []
  const goals = await updateGoals(storeOf(mod), lockOf(mod), session, update, told ?? toasted, check)
  rememberGoals(mod, [goals])
  if (session === sessions.current.id && mod.state.session.goalsSession === null) mod.state.session.goalsSession = session
  for (const warning of toasted) mod.toast.warning(warning)
  return goals
}

function withNew<Each extends { readonly id: string }>(known: readonly Each[], copied: readonly Each[]): Each[] {
  return [...known, ...copied.filter((each) => !known.some((kept) => kept.id === each.id))]
}

const forkCopies = new WeakMap<Mod<InboxState>, Promise<void>>()

export function copyForkedGoals(mod: Mod<InboxState>): Promise<void> {
  const parent = mod.state.session.goalsSession
  const { id: session, project } = sessions.current
  if (parent === null || parent === session) return Promise.resolve()
  const running = forkCopies.get(mod)
  if (running !== undefined) return running
  const copied = readGoals(storeOf(mod), new Map(), (each) => each === parent)
    .then(async ({ goals: [kept], unreadable: [failed] }) => {
      if (failed !== undefined) throw new Error(`goals/${parent}.md does not read as goals: ${failed.reason}`)
      if (kept !== undefined) {
        await changeGoals(mod, session, (fresh) => {
          const known = fresh ?? emptyGoals(session, project)
          return { ...known, requirements: withNew(known.requirements, kept.requirements), filings: withNew(known.filings, kept.filings) }
        })
      }
      if (sessions.current.id === session) mod.state.session.goalsSession = session
    })
    .catch((error: unknown) => mod.log(`could not copy the requirements of session ${parent} into this fork, so the next load tries again: ${messageOf(error)}`))
    .finally(() => forkCopies.delete(mod))
  forkCopies.set(mod, copied)
  return copied
}

function isHeldBySubagent(task: Task, isEnded: (cmodTask: string) => boolean): task is Extract<Task, { readonly state: 'active' }> {
  return task.state === 'active' && task.owner === sessions.current.id && task.cmodTask !== undefined && isEnded(task.cmodTask)
}

export async function handBack(mod: Mod<InboxState>, isEnded: (cmodTask: string) => boolean): Promise<void> {
  const held = Object.values(mod.state.memory.goals).filter((goals) => goals.tasks.some((task) => isHeldBySubagent(task, isEnded)))
  await Promise.all(
    held.map(({ session }) =>
      changeGoals(mod, session, (fresh) => {
        if (fresh === undefined) throw new Error(`Session ${session} has no goals file, so no task of it returns from a subagent.`)
        return {
          ...fresh,
          tasks: fresh.tasks.map((task) => {
            if (!isHeldBySubagent(task, isEnded)) return task
            const { cmodTask, ...kept } = task
            return kept
          }),
        }
      }),
    ),
  )
}

const runningStatuses: readonly TaskStatus[] = ['pending', 'running', 'waiting', 'idle']

const isRunningTask = ({ closedAt, status }: CmodTask): boolean => closedAt === undefined && (status === undefined || runningStatuses.includes(status))

async function runningTasksIn(tasks: readonly CmodTask[]): Promise<string[]> {
  const nested = await Promise.all(tasks.map(async (task) => runningTasksIn(await task.tasks())))
  return [...tasks.filter(isRunningTask).map((task) => task.id), ...nested.flat()]
}

async function handBackEnded(mod: Mod<InboxState>): Promise<void> {
  try {
    if (!Object.values(mod.state.memory.goals).some((goals) => goals.tasks.some((task) => isHeldBySubagent(task, () => true)))) return
    const running = new Set(await runningTasksIn(await sessions.current.goal.tasks()))
    await handBack(mod, (cmodTask) => !running.has(cmodTask))
  } catch (error) {
    mod.log(`could not hand back the tasks of subagents that no longer run, so the next load tries again: ${messageOf(error)}`)
  }
}

export function addUnfiled(mod: Mod<InboxState>, unfiled: Unfiled): void {
  const isKnown = mod.state.session.unfiled.some((each) => each.id === unfiled.id) || (goalsIn(mod)?.filings ?? []).some((each) => each.id === unfiled.id)
  if (!isKnown) mod.state.session.unfiled = [...mod.state.session.unfiled, unfiled]
}

export function scoped(mod: Mod<InboxState>, scope: Scope = mod.state.session.scope): Item[] {
  const { id, project } = sessions.current
  const repositories = mod.state.memory.repositories
  return mod.state.memory.items.filter((item) => isInScope(item, scope, { session: id, repository: repositories[project] ?? project }, repositories))
}

export function listedIn(mod: Mod<InboxState>): Item[] {
  return ofKind(queue(scoped(mod), mod.state.memory.person, mod.state.memory.senders, deliveriesIn(mod)), mod.state.session.kind)
}

export function shownIn(mod: Mod<InboxState>): Item | undefined {
  const { viewing } = mod.state.session
  return viewing === null ? undefined : scoped(mod).find((item) => item.id === viewing)
}

export function widenTo(mod: Mod<InboxState>, id: string): void {
  mod.state.session.scope = narrowestScope(scopes, mod.state.session.scope, id, (scope) => scoped(mod, scope))
}

export async function create(mod: Mod<InboxState>, title: string, build: (id: string) => Item, check: Check): Promise<Item> {
  const item = await createItem(storeOf(mod), title, build, check)
  remember(mod, [item])
  return item
}

export async function change(mod: Mod<InboxState>, id: string, update: (fresh: Item, person: Person) => Item, check?: Check): Promise<Item> {
  const item = await updateItem(storeOf(mod), id, update, check)
  remember(mod, [item])
  return item
}

export function find(mod: Mod<InboxState>, id: string): Item {
  const item = mod.state.memory.items.find((each) => each.id === id)
  if (item === undefined) throw new Error(`The inbox has nothing with the id ${id}. Call read with no id to list what is open.`)
  return item
}

const deliveryStarts = new WeakMap<Mod<InboxState>, string>()

const delivering = new WeakMap<Mod<InboxState>, Set<string>>()

export async function startDelivery(mod: Mod<InboxState>): Promise<void> {
  deliveryStarts.set(mod, await deliveryStart(storeOf(mod)))
}

function nextUnheard(mod: Mod<InboxState>, id: string, start: string, isFiling: boolean): Told | undefined {
  const item = mod.state.memory.items.find((each) => each.id === id)
  if (item === undefined) return undefined
  return unheard(item, personIn(mod, item), sessions.current.id, marksIn(mod.state.session.heard, id, start), mod.state.memory.senders, isFiling)[0]
}

async function deliverItem(mod: Mod<InboxState>, id: string, sending: Set<string>, isFiling: boolean): Promise<void> {
  const start = deliveryStarts.get(mod)
  if (sending.has(id) || start === undefined) return
  sending.add(id)
  try {
    for (let told = nextUnheard(mod, id, start, isFiling); told !== undefined; told = nextUnheard(mod, id, start, isFiling)) {
      const sentTo = sessions.current.id
      await sessions.current.send({ type: told.kind === 'prompt' ? Prompt : Note, text: told.text })
      if (sessions.current.id !== sentTo) return
      mod.state.session.heard = advanced(mod.state.session.heard, id, told, start)
      if (told.answer !== undefined) addUnfiled(mod, { id: told.answer.id, source: 'answer', text: told.answer.words, at: told.at })
    }
  } catch (error) {
    mod.log(`could not deliver ${id}, so the next load tries again: ${messageOf(error)}`)
  } finally {
    sending.delete(id)
  }
}

export async function deliver(mod: Mod<InboxState>): Promise<void> {
  const sending = delivering.get(mod) ?? new Set<string>()
  delivering.set(mod, sending)
  const isFiling = await hasSurfaces(mod)
  await Promise.all(mod.state.memory.items.map((item) => deliverItem(mod, item.id, sending, isFiling)))
}
