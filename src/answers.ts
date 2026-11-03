import type { Mod } from '../node_modules/@cmodjs/core/mod.js'
import { find, rememberPerson, runningSessions, scoped, storeOf } from './actions.js'
import * as core from './items/answers.js'
import { isFollowed, unfollowedWarning } from './items/heard.js'
import { revisionOf, shownOf, type Item, type Note, type Person } from './items/item.js'
import type { InboxState } from './state.js'

const sending = new Set<string>()

export async function answer(mod: Mod<InboxState>, id: string, seen: number, given: core.Given): Promise<void> {
  if (sending.has(id)) return
  sending.add(id)
  try {
    const person = await core.answer(storeOf(mod), id, seen, given)
    rememberPerson(mod, id, person)
    mod.state.session.viewing = core.viewingAfterAnswer(given, id, mod.state.session.viewing)
    if (given.kind === 'correct') stopEditing(mod, id)
    else forget(mod, id)
    const item = find(mod, id)
    if (await isFollowed(item, runningSessions, (line) => mod.log(line))) return
    const { message, description } = unfollowedWarning(item)
    mod.toast.warning(message, { description })
  } catch (error) {
    if (!(error instanceof core.Moved || error instanceof core.NotOffered)) throw error
    mod.toast.warning(error.message)
  } finally {
    sending.delete(id)
  }
}

async function noted(mod: Mod<InboxState>, id: string, person: Promise<Person>): Promise<boolean> {
  try {
    rememberPerson(mod, id, await person)
    return true
  } catch (error) {
    if (!(error instanceof core.Moved)) throw error
    mod.toast.warning(error.message)
    return false
  }
}

export function setNote(mod: Mod<InboxState>, item: Item, path: string, words: string): Promise<boolean> {
  return noted(mod, item.id, core.setNote(storeOf(mod), item, path, revisionOf(item), words))
}

export function dropNote(mod: Mod<InboxState>, item: Item, dropped: Note): Promise<boolean> {
  return noted(mod, item.id, core.dropNote(storeOf(mod), item, dropped.path, dropped.revision))
}

export async function markRead(mod: Mod<InboxState>, item: Item): Promise<void> {
  rememberPerson(mod, item.id, await core.markRead(storeOf(mod), item, revisionOf(item)))
}

export async function view(mod: Mod<InboxState>, id: string, onScreen: boolean): Promise<void> {
  const left = shownOf(scoped(mod), mod.state.memory.person, mod.state.session.viewing)
  mod.state.session.viewing = id
  if (left === undefined || left.id === id) return
  mod.state.session.editing = null
  if (onScreen) await markRead(mod, left)
}

export async function skip(mod: Mod<InboxState>, item: Item, seen: number, next: string): Promise<void> {
  rememberPerson(mod, item.id, await core.skip(storeOf(mod), item, seen))
  await view(mod, next, true)
}

function stopEditing(mod: Mod<InboxState>, id: string): void {
  if (mod.state.session.editing?.startsWith(`${id}:`) === true) mod.state.session.editing = null
}

function forget(mod: Mod<InboxState>, id: string): void {
  stopEditing(mod, id)
  mod.state.session.folds = Object.fromEntries(Object.entries(mod.state.session.folds).filter(([key]) => !key.startsWith(`${id}:`)))
}
