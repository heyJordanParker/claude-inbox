import { Note, Prompt, sessions, type Mod, type SessionSend } from '../node_modules/@cmodjs/core/mod.js'
import { byQueue, createItem, readItems, storeIn, updateItem, type Author, type Item } from './inbox.js'
import type { InboxState } from './state.js'

const longestLabel = 32

function labelOf(title: string, id: string): string {
  const line = title.split('\n')[0]?.trim() ?? ''
  if (line === '') return id
  return line.length <= longestLabel ? line : `${line.slice(0, longestLabel - 1).trimEnd()}…`
}

export function author(): Author {
  const { id, title, agentType } = sessions.current
  return { session: id, title: labelOf(title, id), ...(agentType === undefined ? {} : { agent: agentType }) }
}

function remember(mod: Mod<InboxState>, items: readonly Item[]): void {
  const newest = new Map(mod.state.memory.items.map((item) => [item.id, item]))
  for (const item of items) {
    const known = newest.get(item.id)
    if (known === undefined || known.updatedAt <= item.updatedAt) newest.set(item.id, item)
  }
  mod.state.memory.items = [...newest.values()].sort(byQueue)
}

const reportedUnreadable = new Set<string>()

export async function load(mod: Mod<InboxState>): Promise<void> {
  const { items, unreadable } = await readItems(storeIn(mod.dataFolder))
  remember(mod, items)
  for (const id of unreadable.filter((each) => !reportedUnreadable.has(each))) {
    reportedUnreadable.add(id)
    mod.log(`skipped items/${id}.json, which does not read as an inbox item`)
  }
}

export async function create(mod: Mod<InboxState>, title: string, build: (id: string) => Item): Promise<Item> {
  const item = await createItem(storeIn(mod.dataFolder), title, build)
  remember(mod, [item])
  return item
}

export async function change(mod: Mod<InboxState>, id: string, update: (fresh: Item) => Item): Promise<Item> {
  const item = await updateItem(storeIn(mod.dataFolder), id, update)
  remember(mod, [item])
  return item
}

export function find(mod: Mod<InboxState>, id: string): Item {
  const item = mod.state.memory.items.find((each) => each.id === id)
  if (item === undefined) throw new Error(`The inbox has nothing with the id ${id}. Call read with no id to list what is open.`)
  return item
}

export async function tell(item: Item, text: string, type: 'prompt' | 'note', except?: Author): Promise<number> {
  const receivers = item.subscribers.filter((each) => each.session !== except?.session)
  if (receivers.length === 0) return 0
  const message: SessionSend = { type: type === 'prompt' ? Prompt : Note, text }
  const running = receivers.some((each) => each.session !== sessions.current.id) ? await sessions.list({ running: true, everyProject: true }) : []
  const sent = await Promise.all(
    receivers.map(async (receiver) => {
      if (receiver.session === sessions.current.id) {
        await sessions.current.send(message)
        return true
      }
      const session = running.find((each) => each.id === receiver.session)
      if (session === undefined) return false
      await session.send(message)
      return true
    }),
  )
  return sent.filter(Boolean).length
}
