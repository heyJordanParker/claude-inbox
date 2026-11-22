import { Validator } from '@cfworker/json-schema'
import { isObject } from '../items/markdown.js'
import { readFresh, type Stamps, type Store } from '../items/store.js'
import { Invalid, validateSession } from './store.js'

export type Block =
  | { readonly kind: 'bar'; readonly label: string; readonly done: number; readonly total: number }
  | { readonly kind: 'checklist'; readonly label: string; readonly items: readonly { readonly text: string; readonly done: boolean }[] }
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'table'; readonly label?: string; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly preset: 'steps'; readonly label?: string; readonly steps: readonly string[]; readonly current: number }
  | { readonly preset: 'tasks'; readonly label?: string; readonly tasks: readonly { readonly text: string; readonly state: 'planned' | 'active' | 'done' }[] }

export type Progress = { readonly session: string; readonly blocks: readonly Block[]; readonly at: string }

export type Rename = (from: string, to: string) => Promise<void>

const line = (description: string) => ({ type: 'string', pattern: '\\S', description }) as const

const label = line('What the block measures, in a few words, such as "Tests" or "Live check".')

const block = {
  oneOf: [
    {
      type: 'object',
      description: 'A bar that fills done of total, drawn as "Tests ███░░ 121 of 164".',
      properties: {
        kind: { const: 'bar' },
        label,
        done: { type: 'number', minimum: 0, description: 'How many are done, at most total.' },
        total: { type: 'number', exclusiveMinimum: 0, description: 'How many there are.' },
      },
      required: ['kind', 'label', 'done', 'total'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A checklist: one ☑ or ☐ row per check.',
      properties: {
        kind: { const: 'checklist' },
        label,
        items: {
          type: 'array',
          minItems: 1,
          items: { type: 'object', properties: { text: line('The check, such as "answer sends".'), done: { type: 'boolean' } }, required: ['text', 'done'], additionalProperties: false },
        },
      },
      required: ['kind', 'label', 'items'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A note: one finding or status the user should see, such as "Bun\'s stream stalls on writes over 2 MB."',
      properties: { kind: { const: 'note' }, text: line('The note, in one or two plain sentences.') },
      required: ['kind', 'text'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A table: a header row of columns, then each row with one cell per column. The view cuts a cell that does not fit.',
      properties: {
        kind: { const: 'table' },
        label,
        columns: { type: 'array', minItems: 1, items: line('A column name.') },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' }, description: "One cell per column, in the columns' order." } },
      },
      required: ['kind', 'columns', 'rows'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'The steps preset: steps in order, those before current ☑, current in bold, those after it dim.',
      properties: {
        preset: { const: 'steps' },
        label,
        steps: { type: 'array', minItems: 1, items: line('One step, such as "Build".') },
        current: { type: 'integer', minimum: 0, description: 'The step under way, counted from 0. The number of steps means every step is done.' },
      },
      required: ['preset', 'steps', 'current'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'The tasks preset: each task ☑ when done, in bold while active, dim while planned.',
      properties: {
        preset: { const: 'tasks' },
        label,
        tasks: {
          type: 'array',
          minItems: 1,
          items: { type: 'object', properties: { text: line('The task.'), state: { type: 'string', enum: ['planned', 'active', 'done'] } }, required: ['text', 'state'], additionalProperties: false },
        },
      },
      required: ['preset', 'tasks'],
      additionalProperties: false,
    },
  ],
} as const

export const progressInput = {
  type: 'object',
  properties: { blocks: { type: 'array', items: block, description: "Every block of this session's progress, in the order the user reads them. They replace the blocks set before, and an empty list clears them." } },
  required: ['blocks'],
  additionalProperties: false,
} as const

const validator = new Validator(progressInput as object, '2020-12', false)

function problemOf(block: Block): string | undefined {
  if ('preset' in block) return block.preset === 'steps' && block.current > block.steps.length ? `a steps preset whose current step, ${block.current}, is above the number of steps, ${block.steps.length}` : undefined
  if (block.kind === 'bar') return block.done > block.total ? `a bar whose done, ${block.done}, is above its total, ${block.total}` : undefined
  if (block.kind !== 'table') return undefined
  const uneven = block.rows.findIndex((row) => row.length !== block.columns.length)
  return uneven === -1 ? undefined : `a table whose row ${uneven + 1} holds ${block.rows[uneven]?.length} cells, not one for each of its ${block.columns.length} columns`
}

function validateBlocks(blocks: unknown): readonly Block[] {
  const { valid, errors } = validator.validate({ blocks })
  if (!valid) throw new Invalid(`The blocks are not valid:\n${errors.map((error) => `- ${error.instanceLocation}: ${error.error}`).join('\n')}`)
  const checked = blocks as readonly Block[]
  for (const [index, each] of checked.entries()) {
    const problem = problemOf(each)
    if (problem !== undefined) throw new Invalid(`Block ${index + 1} is ${problem}.`)
  }
  return checked
}

const progressFolder = (store: Store): string => `${store.folder}/progress`

export function progressPath(store: Store, session: string): string {
  return `${progressFolder(store)}/${session}.json`
}

function parseProgress(session: string, text: string): Progress {
  const stored: unknown = JSON.parse(text)
  if (!isObject(stored) || stored['session'] !== session || typeof stored['at'] !== 'string') throw new Error(`it does not hold the progress of the session ${session}`)
  return { session, blocks: validateBlocks(stored['blocks']), at: stored['at'] }
}

export async function storedProgress(store: Store, session: string): Promise<Progress | undefined> {
  const path = progressPath(store, session)
  return (await store.disk.exists(path)) ? parseProgress(session, await store.disk.read(path)) : undefined
}

export async function readProgress(store: Store, known: Stamps) {
  const { read, unreadable, stamps } = await readFresh(store, progressFolder(store), known, async (session) => parseProgress(session, await store.disk.read(progressPath(store, session))), { extension: '.json' })
  return { progress: read.map(([, progress]) => progress), unreadable, stamps }
}

export async function setProgress(store: Store, rename: Rename, session: string, blocks: unknown): Promise<Progress> {
  const progress: Progress = { session: validateSession(session), blocks: validateBlocks(blocks), at: new Date().toISOString() }
  const path = progressPath(store, session)
  const partial = `${path}.${Math.random().toString(36).slice(2)}.tmp`
  await store.disk.write(partial, `${JSON.stringify(progress)}\n`)
  await rename(partial, path)
  return progress
}
