import { converted, mergedPerson, upgradePerson } from './formats.js'
import { personOf, revisionNumber, type Item, type Note, type Person, type PersonFiles } from './item.js'
import { itemMarkdown, parseItem, parsePerson, personMarkdown, revisionMarkdown } from './markdown.js'

export type Disk = {
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  list(path: string): Promise<readonly { readonly name: string; readonly isFile: boolean; readonly size: number; readonly modifiedAt: number }[]>
}

export type Store = {
  readonly folder: string
  readonly items: string
  readonly revisions: string
  readonly person: string
  readonly changed: string
  readonly deliveringSince: string
  readonly disk: Disk
}

type Stamps = ReadonlyMap<string, string>

type Unreadable = { readonly id: string; readonly reason: string }

type Read = { readonly items: readonly Item[]; readonly unreadable: readonly Unreadable[]; readonly stamps: Stamps }

type PersonRead = { readonly person: PersonFiles; readonly unreadable: readonly Unreadable[]; readonly stamps: Stamps }

type Stored = Record<string, unknown>

export function storeIn(dataFolder: string, disk: Disk): Store {
  return { folder: dataFolder, items: `${dataFolder}/items`, revisions: `${dataFolder}/revisions`, person: `${dataFolder}/person`, changed: `${dataFolder}/changed`, deliveringSince: `${dataFolder}/delivering-since`, disk }
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
  return `${store.items}/${id}.md`
}

export function revisionPath(store: Store, id: string, index: number): string {
  return `${store.revisions}/${id}/${revisionNumber(index)}.md`
}

export function personPath(store: Store, id: string): string {
  return `${store.person}/${id}.md`
}

function jsonPath(folder: string, id: string): string {
  return `${folder}/${id}.json`
}

async function storedFiles(store: Store, folder: string, extension = '.md'): Promise<{ readonly id: string; readonly name: string; readonly stamp: string }[]> {
  if (!(await store.disk.exists(folder))) return []
  return (await store.disk.list(folder)).filter((entry) => entry.isFile && entry.name.endsWith(extension)).map((entry) => ({ id: entry.name.slice(0, -extension.length), name: entry.name, stamp: `${entry.modifiedAt}:${entry.size}` }))
}

async function storedIn(store: Store, path: string): Promise<Stored | undefined> {
  try {
    return JSON.parse(await store.disk.read(path)) as Stored
  } catch {
    return undefined
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function lastWritten(store: Store): Promise<string | undefined> {
  if (!(await store.disk.exists(store.changed))) return undefined
  return (await store.disk.read(store.changed)).trim().split(' ')[1]
}

async function storedItem(store: Store, id: string): Promise<Item> {
  const folder = `${store.revisions}/${id}`
  const earlier = (await store.disk.exists(folder)) ? await Promise.all((await storedFiles(store, folder)).map(({ name }) => store.disk.read(`${folder}/${name}`))) : []
  return parseItem(id, await store.disk.read(itemPath(store, id)), earlier)
}

async function storedPerson(store: Store, id: string): Promise<Person> {
  return parsePerson(id, await store.disk.read(personPath(store, id)))
}

async function readFresh<Each>(store: Store, folder: string, known: Stamps, read: (id: string) => Promise<Each>) {
  const [files, last] = await Promise.all([storedFiles(store, folder), known.size === 0 ? undefined : lastWritten(store)])
  const fresh = files.filter(({ id, stamp }) => id === last || known.get(id) !== stamp)
  const values = await Promise.all(fresh.map(({ id }) => read(id).then((value) => ({ id, value }), (error: unknown) => ({ id, reason: reasonOf(error) }))))
  return {
    read: values.flatMap((each) => ('value' in each ? [[each.id, each.value] as const] : [])),
    unreadable: values.flatMap((each) => ('reason' in each ? [each] : [])),
    stamps: new Map(files.map(({ id, stamp }) => [id, stamp])),
  }
}

export async function readItems(store: Store, known: Stamps = new Map()): Promise<Read> {
  const { read, unreadable, stamps } = await readFresh(store, store.items, known, (id) => storedItem(store, id))
  return { items: read.map(([, item]) => item), unreadable, stamps }
}

export async function readPerson(store: Store, known: Stamps = new Map()): Promise<PersonRead> {
  const { read, unreadable, stamps } = await readFresh(store, store.person, known, (id) => storedPerson(store, id))
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
    const lines = [...items.unreadable.map(({ id, reason }) => `items/${id}.md, which does not read as an inbox item: ${reason}`), ...person.unreadable.map(({ id, reason }) => `person/${id}.md, which does not read as a person file: ${reason}`)]
    const skipped = lines.filter((line) => !reported.has(line))
    for (const line of skipped) reported.add(line)
    return { items: items.items, person: person.person, gone: { items: vanished(before?.items, items.stamps), person: vanished(before?.person, person.stamps) }, skipped }
  }
  return { read: () => inTurn(() => readOnce(false)), readAll: () => inTurn(() => readOnce(true)) }
}

async function save(store: Store, path: string, id: string, text: string, at = new Date().toISOString()): Promise<void> {
  await store.disk.write(path, text)
  await store.disk.write(store.changed, `${at} ${id}\n`)
}

type Files = readonly (readonly [path: string, text: string])[]

function revisionFiles(store: Store, item: Item, written: number): Files {
  return item.revisions.slice(written, -1).map((_, offset) => [revisionPath(store, item.id, written + offset), revisionMarkdown(item, written + offset)])
}

async function writeFiles(store: Store, files: Files): Promise<void> {
  for (const [path, text] of files) await store.disk.write(path, text)
}

export type Check = (id: string, markdown: string) => Promise<void>

async function writeItem(store: Store, item: Item, written: number): Promise<Item> {
  const fresh = { ...item, updatedAt: new Date().toISOString() }
  const revisions = revisionFiles(store, fresh, written)
  const text = itemMarkdown(fresh)
  await writeFiles(store, revisions)
  await save(store, itemPath(store, fresh.id), fresh.id, text, fresh.updatedAt)
  return fresh
}

const writes = new WeakMap<Disk, Turns>()

function inWriteTurn<Done>(store: Store, write: () => Promise<Done>): Promise<Done> {
  const turns = writes.get(store.disk) ?? oneAtATime()
  writes.set(store.disk, turns)
  return turns(write)
}

async function takenIds(store: Store): Promise<string[]> {
  return (await Promise.all([storedFiles(store, store.items), storedFiles(store, store.person)])).flat().map(({ id }) => id)
}

export async function createItem(store: Store, title: string, build: (id: string) => Item, check?: Check): Promise<Item> {
  const named = async (): Promise<Item> => build(newId(title, await takenIds(store)))
  if (check !== undefined) {
    const item = await named()
    await check(item.id, itemMarkdown(item))
  }
  return inWriteTurn(store, async () => writeItem(store, await named(), 0))
}

export async function itemOf(store: Store, id: string): Promise<Item> {
  if (!(await store.disk.exists(itemPath(store, id)))) throw new Error(`The inbox has nothing with the id ${id}. Call read with no id to list what is open.`)
  return storedItem(store, id)
}

async function personFileOf(store: Store, item: Item): Promise<Person> {
  return (await store.disk.exists(personPath(store, item.id))) ? storedPerson(store, item.id) : personOf({}, item)
}

export async function updateItem(store: Store, id: string, change: (fresh: Item, person: Person) => Item, check?: Check): Promise<Item> {
  const changed = async (): Promise<{ readonly written: number; readonly item: Item }> => {
    const fresh = await itemOf(store, id)
    return { written: fresh.revisions.length - 1, item: change(fresh, await personFileOf(store, fresh)) }
  }
  if (check !== undefined) {
    const { item } = await changed()
    await check(item.id, itemMarkdown(item))
  }
  return inWriteTurn(store, async () => {
    const { written, item } = await changed()
    return writeItem(store, item, written)
  })
}

export function updatePerson(store: Store, item: Item, change: (fresh: Person) => Person): Promise<Person> {
  return inWriteTurn(store, async () => {
    const fresh = await personFileOf(store, item)
    const person = change(fresh)
    if (JSON.stringify(person) !== JSON.stringify(fresh)) await save(store, personPath(store, item.id), item.id, personMarkdown(person))
    return person
  })
}

type Converted = { readonly converted: number; readonly skipped: readonly string[] }

type Remove = (path: string) => Promise<void>

async function keptPerson(store: Store, id: string): Promise<Person | undefined> {
  return (await store.disk.exists(personPath(store, id))) ? storedPerson(store, id) : undefined
}

function personFiles(store: Store, id: string, kept: Person | undefined, added: Person | undefined): Files {
  const person = mergedPerson(kept, added)
  return person === undefined || person === kept ? [] : [[personPath(store, id), personMarkdown(person)]]
}

function isCopyOf(id: string, jsonId: string): boolean {
  return id === jsonId || (id.startsWith(`${jsonId}-`) && /^\d+$/.test(id.slice(jsonId.length + 1)))
}

function copyId(jsonId: string, taken: readonly string[]): string {
  for (let index = 2; ; index += 1) if (!taken.includes(`${jsonId}-${index}`)) return `${jsonId}-${index}`
}

async function convertItem(store: Store, id: string, notes: readonly Note[], remove: Remove): Promise<string | undefined> {
  const stored = await storedIn(store, jsonPath(store.items, id))
  if (stored === undefined) throw new Error('it is no JSON object')
  const person = await storedIn(store, jsonPath(store.person, id))
  const found = converted(stored, person, notes)
  const ids = (await storedFiles(store, store.items)).map((each) => each.id)
  const copies = await Promise.all(ids.filter((each) => isCopyOf(each, id)).map((each) => storedItem(store, each)))
  const kept = copies.find((each) => each.revisions[0]?.at === found.item.revisions[0]?.at)
  const item = { ...found.item, id: kept?.id ?? (ids.includes(id) ? copyId(id, await takenIds(store)) : id) }
  const files = [...(kept === undefined || kept.updatedAt < item.updatedAt ? [...revisionFiles(store, item, 0), [itemPath(store, item.id), itemMarkdown(item)] as const] : []), ...personFiles(store, item.id, await keptPerson(store, item.id), found.person)]
  await writeFiles(store, files)
  if (person !== undefined) await remove(jsonPath(store.person, id))
  if (item.id === id) await remove(jsonPath(store.items, id))
  return files.length > 0 || person !== undefined || item.id === id ? item.id : undefined
}

async function convertPerson(store: Store, id: string, remove: Remove): Promise<void> {
  if (await store.disk.exists(jsonPath(store.items, id))) throw new Error(`it waits for items/${id}.json to convert`)
  const person = await storedIn(store, jsonPath(store.person, id))
  if (person === undefined) throw new Error('it is no JSON object')
  if (!(await store.disk.exists(itemPath(store, id)))) throw new Error('it belongs to no stored item')
  await writeFiles(store, personFiles(store, id, await keptPerson(store, id), upgradePerson(person)))
  await remove(jsonPath(store.person, id))
}

export function convertJsonFiles(store: Store, notes: Readonly<Record<string, readonly Note[]>>, remove: Remove): Promise<Converted> {
  return inWriteTurn(store, async () => {
    const skipped: string[] = []
    const done: string[] = []
    for (const { id } of await storedFiles(store, store.items, '.json')) {
      try {
        const written = await convertItem(store, id, notes[id] ?? [], remove)
        if (written !== undefined) done.push(written)
      } catch (error) {
        skipped.push(`items/${id}.json, which does not convert: ${reasonOf(error)}`)
      }
    }
    for (const { id } of await storedFiles(store, store.person, '.json')) {
      try {
        await convertPerson(store, id, remove)
        done.push(id)
      } catch (error) {
        skipped.push(`person/${id}.json, which does not convert: ${reasonOf(error)}`)
      }
    }
    const last = done.at(-1)
    if (last !== undefined) await store.disk.write(store.changed, `${new Date().toISOString()} ${last}\n`)
    return { converted: done.length, skipped }
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
