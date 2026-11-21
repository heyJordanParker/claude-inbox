import { messageOf, type Mod } from '../node_modules/@cmodjs/core/mod.js'
import { find, listedIn, rememberPerson, shownIn, storeOf, widenTo } from './actions.js'
import * as core from './items/answers.js'
import { isUnheard, unfollowedWarning } from './items/heard.js'
import { nextAfter, revisionOf, type Item, type Kind, type Note, type Person, type Scope } from './items/item.js'
import type { InboxState } from './state.js'

const sending = new Set<string>()

export async function answer(mod: Mod<InboxState>, id: string, seen: number, given: core.Given): Promise<void> {
  if (sending.has(id)) return
  sending.add(id)
  try {
    const item = find(mod, id)
    const next = nextAfter(listedIn(mod), item)
    const person = await core.answer(storeOf(mod), id, seen, given)
    rememberPerson(mod, id, person)
    if (given.kind === 'correct') stopEditing(mod, id)
    else {
      forget(mod, id)
      if (mod.state.session.viewing === id) mod.state.session.viewing = next?.id ?? null
    }
    if (!isUnheard(item, person, mod.state.memory.senders)) return
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

export async function view(mod: Mod<InboxState>, id: string | null, onScreen: boolean): Promise<void> {
  const left = shownIn(mod)
  mod.state.session.viewing = id
  if (left === undefined || left.id === id) return
  setEditing(mod, null)
  forgetTyped(mod, answerInputKey(left.id))
  if (onScreen) await markRead(mod, left)
}

export function back(mod: Mod<InboxState>): Promise<void> {
  return view(mod, null, true)
}

export async function follow(mod: Mod<InboxState>, id: string): Promise<void> {
  widenTo(mod, id)
  await view(mod, id, true)
}

export function filterKind(mod: Mod<InboxState>, kind: Kind | null): void {
  mod.state.session.kind = kind
  mod.state.session.selected = []
}

export function filterScope(mod: Mod<InboxState>, scope: Scope): void {
  mod.state.session.scope = scope
  mod.state.session.selected = []
}

export function selectedIn(mod: Mod<InboxState>): Item[] {
  const { selected } = mod.state.session
  return listedIn(mod).filter((item) => selected.includes(item.id))
}

export function toggleSelected(mod: Mod<InboxState>, id: string): void {
  const kept = selectedIn(mod).map((item) => item.id)
  mod.state.session.selected = kept.includes(id) ? kept.filter((each) => each !== id) : [...kept, id]
}

export function selectAll(mod: Mod<InboxState>, isSelected: boolean): void {
  mod.state.session.selected = isSelected ? listedIn(mod).map((item) => item.id) : []
}

export function clearSelected(mod: Mod<InboxState>): void {
  mod.state.session.selected = []
}

async function eachSelected(mod: Mod<InboxState>, items: readonly Item[], change: (item: Item) => Promise<Person>): Promise<void> {
  const changed = await Promise.allSettled(items.map(async (item) => rememberPerson(mod, item.id, await change(item))))
  mod.state.session.selected = []
  const failed = changed.flatMap((each): unknown[] => (each.status === 'rejected' ? [each.reason] : []))
  const unexpected = failed.find((error) => !(error instanceof core.Moved))
  if (unexpected !== undefined) throw unexpected
  if (failed.length > 0) mod.toast.warning(failed.map(messageOf).join('\n'))
}

export function doneSelected(mod: Mod<InboxState>): Promise<void> {
  const reports = selectedIn(mod).filter((item) => item.kind === 'report')
  return eachSelected(mod, reports, (item) => core.answer(storeOf(mod), item.id, revisionOf(item), { kind: 'acknowledge' }))
}

export function readSelected(mod: Mod<InboxState>): Promise<void> {
  return eachSelected(mod, selectedIn(mod), (item) => core.markRead(storeOf(mod), item, revisionOf(item)))
}

export function noteInputKey(key: string): string {
  return `words:${key}`
}

export function answerInputKey(id: string): string {
  return `answer:${id}`
}

export function setEditing(mod: Mod<InboxState>, key: string | null): void {
  mod.state.session.editing = key
}

export function isWriting(mod: Mod<InboxState>): boolean {
  const { editing, typed } = mod.state.session
  const shown = shownIn(mod)
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
