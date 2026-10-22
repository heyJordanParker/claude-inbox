import type { Mod } from '../node_modules/@cmodjs/core/mod.js'
import { change, tell } from './actions.js'
import { current, type Answer, type Item, type Status } from './inbox.js'
import type { InboxState } from './state.js'

export type Given = Pick<Answer, 'kind' | 'option' | 'words' | 'target'>

const statusAfter: Readonly<Record<Given['kind'], Status>> = { approve: 'answered', option: 'answered', answer: 'answered', correct: 'corrected', withdraw: 'withdrawn' }

class Moved extends Error {}

function unchanged(fresh: Item, seen: number): void {
  if (fresh.status === 'answered' || fresh.status === 'withdrawn') throw new Moved(`"${current(fresh).title}" was ${fresh.status} while you read it.`)
  if (fresh.revisions.length - 1 !== seen) throw new Moved(`"${current(fresh).title}" was revised while you read it. Read the new revision, then answer.`)
}

export async function answer(mod: Mod<InboxState>, id: string, seen: number, given: Given): Promise<void> {
  try {
    const answered = await change(mod, id, (fresh) => {
      unchanged(fresh, seen)
      return {
        ...fresh,
        status: statusAfter[given.kind],
        lastRead: seen,
        answers: [...fresh.answers, { ...given, revision: seen, by: 'person', at: new Date().toISOString() }],
      }
    })
    forget(mod, id)
    const heard = await tell(answered, messageOf(answered, given), 'prompt')
    if (heard === 0) mod.toast.warning(`No running session follows "${current(answered).title}"`, { description: 'Your answer is kept with the item, and an agent reads it with the read tool.' })
  } catch (error) {
    if (!(error instanceof Moved)) throw error
    mod.state.memory.correcting = null
    mod.toast.warning(error.message)
  }
}

export async function later(mod: Mod<InboxState>, id: string, seen: number): Promise<void> {
  await change(mod, id, (fresh) => ({ ...fresh, lastRead: seen, queuedAt: new Date().toISOString() }))
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
