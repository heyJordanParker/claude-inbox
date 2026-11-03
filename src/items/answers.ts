import { ago, current, plural, revisionOf, statusOf, wording, type Answer, type Item, type Person, type Withdrawal } from './item.js'
import { itemOf, updatePerson, type Store } from './store.js'
import { titlePath } from './tree.js'

export type Given = Pick<Answer, 'option' | 'words'> & { readonly kind: Answer['kind'] }

export class Moved extends Error {}

export class NotOffered extends Error {}

function isOffered(item: Item, person: Person, given: Given): boolean {
  const offered = actionsOf(item, person, { hasNext: false, isCommenting: false }).map(({ does }) => does)
  if (given.kind === 'answer') return offered.includes('answer')
  return offered.some((does) => typeof does === 'object' && does.kind === given.kind && does.option === given.option)
}

function answeredWith(item: Item, person: Person, seen: number, given: Given): Person {
  const status = statusOf(item, person)
  if (status !== 'open') throw new Moved(`"${current(item).title}" was ${status} while you read it.`)
  if (revisionOf(item) !== seen) throw new Moved(`"${current(item).title}" was revised while you read it. Read the new revision, then answer.`)
  if (!isOffered(item, person, given)) throw new NotOffered(given.kind === 'correct' ? 'Write a note before you request changes.' : `"${current(item).title}" does not offer ${given.kind}${given.option === undefined ? '' : ` "${given.option}"`}.`)
  const words = given.words?.trim()
  if (given.kind === 'answer' && (words === undefined || words === '')) throw new NotOffered('Write an answer before you send it.')
  const { notes } = person
  return { ...person, notes: [], lastRead: seen, answers: [...person.answers, { ...given, ...(words === undefined ? {} : { words }), ...(notes.length === 0 ? {} : { corrections: notes }), revision: seen, at: new Date().toISOString() }] }
}

export async function answer(store: Store, id: string, seen: number, given: Given): Promise<Person> {
  const item = await itemOf(store, id)
  return updatePerson(store, item, (person) => answeredWith(item, person, seen, given))
}

function stillOpen(item: Item, person: Person): Person {
  const status = statusOf(item, person)
  if (status !== 'open') throw new Moved(`"${current(item).title}" was ${status} while you wrote the note.`)
  return person
}

export async function setNote(store: Store, item: Item, path: string, revision: number, words: string): Promise<Person> {
  const fresh = await itemOf(store, item.id)
  if (revisionOf(fresh) !== revision) throw new Moved(`"${current(fresh).title}" was revised while you wrote the note. Read the new revision, then write it again.`)
  return updatePerson(store, fresh, (person) => {
    const others = stillOpen(fresh, person).notes.filter((note) => note.path !== path || note.revision !== revision)
    return { ...person, notes: words.trim() === '' ? others : [...others, { path, revision, target: titlePath(current(fresh), path), words: words.trim() }] }
  })
}

export async function dropNote(store: Store, item: Item, path: string, revision: number): Promise<Person> {
  const fresh = await itemOf(store, item.id)
  return updatePerson(store, fresh, (person) => ({ ...person, notes: stillOpen(fresh, person).notes.filter((note) => note.path !== path || note.revision !== revision) }))
}

export function markRead(store: Store, item: Item, seen: number): Promise<Person> {
  return updatePerson(store, item, (fresh) => ({ ...fresh, lastRead: Math.max(fresh.lastRead, seen) }))
}

export async function skip(store: Store, item: Item, seen: number): Promise<Person> {
  return updatePerson(store, item, (fresh) => ({ ...fresh, lastRead: Math.max(fresh.lastRead, seen), queuedAt: new Date().toISOString() }))
}

export type Action = {
  readonly id: string
  readonly label: string
  readonly hotkey?: string
  readonly isPrimary: boolean
  readonly does: Given | 'answer' | 'comment' | 'skip'
}

export function actionsOf(item: Item, person: Person, { hasNext, isCommenting }: { readonly hasNext: boolean; readonly isCommenting: boolean }): Action[] {
  if (statusOf(item, person) !== 'open') return []
  const content = current(item)
  const count = person.notes.length
  const withNotes = count === 0 ? '' : ` with ${plural(count, 'note')}`
  const request: Action[] = count === 0 ? [] : [{ id: 'request', label: `Request changes (${count})`, hotkey: 'r', isPrimary: true, does: { kind: 'correct' } }]
  const closing: Action[] =
    content.kind === 'proposal'
      ? [{ id: 'approve', label: `Approve${withNotes}`, hotkey: 'a', isPrimary: count === 0, does: { kind: 'approve' } }]
      : content.kind === 'report'
        ? [{ id: 'done', label: `Done${withNotes}`, hotkey: 'd', isPrimary: count === 0, does: { kind: 'acknowledge' } }]
        : content.kind === 'options'
          ? content.options.map((option, index) => ({ id: `option${index}`, label: `Pick option ${index + 1}${withNotes}`, ...(index < 9 ? { hotkey: `${index + 1}` } : {}), isPrimary: false, does: { kind: 'option', option: option.title } }))
          : [{ id: 'answer', label: wording.answer, hotkey: 'a', isPrimary: count === 0, does: 'answer' }]
  const reject: Action[] = content.kind === 'report' ? [] : [{ id: 'reject', label: `Reject${withNotes}`, hotkey: 'x', isPrimary: false, does: { kind: 'reject' } }]
  const isCommented = person.notes.some((note) => note.path === '' && note.revision === revisionOf(item))
  const comment: Action[] = isCommented || isCommenting ? [] : [{ id: 'comment', label: 'Comment', hotkey: 'm', isPrimary: false, does: 'comment' }]
  const next: Action[] = hasNext ? [{ id: 'next', label: 'Next →', hotkey: 'n', isPrimary: false, does: 'skip' }] : []
  return [...request, ...closing, ...reject, ...comment, ...next]
}

export function viewingAfterAnswer(given: Given, id: string, viewing: string | null): string | null {
  if (given.kind === 'correct') return id
  return viewing === id ? null : viewing
}
