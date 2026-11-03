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

function contentOf(stored: Stored): Content {
  const kind = stored['kind']
  if (kind === 'proposal') return { ...(stored as unknown as Content & { kind: 'proposal' }), problems: (stored['problems'] as readonly Stored[]).map(problemOf) }
  if (kind === 'options') {
    const { title, ideas } = problemOf(stored['problem'] as Stored)
    return { ...(stored as unknown as Content & { kind: 'options' }), problem: { title, ideas }, options: (stored['options'] as readonly Stored[]).map(solutionOf) }
  }
  if (kind === 'report') {
    const { outcome: _, reached: __, problems, changes, ...rest } = stored
    const shipped = Array.isArray(changes) ? (changes as readonly Shipped[]) : ((problems as readonly Stored[] | undefined) ?? []).map(problemOf).map(shippedOf)
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

export function personFrom(stored: Stored, notes: readonly Note[]): Person {
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

export function holdsPersonFields(stored: Stored): boolean {
  return typeof stored['format'] !== 'number' || stored['format'] < firstWithoutPerson
}

function withoutPerson(stored: Stored): Stored {
  const revisions = (stored['revisions'] as readonly Stored[]).map((revision) => ({ ...revision, content: drawingsOf(contentOf(revision['content'] as Stored)) }))
  const { answers: _, lastRead: __, queuedAt: ___, status: ____, ...rest } = stored
  const withdrawal = withdrawalOf(stored)
  return { ...rest, revisions, ...(withdrawal === undefined ? {} : { withdrawal }) }
}

export function upgrade(stored: Stored): Item {
  if (stored['format'] === format) return stored as unknown as Item
  const item = withoutPerson(stored) as unknown as Omit<Item, 'subscribers'> & { readonly subscribers: readonly (Author & { readonly since?: string })[] }
  const filedAt = item.revisions[0]?.at ?? item.updatedAt
  return { ...item, format, subscribers: item.subscribers.map((each) => ({ ...each, since: each.since ?? filedAt })) }
}
