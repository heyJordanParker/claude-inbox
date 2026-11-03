import { current, revisionNumber, senderOf, type Answer, type Item, type Person, type Senders } from './item.js'

type Mark = { readonly at: string; readonly count: number }

type Marks = { readonly item: Mark; readonly person: Mark }

export type Heard = Readonly<Record<string, Marks | Mark>>

export type Told = { readonly kind: 'prompt' | 'note'; readonly file: keyof Marks; readonly at: string; readonly text: string }

export function marksIn(heard: Heard, id: string, start: string): Marks {
  const known = heard[id]
  if (known === undefined) return { item: { at: start, count: 0 }, person: { at: start, count: 0 } }
  return 'at' in known ? { item: known, person: known } : known
}

function noteLines(answer: Answer): string[] {
  return (answer.corrections ?? []).map((each) => `- ${each.target}${each.revision === answer.revision ? '' : ` (written on revision ${revisionNumber(each.revision)})`}: "${each.words}"`)
}

function messageOf(item: Item, answer: Answer, number: number): string {
  const named = `"${item.revisions[answer.revision]?.content.title ?? current(item).title}" (${item.id}), answer ${number}`
  const words = answer.words === undefined ? '' : `: "${answer.words}"`
  const withNotes = (said: string) => (answer.corrections === undefined || answer.corrections.length === 0 ? said : [`${said}, with these notes:`, ...noteLines(answer), 'Apply them as you go.'].join('\n'))
  if (answer.kind === 'approve') return withNotes(`Inbox: the user approved the proposal ${named}${words}`)
  if (answer.kind === 'reject') return withNotes(`Inbox: the user rejected ${item.kind === 'options' ? 'every option in' : `the ${item.kind}`} ${named}`)
  if (answer.kind === 'option') return withNotes(`Inbox: the user picked "${answer.option ?? ''}" in ${named}${words}`)
  if (answer.kind === 'answer') return withNotes(`Inbox: the user answered ${named}${words}`)
  if (answer.kind === 'acknowledge') return withNotes(`Inbox: the user marked the report ${named} done${words}`)
  return [`Inbox: the user requested changes to ${named}:`, ...noteLines(answer), `Revise it with the inbox's revise tool, which keeps the item open for the user.`].join('\n')
}

function toldOf(item: Item, person: Person, session: string, senders: Senders): Told[] {
  const revised = item.revisions.flatMap((revision, index): Told[] => (index === 0 || revision.session === session ? [] : [{ kind: 'note', file: 'item', at: revision.at, text: `${senderOf(revision, item.project, senders).title} revised "${revision.content.title}" (${item.id}) in the inbox.` }]))
  const answered = person.answers.map((answer, index): Told => ({ kind: 'prompt', file: 'person', at: answer.at, text: messageOf(item, answer, index + 1) }))
  const { withdrawal } = item
  const withdrawn: Told[] = withdrawal === undefined || withdrawal.by.session === session ? [] : [{ kind: 'note', file: 'item', at: withdrawal.at, text: `${senderOf(withdrawal.by, item.project, senders).title} withdrew "${current(item).title}" (${item.id}) from the inbox: ${withdrawal.words}` }]
  return [...revised, ...answered, ...withdrawn].sort((a, b) => a.at.localeCompare(b.at))
}

function isAfter(mark: Mark, told: Told, earlier: readonly Told[]): boolean {
  return told.at > mark.at || (told.at === mark.at && earlier.filter((each) => each.file === told.file && each.at === mark.at).length >= mark.count)
}

export function unheard(item: Item, person: Person, session: string, marks: Marks, senders: Senders): Told[] {
  const subscriber = item.subscribers.find((each) => each.session === session)
  if (subscriber === undefined) return []
  const told = toldOf(item, person, session, senders).filter((each) => each.at >= subscriber.since)
  return told.filter((each, index) => isAfter(marks[each.file], each, told.slice(0, index)))
}

export function advanced(heard: Heard, id: string, told: Told, start: string): Heard {
  const marks = marksIn(heard, id, start)
  const mark = marks[told.file]
  return { ...heard, [id]: { ...marks, [told.file]: mark.at === told.at ? { at: told.at, count: mark.count + 1 } : { at: told.at, count: 1 } } }
}

export async function isFollowed(item: Item, running: () => Promise<ReadonlySet<string>>, log: (line: string) => void): Promise<boolean> {
  const sessions = await running().catch((error: unknown) => {
    log(`The answer to ${item.id} is recorded, but the running sessions could not be listed, so no warning says whether a session hears it: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  })
  return sessions === undefined || item.subscribers.some((each) => sessions.has(each.session))
}

export function unfollowedWarning(item: Item): { readonly message: string; readonly description: string } {
  return { message: `No running session follows "${current(item).title}"`, description: 'Your answer is kept with the item, and reaches its session when it resumes.' }
}
