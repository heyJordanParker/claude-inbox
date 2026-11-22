import { messageOf, Note, Prompt, sessions, type Mod, type Session } from '../node_modules/@cmodjs/core/mod.js'
import { addUnfiled, changeGoals } from './actions.js'
import { emptyGoals, nextId, type Goals, type Quote, type Task } from './goals/goal.js'
import type { InboxState } from './state.js'

export type Corrected = { readonly requirement: string } | { readonly task: string }

function viewQuote(words: string): Quote {
  const at = new Date().toISOString()
  return { words, source: 'view', id: `view:${at}`, at }
}

async function tell(text: string, session: Session = sessions.current): Promise<void> {
  await session.send({ type: (await session.turn()) === undefined ? Prompt : Note, text })
}

function changeOwn(mod: Mod<InboxState>, update: (goals: Goals) => Goals): Promise<Goals> {
  const { id, project } = sessions.current
  return changeGoals(mod, id, (fresh) => update(fresh ?? emptyGoals(id, project)))
}

function wordsIn(text: string, what: string): string {
  const words = text.trim()
  if (words === '') throw new Error(`${what} needs words.`)
  return words
}

export async function changeGoal(mod: Mod<InboxState>, text: string): Promise<void> {
  const words = wordsIn(text, 'A goal')
  await sessions.current.goal.update({ text: words })
  const quote = viewQuote(words)
  addUnfiled(mod, { id: quote.id, source: 'view', text: words, at: quote.at })
  await tell([`Inbox: the user set this session's goal: ${JSON.stringify(words)}`, `The user's words in this goal wait to be filed. Call mcp__inbox__file with prompt ${quote.id}.`].join('\n'))
}

export async function addRequirement(mod: Mod<InboxState>, capability: string, words: string): Promise<Goals> {
  const named = wordsIn(capability, "A requirement's capability")
  const quote = viewQuote(wordsIn(words, 'A requirement'))
  const goals = await changeOwn(mod, (fresh) => {
    const id = nextId('r', fresh.requirements)
    return { ...fresh, requirements: [...fresh.requirements, { id, capability: named, line: quote.words, quotes: [quote] }], filings: [...fresh.filings, { id: quote.id, source: 'view', requirements: [id] }] }
  })
  const added = goals.requirements.find((each) => each.quotes.some((kept) => kept.id === quote.id))?.id ?? ''
  await tell(`Inbox: the user added requirement ${added} to ${named}: ${JSON.stringify(quote.words)}`)
  return goals
}

export async function correct(mod: Mod<InboxState>, target: Corrected, words: string): Promise<Goals> {
  const quote = viewQuote(wordsIn(words, 'A correction'))
  const goals = await changeOwn(mod, (fresh) => {
    if ('requirement' in target) {
      const requirement = fresh.requirements.find((each) => each.id === target.requirement)
      if (requirement === undefined) throw new Error(`This session has no requirement ${target.requirement}.`)
      return { ...fresh, requirements: fresh.requirements.map((each) => (each === requirement ? { ...each, quotes: [...each.quotes, quote] } : each)) }
    }
    const task = fresh.tasks.find((each) => each.id === target.task)
    if (task === undefined) throw new Error(`This session has no task ${target.task}.`)
    return { ...fresh, tasks: fresh.tasks.map((each) => (each === task ? { ...each, corrections: [...each.corrections, quote] } : each)) }
  })
  const task = 'task' in target ? goals.tasks.find((each) => each.id === target.task) : undefined
  const owner = task !== undefined && 'owner' in task ? task.owner : undefined
  const named = 'requirement' in target ? `requirement ${target.requirement}, "${goals.requirements.find((each) => each.id === target.requirement)?.line ?? ''}"` : `task ${target.task}, "${task?.title ?? ''}"`
  await tell(`Inbox: the user corrected ${named}: ${JSON.stringify(quote.words)}`, owner === undefined || owner === sessions.current.id ? sessions.current : await sessions.get(owner))
  return goals
}

function reopened({ state, owner, startedAt, evidence, endedAt, waitsOn, cmodTask, ...kept }: Extract<Task, { readonly state: 'done' }>): Task {
  return { ...kept, state: 'planned' }
}

export async function reopen(mod: Mod<InboxState>, task: string): Promise<Goals> {
  const goals = await changeOwn(mod, (fresh) => {
    const done = fresh.tasks.find((each) => each.id === task)
    if (done === undefined || done.state !== 'done') throw new Error(`This session has no done task ${task} to reopen.`)
    return { ...fresh, tasks: fresh.tasks.map((each) => (each === done ? reopened(done) : each)) }
  })
  await tell(`Inbox: the user reopened task ${task}, "${goals.tasks.find((each) => each.id === task)?.title ?? ''}", so it is planned again.`)
  return goals
}

export async function act(mod: Mod<InboxState>, action: () => Promise<unknown>): Promise<boolean> {
  try {
    await action()
    return true
  } catch (error) {
    mod.toast.warning(messageOf(error))
    return false
  }
}

export function isUnfolded(mod: Mod<InboxState>, key: string): boolean {
  return mod.state.session.unfolded.includes(key)
}

export function toggleUnfolded(mod: Mod<InboxState>, key: string): void {
  const { unfolded } = mod.state.session
  mod.state.session.unfolded = unfolded.includes(key) ? unfolded.filter((each) => each !== key) : [...unfolded, key]
}

export function closeField(mod: Mod<InboxState>): void {
  const field = mod.state.session.openField
  if (field === null) return
  mod.state.session.openField = null
  mod.state.session.typed = Object.fromEntries(Object.entries(mod.state.session.typed).filter(([key]) => key !== field && !key.startsWith(`${field}:`)))
}

export async function toggleField(mod: Mod<InboxState>, field: string, focus: (key: string) => Promise<void>, inputKey = field): Promise<void> {
  const isOpen = mod.state.session.openField === field
  closeField(mod)
  if (isOpen) return
  mod.state.session.openField = field
  await focus(inputKey)
}

export async function submitField(mod: Mod<InboxState>, action: () => Promise<unknown>): Promise<void> {
  if (await act(mod, action)) closeField(mod)
}
