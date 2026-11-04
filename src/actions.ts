import { fs, messageOf, Note, process, Prompt, sessions, type Mod } from '../node_modules/@cmodjs/core/mod.js'
import { advanced, marksIn, unheard, type Told } from './items/heard.js'
import { isInScope, isUnnamed, narrowestScope, personOf, repositoryOf, scopes, senderOf, sendersFor, sendersOf, type Author, type Item, type Person, type Scope, type Sender } from './items/item.js'
import { createItem, deliveryStart, readerOf, storeIn, updateItem, type Check, type Reader, type Reread, type Store } from './items/store.js'
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

export function personIn(mod: Mod<InboxState>, item: Item): Person {
  return personOf(mod.state.memory.person, item)
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

const learning = new WeakMap<Mod<InboxState>, Promise<void>>()

export function learnSenders(mod: Mod<InboxState>): Promise<void> {
  const running = learning.get(mod)
  if (running !== undefined) return running
  const learned = sessions
    .list({ everyProject: true })
    .then((listed) => {
      mod.state.memory.senders = sendersFor(mod.state.memory.items, sendersOf(listed))
    })
    .catch((error: unknown) => mod.log(`could not list the sessions, so items keep the session titles read before: ${messageOf(error)}`))
    .finally(() => learning.delete(mod))
  learning.set(mod, learned)
  return learned
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
  if (isUnnamed(mod.state.memory.items, mod.state.memory.senders)) void learnSenders(mod)
  for (const line of fresh.skipped) mod.log(`skipped ${line}`)
  void deliver(mod)
}

export async function load(mod: Mod<InboxState>): Promise<void> {
  await remembered(mod, await readerIn(mod).read())
}

export async function loadAll(mod: Mod<InboxState>): Promise<void> {
  await remembered(mod, await readerIn(mod).readAll())
}

export function scoped(mod: Mod<InboxState>, scope: Scope = mod.state.session.scope): Item[] {
  const { id, project } = sessions.current
  const repositories = mod.state.memory.repositories
  return mod.state.memory.items.filter((item) => isInScope(item, scope, { session: id, repository: repositories[project] ?? project }, repositories))
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

function nextUnheard(mod: Mod<InboxState>, id: string, start: string): Told | undefined {
  const item = mod.state.memory.items.find((each) => each.id === id)
  if (item === undefined) return undefined
  return unheard(item, personIn(mod, item), sessions.current.id, marksIn(mod.state.session.heard, id, start), mod.state.memory.senders)[0]
}

async function deliverItem(mod: Mod<InboxState>, id: string, sending: Set<string>): Promise<void> {
  const start = deliveryStarts.get(mod)
  if (sending.has(id) || start === undefined) return
  sending.add(id)
  try {
    for (let told = nextUnheard(mod, id, start); told !== undefined; told = nextUnheard(mod, id, start)) {
      const sentTo = sessions.current.id
      await sessions.current.send({ type: told.kind === 'prompt' ? Prompt : Note, text: told.text })
      if (sessions.current.id !== sentTo) return
      mod.state.session.heard = advanced(mod.state.session.heard, id, told, start)
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
  await Promise.all(mod.state.memory.items.map((item) => deliverItem(mod, item.id, sending)))
}
