import { drawnDiagram } from './drawings.js'
import type { Answer, Author, Content, Drawing, Idea, Item, Note, Person, Problem, Shipped, Solution, Status, Withdrawal } from './item.js'

export const format = 7

type Stored = Record<string, unknown>

const statuses: Readonly<Record<string, Status>> = { waiting: 'open', corrected: 'open', open: 'open', answered: 'answered', withdrawn: 'withdrawn' }

function paragraphs(text: unknown): Idea[] {
  return typeof text !== 'string'
    ? []
    : text
        .split(/\n\s*\n/)
        .map((each) => each.trim())
        .filter((each) => each !== '')
        .map((idea) => ({ idea }))
}

function drawingIdea(drawing: Drawing): Idea {
  if (drawing.kind === 'files') return { idea: 'The files it changes.', drawing }
  if (drawing.kind === 'api') return { idea: `The public API of \`${drawing.path}\`.`, drawing }
  if (drawing.kind === 'diff') return { idea: `The change in \`${drawing.path}\`.`, drawing }
  if (drawing.kind === 'table') return { idea: `The stored data in ${drawing.table}.`, drawing }
  if (drawing.kind === 'diagram') return { idea: 'How the parts connect.', drawing }
  return { idea: 'The change in use.', drawing }
}

function solutionOf(stored: Stored): Solution {
  if (Array.isArray(stored['ideas'])) return stored as unknown as Solution
  const capabilities = (stored['capabilities'] as readonly string[] | undefined) ?? []
  const evidence = stored['evidence'] as readonly string[] | undefined
  const problems = stored['problems'] as readonly Stored[] | undefined
  return {
    title: String(stored['title']),
    ...(typeof stored['precedent'] === 'string' ? { precedent: stored['precedent'] } : {}),
    ideas: [
      ...paragraphs(stored['summary']),
      ...paragraphs(stored['idea']),
      ...(capabilities.length === 0 ? [] : [{ idea: capabilities.map((each) => `- ${each}`).join('\n'), ...(evidence === undefined ? {} : { evidence }) }]),
      ...((stored['drawings'] as readonly Drawing[] | undefined) ?? []).map(drawingIdea),
    ],
    ...(problems === undefined ? {} : { problems: problems.map(problemOf) }),
  }
}

function problemOf(stored: Stored): Problem {
  if (Array.isArray(stored['ideas'])) return stored as unknown as Problem
  const solution = stored['solution'] as Stored | undefined
  const problems = stored['problems'] as readonly Stored[] | undefined
  return {
    title: String(stored['title']),
    ideas: [...paragraphs(stored['summary']), ...paragraphs(stored['impact'])],
    ...(solution === undefined ? {} : { solution: solutionOf(solution) }),
    ...(problems === undefined ? {} : { problems: problems.map(problemOf) }),
  }
}

function shippedOf(problem: Problem): Shipped {
  const ideas = (problem.solution?.ideas ?? []) as readonly (Idea & { readonly evidence?: readonly string[] })[]
  const drawing = ideas.find((idea) => idea.drawing !== undefined)?.drawing
  return { title: problem.solution?.title ?? problem.title, ...(drawing === undefined ? {} : { drawing }), evidence: ideas.flatMap((idea) => idea.evidence ?? []) }
}

function changesOf(stored: Stored): Shipped[] {
  if (!Array.isArray(stored['ideas'])) return [stored as unknown as Shipped]
  const ideas = stored['ideas'] as readonly (Idea & { readonly evidence?: readonly string[] })[]
  return [{ title: String(stored['title']), evidence: [] }, ...ideas.map(({ idea, drawing, evidence }) => ({ title: idea, ...(drawing === undefined ? {} : { drawing }), evidence: evidence ?? [] }))]
}

function contentOf(stored: Stored): Content {
  const kind = stored['kind']
  if (kind === 'proposal') return { ...(stored as unknown as Content & { kind: 'proposal' }), problems: (stored['problems'] as readonly Stored[]).map(problemOf) }
  if (kind === 'options') {
    const { title, ideas } = problemOf(stored['problem'] as Stored)
    return { ...(stored as unknown as Content & { kind: 'options' }), problem: { title, ideas }, options: (stored['options'] as readonly Stored[]).map(solutionOf) }
  }
  if (kind === 'report') {
    const { outcome: _, reached: __, problems, changes, ...rest } = stored
    const shipped = Array.isArray(changes) ? (changes as readonly Stored[]).flatMap(changesOf) : ((problems as readonly Stored[] | undefined) ?? []).map(problemOf).map(shippedOf)
    return { ...(rest as unknown as Content & { kind: 'report' }), changes: shipped }
  }
  return stored as unknown as Content
}

function answerOf(stored: Stored, status: unknown): Stored {
  const target = stored['target']
  const { target: _, by: __, ...rest } = stored
  if (stored['kind'] !== 'correct' || Array.isArray(stored['corrections']) || status !== 'corrected') return rest
  const path = typeof target === 'string' ? target : ''
  return { ...rest, corrections: [{ path, target: path === '' ? 'the whole item' : path, words: String(stored['words'] ?? ''), revision: Number(stored['revision']) }] }
}

function answersOf(stored: Stored): Stored[] {
  return ((stored['answers'] as readonly Stored[] | undefined) ?? []).map((answer) => answerOf(answer, stored['status']))
}

function withdrawalOf(stored: Stored): Withdrawal | undefined {
  if (statuses[String(stored['status'])] !== 'withdrawn') return undefined
  const withdrew = ((stored['answers'] as readonly Stored[] | undefined) ?? []).find((answer) => answer['kind'] === 'withdraw') ?? {}
  return {
    kind: 'withdraw',
    words: String(withdrew['words'] ?? ''),
    revision: typeof withdrew['revision'] === 'number' ? withdrew['revision'] : (stored['revisions'] as readonly unknown[]).length - 1,
    by: (withdrew['by'] ?? stored['origin']) as Author,
    at: String(withdrew['at'] ?? stored['updatedAt']),
  }
}

function personFrom(stored: Stored, notes: readonly Note[]): Person {
  const revisions = stored['revisions'] as readonly Stored[]
  return {
    notes,
    answers: answersOf(stored).filter((answer) => answer['kind'] !== 'withdraw') as unknown as Answer[],
    lastRead: typeof stored['lastRead'] === 'number' ? stored['lastRead'] : -1,
    queuedAt: typeof stored['queuedAt'] === 'string' ? stored['queuedAt'] : String(revisions[0]?.['at'] ?? stored['updatedAt']),
  }
}

function drawingsOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(drawingsOf)
  if (value === null || typeof value !== 'object') return value
  const object: Stored = Object.fromEntries(Object.entries(value).map(([key, each]) => [key, drawingsOf(each)]))
  if (object['kind'] === 'screen') return { kind: 'example', language: 'text', code: String(object['sketch']) }
  if (object['kind'] !== 'diagram' || typeof object['drawn'] === 'string') return object
  return { ...object, drawn: drawnDiagram(String(object['mermaid'])) }
}

const firstWithoutPerson = 6

function holdsPersonFields(stored: Stored): boolean {
  return typeof stored['format'] !== 'number' || stored['format'] < firstWithoutPerson
}

function withoutPerson(stored: Stored): Stored {
  const { answers: _, lastRead: __, queuedAt: ___, status: ____, ...rest } = stored
  const withdrawal = withdrawalOf(stored)
  return { ...rest, ...(withdrawal === undefined ? {} : { withdrawal }) }
}

export function authorOf({ session, agent }: Author): Author {
  return { session, ...(agent === undefined ? {} : { agent }) }
}

type Stamped = Omit<Item, 'subscribers' | 'updatedAt' | 'withdrawal'> & {
  readonly subscribers: readonly (Author & { readonly since?: string })[]
  readonly updatedAt?: string
  readonly withdrawal?: Omit<Withdrawal, 'by'> & { readonly by: Author | string }
}

function upgraded(stored: Stored): { readonly item: Item; readonly rejected?: Answer } {
  if (!Array.isArray(stored['revisions'])) throw new Error('it holds no revisions')
  const item = (stored['format'] === format ? stored : withoutPerson(stored)) as unknown as Stamped
  const [first] = item.revisions
  const last = item.revisions.at(-1)
  if (first === undefined || last === undefined) throw new Error('it holds no revisions')
  const { withdrawal } = item
  const byAgent = withdrawal !== undefined && typeof withdrawal.by === 'object' ? { ...withdrawal, by: authorOf(withdrawal.by) } : undefined
  return {
    item: {
      format,
      id: item.id,
      kind: item.kind,
      project: item.project,
      origin: authorOf(item.origin),
      subscribers: item.subscribers.map((each) => ({ ...authorOf(each), since: each.since ?? first.at })),
      revisions: item.revisions.map((revision) => ({ ...authorOf(revision), content: drawingsOf(contentOf(revision.content as unknown as Stored)) as Content, at: revision.at })),
      ...(byAgent === undefined ? {} : { withdrawal: byAgent }),
      updatedAt: item.updatedAt ?? withdrawal?.at ?? last.at,
    },
    ...(withdrawal === undefined || byAgent !== undefined ? {} : { rejected: { kind: 'reject', ...(withdrawal.words === '' ? {} : { words: withdrawal.words }), revision: withdrawal.revision, at: withdrawal.at } }),
  }
}

export function upgradePerson(stored: Stored): Person {
  const person = stored as unknown as Person & { readonly answers: readonly (Answer & { readonly corrections?: readonly (Omit<Note, 'revision'> & { readonly revision?: number })[] })[] }
  return { ...person, answers: person.answers.map((answer) => (answer.corrections === undefined ? answer : { ...answer, corrections: answer.corrections.map((note) => ({ ...note, revision: note.revision ?? answer.revision })) })) }
}

export function mergedPerson(kept: Person | undefined, added: Person | undefined): Person | undefined {
  if (kept === undefined || added === undefined) return kept ?? added
  const answers = added.answers.filter((answer) => !kept.answers.some((each) => each.at === answer.at))
  const notes = added.notes.filter((note) => !kept.notes.some((each) => each.path === note.path && each.revision === note.revision))
  if (answers.length === 0 && notes.length === 0) return kept
  return { ...kept, notes: [...kept.notes, ...notes], answers: [...kept.answers, ...answers].sort((a, b) => a.at.localeCompare(b.at)) }
}

export function converted(stored: Stored, storedPerson: Stored | undefined, notes: readonly Note[]): { readonly item: Item; readonly person: Person | undefined } {
  const { item, rejected } = upgraded(stored)
  const fromItem = holdsPersonFields(stored) ? personFrom(stored, notes) : undefined
  const closed = rejected === undefined ? undefined : { notes: [], answers: [rejected], lastRead: -1, queuedAt: item.revisions[0]?.at ?? item.updatedAt }
  return { item, person: mergedPerson(mergedPerson(storedPerson === undefined ? undefined : upgradePerson(storedPerson), fromItem), closed) }
}
