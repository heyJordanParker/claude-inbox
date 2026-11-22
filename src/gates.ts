import { Note, Person, sessions, type Mod } from '../node_modules/@cmodjs/core/mod.js'
import { addUnfiled, goalsIn, handBack, hasSurfaces, loadAll, loadGoals, loadsFilesOf } from './actions.js'
import { isClosed, isMet, shownState, waitingOn, type Goals, type Quote, type ShownState, type Task, type Unfiled } from './goals/goal.js'
import { current } from './items/item.js'
import type { InboxState } from './state.js'

const checklistTools = /^(TaskCreate|TaskUpdate|TaskList|TaskGet|TodoWrite)$/

export const checklistRefusal =
  "Claude Code's checklist is off in this session, because the user reads your tasks in the inbox. Keep them there: mcp__inbox__plan adds tasks, mcp__inbox__start takes one, mcp__inbox__finish ends it with evidence, mcp__inbox__wait waits on the user's answer or on another task, mcp__inbox__drop drops it with the reason, and mcp__inbox__read with your session id lists them."

type Placed = { readonly goals: Goals; readonly task: Task; readonly state: ShownState }

export function tasksIn(mod: Mod<InboxState>): Placed[] {
  const { items, person } = mod.state.memory
  return Object.values(mod.state.memory.goals).flatMap((goals) => goals.tasks.map((task) => ({ goals, task, state: shownState(task, goals, items, person) })))
}

function placeOf({ goals, task }: Placed): string {
  return goals.session === sessions.current.id ? task.id : `${task.id} of session ${goals.session}`
}

type Pending = { readonly unfiled: readonly Unfiled[]; readonly active: readonly Placed[] }

function pendingOf(mod: Mod<InboxState>, task: string | undefined): Pending {
  const active = tasksIn(mod).filter((each) => each.state === 'active' && each.task.state === 'active' && (task === undefined ? each.task.owner === sessions.current.id && each.task.cmodTask === undefined : each.task.cmodTask === task))
  return { unfiled: task === undefined ? mod.state.session.unfiled : [], active }
}

const firstLineLength = 120

export function firstLineOf(text: string): string {
  const [line = ''] = text.split('\n', 1)
  return line === text && line.length <= firstLineLength ? text : `${line.slice(0, firstLineLength - 1)}…`
}

function pendingLines({ unfiled, active }: Pending): string[] {
  return [
    ...(unfiled.length === 0
      ? []
      : [
          "These words of the user's are not filed into requirements yet:",
          ...unfiled.map((each) => `- ${each.id}: ${JSON.stringify(firstLineOf(each.text))}`),
          'File each with mcp__inbox__file: quote the exact words that ask for something into requirements, or give the reason it asks for nothing.',
        ]),
    ...(active.length === 0
      ? []
      : [
          'These tasks are still active:',
          ...active.map((each) => `- ${placeOf(each)}: ${each.task.title}`),
          'End each with mcp__inbox__finish and its evidence, mcp__inbox__wait on the inbox item you asked the user or on another task, or mcp__inbox__drop with the reason. Give session with a task of another session.',
        ]),
  ]
}

type Stop = { readonly turn: string; readonly pending: string }

const stops = new WeakMap<Mod<InboxState>, Map<string, Stop>>()

function stopAnswer(mod: Mod<InboxState>, task: string | undefined, turn: string): { readonly refuse: string } | undefined {
  const known = stops.get(mod) ?? new Map<string, Stop>()
  stops.set(mod, known)
  const agent = task ?? ''
  const pending = pendingOf(mod, task)
  const key = [...pending.unfiled.map((each) => each.id), ...pending.active.map(({ goals, task: each }) => `${goals.session}/${each.id}`)].join(' ')
  const last = known.get(agent)
  if (key === '') {
    known.delete(agent)
    return undefined
  }
  if (last?.turn === turn && last.pending === key) return undefined
  known.set(agent, { turn, pending: key })
  return { refuse: ['You cannot stop yet.', ...pendingLines(pending), 'If you stop again with these left open, that stop passes and they stay open in the inbox.'].join('\n') }
}

const indent = '    '

function quotedLines(words: string): string[] {
  return words.split('\n').map((line) => `${indent}> ${line}`)
}

function quoteLines(quote: Quote): string[] {
  return [`${indent}${quote.source} ${quote.id}:`, ...quotedLines(quote.words)]
}

function taskLines({ goals, task, state }: Placed): string[] {
  const waiting = state === 'waiting on you' ? ` on ${task.waitsOn}` : state === 'waiting after' ? ` ${task.after}` : ''
  const serves = task.serves.length === 0 ? '' : ` (serves ${task.serves.join(', ')})`
  const where = goals.session === sessions.current.id ? '' : ` (in session ${goals.session})`
  return [`- ${task.id} ${state}${waiting}: ${task.title}${serves}${where}`, ...task.corrections.flatMap((correction) => [`${indent}The user's correction:`, ...quotedLines(correction.words)])]
}

export async function goalNote(mod: Mod<InboxState>, task: string | undefined): Promise<string | undefined> {
  const goal = (await sessions.current.goal.text()).trim()
  const goals = goalsIn(mod)
  const requirements = goals?.requirements ?? []
  const open = tasksIn(mod).filter((each) => (each.goals.session === sessions.current.id ? !isClosed(each.task) : each.task.state === 'active' && each.task.owner === sessions.current.id))
  const unfiled = task === undefined ? mod.state.session.unfiled : []
  if (goal === '' && requirements.length === 0 && open.length === 0 && unfiled.length === 0) return undefined
  return [
    "Inbox: this session's goal, the user's requirements in their exact words, and your open tasks.",
    `Goal: ${goal === '' ? '(none set)' : goal}`,
    ...(requirements.length === 0 ? [] : ['Requirements:', ...requirements.flatMap((each) => [`- ${each.id} ${goals !== undefined && isMet(each, goals) ? 'met' : 'open'}, ${each.capability}: ${each.line}`, ...each.quotes.flatMap(quoteLines)])]),
    ...(open.length === 0 ? [] : ['Open tasks:', ...open.flatMap(taskLines)]),
    ...(unfiled.length === 0 ? [] : ['Not filed yet, so file each with mcp__inbox__file:', ...unfiled.map((each) => `- ${each.id}: ${JSON.stringify(each.text)}`)]),
  ].join('\n')
}

type StartLink = { readonly cmodTask: string; readonly callId: string }

const startLinks = new WeakMap<Mod<InboxState>, Map<string, StartLink>>()

const startKey = (session: unknown, task: unknown) => `${typeof session === 'string' ? session : ''}|${String(task)}`

export function cmodTaskOf(mod: Mod<InboxState>, session: string | undefined, task: string): string | undefined {
  const links = startLinks.get(mod)
  const key = startKey(session, task)
  const linked = links?.get(key)
  links?.delete(key)
  return linked?.cmodTask
}

export function installGates(mod: Mod<InboxState>, loaded: Promise<void>): void {
  const links = new Map<string, StartLink>()
  startLinks.set(mod, links)
  const noted = async (task: string | undefined, isEveryFile = false) => {
    await loaded
    await (isEveryFile ? loadAll(mod) : loadGoals(mod, false))
    const note = await goalNote(mod, task)
    return note === undefined ? undefined : { note }
  }
  sessions.current.goal.beforeSessionStart((start) => noted(start.task, start.task === undefined && start.source !== 'compact'))
  sessions.current.goal.beforePrompt((prompt) => (prompt.task === undefined ? undefined : noted(prompt.task)))
  sessions.current.goal.beforeToolCall({ name: 'mcp__inbox__start' }, (call) => {
    if (call.task !== undefined) links.set(startKey(call.input['session'], call.input['task']), { cmodTask: call.task, callId: call.callId })
  })
  sessions.current.goal.onToolResult({ name: 'mcp__inbox__start' }, (result) => {
    for (const [key, link] of links) if (link.callId === result.callId) links.delete(key)
  })
  sessions.current.goal.onTaskEnd(async (ended) => {
    for (const [key, link] of links) if (link.cmodTask === ended.id) links.delete(key)
    await handBack(mod, (cmodTask) => cmodTask === ended.id)
  })
  sessions.current.goal.onGoalChange(async (goal) => {
    mod.state.memory.goalTexts = { ...mod.state.memory.goalTexts, [sessions.current.id]: await goal.text() }
  })
  void hasSurfaces(mod).then((isShown) => {
    if (!isShown) return
    sessions.current.onPrompt({ from: { type: Person } }, async (prompt) => {
      if (prompt.text === '') return
      addUnfiled(mod, { id: prompt.id, source: 'prompt', text: prompt.text, at: prompt.at })
      await sessions.current.send({ type: Note, text: `Inbox: the user's words in this prompt wait to be filed. Call mcp__inbox__file with prompt ${prompt.id}.` })
    })
    sessions.current.goal.beforeTurnEnd((turn) => (turn.failure === undefined ? stopAnswer(mod, turn.prompt.task, turn.prompt.id) : undefined))
    sessions.current.goal.beforeToolCall({ name: checklistTools }, () => ({ refuse: checklistRefusal }))
  })
}

const waiting = new WeakMap<Mod<InboxState>, ReadonlyMap<string, ReadonlySet<string>>>()

export function toastWaiting(mod: Mod<InboxState>, open: (current: Mod<InboxState>, id: string) => unknown, isFirstLoad = false): void {
  const { items, person } = mod.state.memory
  const loaded = new Set([sessions.current.id, ...Object.keys(mod.state.memory.goals)].filter((session) => loadsFilesOf(mod, session)))
  const now = tasksIn(mod).flatMap((each) => {
    const item = loaded.has(each.goals.session) ? waitingOn(each.task, items, person) : undefined
    return item === undefined ? [] : [{ ...each, item }]
  })
  const keys = new Map([...loaded].map((session) => [session, new Set(now.flatMap((each) => (each.goals.session === session ? [each.task.id] : [])))]))
  const before = isFirstLoad ? keys : (waiting.get(mod) ?? keys)
  waiting.set(mod, keys)
  for (const { goals, task, item } of now) {
    if (before.get(goals.session)?.has(task.id) !== false) continue
    mod.toast.info(`"${task.title}" waits on you`, { description: current(item).title, action: { label: 'Open', onClick: () => void open(mod, item.id) } })
  }
}
