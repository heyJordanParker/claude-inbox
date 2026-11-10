import type { Mod } from '../node_modules/@cmodjs/core/mod.js'
import { deliveriesIn, find, rememberPerson, scoped, storeOf, widenTo } from './actions.js'
import * as core from './items/answers.js'
import { unfollowedWarning } from './items/heard.js'
import { isFollowed, revisionOf, shownOf, type Item, type Note, type Person } from './items/item.js'
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
    if (isFollowed(item, mod.state.memory.senders)) return
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
  const left = shownOf(scoped(mod), mod.state.memory.person, mod.state.memory.senders, deliveriesIn(mod), mod.state.session.viewing)
  mod.state.session.viewing = id
  if (left === undefined || left.id === id) return
  setEditing(mod, null)
  forgetTyped(mod, answerInputKey(left.id))
  if (onScreen) await markRead(mod, left)
}

export async function follow(mod: Mod<InboxState>, id: string): Promise<void> {
  widenTo(mod, id)
  await view(mod, id, true)
}

export async function skip(mod: Mod<InboxState>, item: Item, seen: number, next: string): Promise<void> {
  rememberPerson(mod, item.id, await core.skip(storeOf(mod), item, seen))
  await view(mod, next, true)
}

export function noteInputKey(key: string): string {
  return `words:${key}`
}

export function answerInputKey(id: string): string {
  return `answer:${id}`
}

export function setEditing(mod: Mod<InboxState>, key: string | null): void {
  const closed = mod.state.session.editing
  mod.state.session.editing = key
  if (closed !== null && closed !== key) forgetTyped(mod, noteInputKey(closed))
}

export function isWriting(mod: Mod<InboxState>): boolean {
  const { editing, typed, viewing } = mod.state.session
  const shown = shownOf(scoped(mod), mod.state.memory.person, mod.state.memory.senders, deliveriesIn(mod), viewing)
  return editing !== null || (shown !== undefined && (typed[answerInputKey(shown.id)] ?? '') !== '')
}

export function setTyped(mod: Mod<InboxState>, inputKey: string, text: string): void {
  mod.state.session.typed = { ...mod.state.session.typed, [inputKey]: text }
}

function forgetTyped(mod: Mod<InboxState>, inputKey: string): void {
  if (!(inputKey in mod.state.session.typed)) return
  mod.state.session.typed = Object.fromEntries(Object.entries(mod.state.session.typed).filter(([key]) => key !== inputKey))
}

function stopEditing(mod: Mod<InboxState>, id: string): void {
  if (mod.state.session.editing?.startsWith(`${id}:`) === true) setEditing(mod, null)
}

function forget(mod: Mod<InboxState>, id: string): void {
  stopEditing(mod, id)
  forgetTyped(mod, answerInputKey(id))
  mod.state.session.folds = Object.fromEntries(Object.entries(mod.state.session.folds).filter(([key]) => !key.startsWith(`${id}:`)))
}
