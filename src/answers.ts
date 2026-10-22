import type { Mod } from '../node_modules/@cmodjs/core/mod.js'
import { find, save, tell } from './actions.js'
import { current, type Answer, type Item, type Status } from './inbox.js'
import type { InboxState } from './state.js'

export type Given = Pick<Answer, 'kind' | 'option' | 'words' | 'target'>

const statusAfter: Readonly<Record<Given['kind'], Status>> = { approve: 'answered', option: 'answered', answer: 'answered', correct: 'corrected', withdraw: 'withdrawn' }

export async function answer(mod: Mod<InboxState>, id: string, given: Given): Promise<void> {
  const item = find(mod, id)
  const revision = item.revisions.length - 1
  const answered: Item = {
    ...item,
    status: statusAfter[given.kind],
    lastRead: revision,
    answers: [...item.answers, { ...given, revision, by: 'person', at: new Date().toISOString() }],
  }
  await save(mod, answered)
  forget(mod, id)
  await tell(answered, messageOf(answered, given), 'prompt')
}

export async function later(mod: Mod<InboxState>, id: string): Promise<void> {
  const item = find(mod, id)
  await save(mod, { ...item, lastRead: item.revisions.length - 1, queuedAt: new Date().toISOString() })
  forget(mod, id)
}

function forget(mod: Mod<InboxState>, id: string): void {
  const { memory } = mod.state
  mod.state.memory.opened = memory.opened.filter((key) => !key.startsWith(`${id}:`))
  if (memory.correcting?.startsWith(`${id}:`)) mod.state.memory.correcting = null
  if (memory.viewing === id) mod.state.memory.viewing = null
}

function messageOf(item: Item, given: Given): string {
  const named = `"${current(item).title}" (${item.id})`
  const words = given.words === undefined ? '' : `: "${given.words}"`
  if (given.kind === 'approve') return `Inbox: the user approved the proposal ${named}${words}`
  if (given.kind === 'option') return `Inbox: the user picked "${given.option ?? ''}" in ${named}${words}`
  if (given.kind === 'answer') return `Inbox: the user answered ${named}${words}`
  if (given.kind === 'withdraw') return `Inbox: the user withdrew ${named}${words}`
  return `Inbox: the user corrected ${named}${given.target === undefined ? '' : ` at "${given.target}"`}${words}. Revise it with the inbox's revise tool.`
}
