import { Note, Prompt, sessions, type Mod, type SessionSend } from '../node_modules/@cmodjs/core/mod.js'
import { readItems, storeIn, writeItem, type Author, type Item } from './inbox.js'
import type { InboxState } from './state.js'

export function author(): Author {
  const { id, title, agentType } = sessions.current
  return { session: id, title: title || id, ...(agentType === undefined ? {} : { agent: agentType }) }
}

export async function load(mod: Mod<InboxState>): Promise<void> {
  mod.state.memory.items = await readItems(storeIn(mod.dataFolder))
}

export async function save(mod: Mod<InboxState>, item: Item): Promise<void> {
  await writeItem(storeIn(mod.dataFolder), item)
  const others = mod.state.memory.items.filter((each) => each.id !== item.id)
  mod.state.memory.items = [...others, item].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

export function find(mod: Mod<InboxState>, id: string): Item {
  const item = mod.state.memory.items.find((each) => each.id === id)
  if (item === undefined) throw new Error(`The inbox has nothing with the id ${id}. Call read with no id to list what is open.`)
  return item
}

export async function tell(item: Item, text: string, type: 'prompt' | 'note', except?: Author): Promise<void> {
  const receivers = item.subscribers.filter((each) => each.session !== except?.session)
  if (receivers.length === 0) return
  const message: SessionSend = { type: type === 'prompt' ? Prompt : Note, text }
  const others = receivers.some((each) => each.session !== sessions.current.id) ? await sessions.list({ running: true, everyProject: true }) : []
  await Promise.all(
    receivers.map(async (receiver) => {
      if (receiver.session === sessions.current.id) return sessions.current.send(message)
      return others.find((session) => session.id === receiver.session)?.send(message)
    }),
  )
}
