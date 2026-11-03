import { holdsPersonFields, personFrom, upgrade } from './formats.js'
import { personOf, type Item, type Note, type Person, type PersonFiles } from './item.js'

export type Disk = {
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(path: string): Promise<readonly { readonly name: string; readonly isFile: boolean; readonly size: number; readonly modifiedAt: number }[]>
}

export type Store = {
  readonly folder: string
  readonly items: string
  readonly person: string
  readonly changed: string
  readonly deliveringSince: string
  readonly disk: Disk
}

type Stamps = ReadonlyMap<string, string>

type Read = { readonly items: readonly Item[]; readonly unreadable: readonly string[]; readonly stamps: Stamps }

type PersonRead = { readonly person: PersonFiles; readonly unreadable: readonly string[]; readonly stamps: Stamps }

type Stored = Record<string, unknown>

export function storeIn(dataFolder: string, disk: Disk): Store {
  return { folder: dataFolder, items: `${dataFolder}/items`, person: `${dataFolder}/person`, changed: `${dataFolder}/changed`, deliveringSince: `${dataFolder}/delivering-since`, disk }
}

export type Server = { readonly port: number; readonly token: string }

export function serverPath(store: Store): string {
  return `${store.folder}/server.json`
}

export async function savedServer(store: Store): Promise<Server | undefined> {
  const saved = (await storedIn(store, serverPath(store))) ?? {}
  const { port, token } = saved
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65_536 && typeof token === 'string' && token !== '' ? { port, token } : undefined
}

export async function deliveryStart(store: Store): Promise<string> {
  if (await store.disk.exists(store.deliveringSince)) return (await store.disk.read(store.deliveringSince)).trim()
  const now = new Date().toISOString()
  await store.disk.write(store.deliveringSince, `${now}\n`)
  return now
}

export function itemPath(store: Store, id: string): string {
  return `${store.items}/${id}.json`
}

export function personPath(store: Store, id: string): string {
  return `${store.person}/${id}.json`
}

async function storedFiles(store: Store, folder: string): Promise<{ readonly id: string; readonly stamp: string }[]> {
  if (!(await store.disk.exists(folder))) return []
  return (await store.disk.list(folder)).filter((entry) => entry.isFile && entry.name.endsWith('.json')).map((entry) => ({ id: entry.name.slice(0, -'.json'.length), stamp: `${entry.modifiedAt}:${entry.size}` }))
}

async function storedIn(store: Store, path: string): Promise<Stored | undefined> {
  try {
    return JSON.parse(await store.disk.read(path)) as Stored
  } catch {
    return undefined
  }
}

function readable<Each>(stored: Stored | undefined, parse: (stored: Stored) => Each): Each | undefined {
  try {
    return stored === undefined ? undefined : parse(stored)
  } catch {
    return undefined
  }
}

async function lastWritten(store: Store): Promise<string | undefined> {
  if (!(await store.disk.exists(store.changed))) return undefined
  return (await store.disk.read(store.changed)).trim().split(' ')[1]
}

async function readFresh<Each>(store: Store, folder: string, known: Stamps, parse: (stored: Stored) => Each) {
  const [files, last] = await Promise.all([storedFiles(store, folder), known.size === 0 ? undefined : lastWritten(store)])
  const fresh = files.filter(({ id, stamp }) => id === last || known.get(id) !== stamp)
  const read = await Promise.all(
    fresh.map(async ({ id }) => ({ id, value: readable(await storedIn(store, `${folder}/${id}.json`), parse) })),
  )
  return {
    read: read.flatMap(({ id, value }) => (value === undefined ? [] : [[id, value] as const])),
    unreadable: read.filter(({ value }) => value === undefined).map(({ id }) => id),
    stamps: new Map(files.map(({ id, stamp }) => [id, stamp])),
  }
}

export async function readItems(store: Store, known: Stamps = new Map()): Promise<Read> {
  const { read, unreadable, stamps } = await readFresh(store, store.items, known, upgrade)
  return { items: read.map(([, item]) => item), unreadable, stamps }
}

export async function readPerson(store: Store, known: Stamps = new Map()): Promise<PersonRead> {
  const { read, unreadable, stamps } = await readFresh(store, store.person, known, (stored) => stored as unknown as Person)
  return { person: Object.fromEntries(read), unreadable, stamps }
}

export type Changed = {
  readonly items: readonly Item[]
  readonly person: PersonFiles
  readonly gone: { readonly items: readonly string[]; readonly person: readonly string[] }
}

export type Reread = Changed & { readonly skipped: readonly string[] }

export const rereadMs = 30_000

export type Reader = { read(): Promise<Reread>; readAll(): Promise<Reread> }

function vanished(known: Stamps | undefined, fresh: Stamps): string[] {
  return [...(known?.keys() ?? [])].filter((id) => !fresh.has(id))
}

type Turns = <Done>(next: () => Promise<Done>) => Promise<Done>

function oneAtATime(): Turns {
  let last: Promise<unknown> = Promise.resolve()
  return (next) => {
    const done = last.then(next, next)
    last = done.catch(() => undefined)
    return done
  }
}

export function readerOf(store: Store): Reader {
  let known: { readonly items: Stamps; readonly person: Stamps } | undefined
  const reported = new Set<string>()
  const inTurn = oneAtATime()
  const readOnce = async (isEveryFile: boolean): Promise<Reread> => {
    const before = known
    const [items, person] = await Promise.all([readItems(store, isEveryFile ? undefined : before?.items), readPerson(store, isEveryFile ? undefined : before?.person)])
    known = { items: items.stamps, person: person.stamps }
    const lines = [...items.unreadable.map((id) => `items/${id}.json, which does not read as an inbox item`), ...person.unreadable.map((id) => `person/${id}.json, which does not read as a person file`)]
    const skipped = lines.filter((line) => !reported.has(line))
    for (const line of skipped) reported.add(line)
    return { items: items.items, person: person.person, gone: { items: vanished(before?.items, items.stamps), person: vanished(before?.person, person.stamps) }, skipped }
  }
  return { read: () => inTurn(() => readOnce(false)), readAll: () => inTurn(() => readOnce(true)) }
}

async function save(store: Store, path: string, id: string, value: object, at = new Date().toISOString()): Promise<void> {
  await store.disk.write(path, `${JSON.stringify(value, null, 2)}\n`)
  await store.disk.write(store.changed, `${at} ${id}\n`)
}

async function writeItem(store: Store, item: Item): Promise<Item> {
  const fresh = { ...item, updatedAt: new Date().toISOString() }
  await save(store, itemPath(store, item.id), item.id, fresh, fresh.updatedAt)
  return fresh
}

const writes = new WeakMap<Disk, Turns>()

function inWriteTurn<Done>(store: Store, write: () => Promise<Done>): Promise<Done> {
  const turns = writes.get(store.disk) ?? oneAtATime()
  writes.set(store.disk, turns)
  return turns(write)
}

export function createItem(store: Store, title: string, build: (id: string) => Item): Promise<Item> {
  return inWriteTurn(store, async () => {
    const taken = await Promise.all([storedFiles(store, store.items), storedFiles(store, store.person)])
    return writeItem(store, build(newId(title, taken.flat().map(({ id }) => id))))
  })
}

export async function itemOf(store: Store, id: string): Promise<Item> {
  const stored = await storedIn(store, itemPath(store, id))
  if (stored === undefined) throw new Error(`The inbox has nothing with the id ${id}. Call read with no id to list what is open.`)
  return upgrade(stored)
}

async function personFileOf(store: Store, item: Item): Promise<Person> {
  const path = personPath(store, item.id)
  return (await store.disk.exists(path)) ? (JSON.parse(await store.disk.read(path)) as Person) : personOf({}, item)
}

export function updateItem(store: Store, id: string, change: (fresh: Item, person: Person) => Item): Promise<Item> {
  return inWriteTurn(store, async () => {
    const fresh = await itemOf(store, id)
    return writeItem(store, change(fresh, await personFileOf(store, fresh)))
  })
}

export function updatePerson(store: Store, item: Item, change: (fresh: Person) => Person): Promise<Person> {
  return inWriteTurn(store, async () => {
    const fresh = await personFileOf(store, item)
    const person = change(fresh)
    if (JSON.stringify(person) !== JSON.stringify(fresh)) await save(store, personPath(store, item.id), item.id, person)
    return person
  })
}

function withAnswersOf(kept: Person, old: Person): Person {
  const added = old.answers.filter((answer) => !kept.answers.some((each) => each.at === answer.at))
  return added.length === 0 ? kept : { ...kept, answers: [...kept.answers, ...added].sort((a, b) => a.at.localeCompare(b.at)) }
}

export function moveIntoPersonFiles(store: Store, notes: Readonly<Record<string, readonly Note[]>>): Promise<number> {
  return inWriteTurn(store, async () => {
    const moved: string[] = []
    for (const { id } of await storedFiles(store, store.items)) {
      const stored = await storedIn(store, itemPath(store, id))
      if (stored === undefined || !holdsPersonFields(stored)) continue
      const upgraded = readable(stored, upgrade)
      const old = readable(stored, (each) => personFrom(each, notes[id] ?? []))
      if (upgraded === undefined || old === undefined) continue
      const path = personPath(store, id)
      const kept = (await storedIn(store, path)) as Person | undefined
      const person = kept === undefined ? old : withAnswersOf(kept, old)
      if (person !== kept) await store.disk.write(path, `${JSON.stringify(person, null, 2)}\n`)
      await store.disk.write(itemPath(store, id), `${JSON.stringify(upgraded, null, 2)}\n`)
      moved.push(id)
    }
    const last = moved.at(-1)
    if (last !== undefined) await store.disk.write(store.changed, `${new Date().toISOString()} ${last}\n`)
    return moved.length
  })
}

const longestId = 48

function newId(title: string, taken: readonly string[]): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const boundary = words.lastIndexOf('-', longestId)
  const cut = words.length <= longestId ? words : words.slice(0, boundary > 0 ? boundary : longestId)
  const slug = cut || 'item'
  if (!taken.includes(slug)) return slug
  for (let index = 2; ; index += 1) if (!taken.includes(`${slug}-${index}`)) return `${slug}-${index}`
}
