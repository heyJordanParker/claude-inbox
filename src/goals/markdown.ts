import { documentOf, documentText, field, heading, isText, quoted, sectionsOf, tokensOf, wordsOf } from '../items/markdown.js'
import type { Filing, Goals, Quote, Requirement, Source, Task, TaskState } from './goal.js'

type Attributes = Readonly<Record<string, unknown>>

const sources: readonly Source[] = ['prompt', 'answer', 'view']

const states: readonly TaskState[] = ['planned', 'active', 'done', 'dropped']

const isTexts = (value: unknown) => Array.isArray(value) && value.every(isText)

function quoteText({ words, ...quote }: Quote, name: 'quote' | 'correction'): string[] {
  return [heading(3, name, quote), quoted(words)]
}

export function goalsMarkdown(goals: Goals): string {
  return documentText({ format: goals.format, session: goals.session, project: goals.project, updatedAt: goals.updatedAt }, [
    ...goals.requirements.flatMap(({ quotes, ...requirement }) => [heading(2, 'requirement', requirement), ...quotes.flatMap((quote) => quoteText(quote, 'quote'))]),
    ...goals.filings.map((filing) => heading(2, 'filing', filing)),
    ...goals.tasks.flatMap(({ corrections, ...task }) => [heading(2, 'task', task), ...corrections.flatMap((quote) => quoteText(quote, 'correction'))]),
  ])
}

function optional<Each>(attributes: Attributes, key: string, what: string, isValid: (value: unknown) => boolean): Readonly<Record<string, Each>> {
  return attributes[key] === undefined ? {} : { [key]: field<Each>(attributes, key, what, isValid) }
}

function quoteOf(attributes: Attributes, words: string | undefined, what: string): Quote {
  if (words === undefined) throw new Error(`${what} holds no quoted words.`)
  return { words, source: field<Source>(attributes, 'source', what, (value) => sources.includes(value as Source)), id: field<string>(attributes, 'id', what, isText), at: field<string>(attributes, 'at', what, isText) }
}

function filingOf(attributes: Attributes, what: string): Filing {
  const id = field<string>(attributes, 'id', what, isText)
  const source = field<Source>(attributes, 'source', what, (value) => sources.includes(value as Source))
  if (attributes['reason'] !== undefined) return { id, source, reason: field<string>(attributes, 'reason', what, isText) }
  return { id, source, requirements: field<string[]>(attributes, 'requirements', what, isTexts) }
}

function taskOf(attributes: Attributes, what: string, corrections: readonly Quote[]): Task {
  const state = field<TaskState>(attributes, 'state', what, (value) => states.includes(value as TaskState))
  const held = <Each>(key: string, isValid: (value: unknown) => boolean, kind: string): Each => {
    if (attributes[key] === undefined) throw new Error(`${what} has no ${key}, which every ${kind} task holds.`)
    return field<Each>(attributes, key, what, isValid)
  }
  const fields = {
    id: field<string>(attributes, 'id', what, isText),
    title: field<string>(attributes, 'title', what, isText),
    serves: field<string[]>(attributes, 'serves', what, isTexts),
    ...optional<string>(attributes, 'after', what, isText),
    ...optional<string>(attributes, 'waitsOn', what, isText),
    ...optional<string>(attributes, 'cmodTask', what, isText),
    ...(field<boolean>(attributes, 'isRequired', what, (value) => typeof value === 'boolean') ? { template: held<string>('template', isText, 'required'), isRequired: true as const } : { ...optional<string>(attributes, 'template', what, isText), isRequired: false as const }),
    corrections,
  }
  if (state === 'planned') return { ...fields, state }
  if (state === 'active') return { ...fields, state, owner: held<string>('owner', isText, state), startedAt: held<string>('startedAt', isText, state) }
  if (state === 'done') return { ...fields, state, owner: held<string>('owner', isText, state), startedAt: held<string>('startedAt', isText, state), evidence: held<string[]>('evidence', isTexts, state), endedAt: held<string>('endedAt', isText, state) }
  return { ...fields, state, ...optional<string>(attributes, 'owner', what, isText), ...optional<string>(attributes, 'startedAt', what, isText), reason: held<string>('reason', isText, state), endedAt: held<string>('endedAt', isText, state) }
}

export function parseGoals(session: string, text: string): Goals {
  const what = `goals/${session}.md`
  const { fields, body } = documentOf(text, what)
  const { lead, sections } = sectionsOf(tokensOf(body))
  if (lead.some((token) => !('line' in token) || token.line !== '')) throw new Error(`${what} holds text above its first heading.`)
  const requirements: Requirement[] = []
  const filings: Filing[] = []
  const tasks: Task[] = []
  let quotes: Quote[] | undefined
  let corrections: Quote[] | undefined
  sections.forEach((section, index) => {
    const where = `${what} heading ${index + 1}, ${JSON.stringify(section.name)},`
    const words = wordsOf(section.body, where)
    const quoted = section.level !== 3 ? undefined : section.name === 'quote' ? quotes : section.name === 'correction' ? corrections : undefined
    if (quoted !== undefined) {
      quoted.push(quoteOf(section.attributes, words, where))
      return
    }
    if (section.level !== 2) throw new Error(`${where} is a quote under no requirement or a correction under no task.`)
    if (words !== undefined) throw new Error(`${where} holds text, and only a quote or a correction does.`)
    quotes = section.name === 'requirement' ? [] : undefined
    corrections = section.name === 'task' ? [] : undefined
    if (quotes !== undefined) requirements.push({ id: field<string>(section.attributes, 'id', where, isText), capability: field<string>(section.attributes, 'capability', where, isText), line: field<string>(section.attributes, 'line', where, isText), quotes })
    else if (corrections !== undefined) tasks.push(taskOf(section.attributes, where, corrections))
    else if (section.name === 'filing') filings.push(filingOf(section.attributes, where))
    else throw new Error(`${where} is no requirement, filing, or task.`)
  })
  const fileSession = field<string>(fields, 'session', what, isText)
  if (fileSession !== session) throw new Error(`${what} names the session ${fileSession}.`)
  return { format: field<1>(fields, 'format', what, (value) => value === 1), session, project: field<string>(fields, 'project', what, isText), requirements, filings, tasks, updatedAt: field<string>(fields, 'updatedAt', what, isText) }
}
