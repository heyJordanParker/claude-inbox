import { sessions, type Job, type Mod, type Tool } from '../node_modules/@cmodjs/core/mod.js'
import { tool } from '../node_modules/@cmodjs/core/jobs/tool.js'
import { author, find, save, tell } from './actions.js'
import { completeContent, type DeclaredContent } from './drawings.js'
import { current, newId, type Item, type Kind } from './inbox.js'
import { schemas } from './schemas.js'
import type { InboxState } from './state.js'

type Input = Record<string, unknown>

function inboxTool(name: string, description: string, schema: object, execute: (input: Input, mod: Mod<InboxState>) => unknown): Job<Tool, InboxState> {
  return tool<{ type: 'object' }, InboxState>({ name, description, inputSchema: schema as { type: 'object' }, execute: (input, mod) => execute(input, mod) })
}

const kindWords: Readonly<Record<Kind, string>> = { proposal: 'proposal', options: 'options', question: 'question' }

async function file(mod: Mod<InboxState>, declared: DeclaredContent): Promise<string> {
  const content = await completeContent(declared, sessions.current.project)
  const by = author()
  const now = new Date().toISOString()
  const item: Item = {
    id: newId(declared.title, mod.state.memory.items.map((each) => each.id)),
    kind: declared.kind,
    project: sessions.current.project,
    origin: by,
    subscribers: [by],
    revisions: [{ ...by, content, at: now }],
    answers: [],
    lastRead: -1,
    queuedAt: now,
    status: 'waiting',
  }
  await save(mod, item)
  return `The inbox holds the ${kindWords[item.kind]} "${declared.title}" as ${item.id}. This session is subscribed, so the answer arrives here as a prompt. Revise it with the revise tool when it is corrected.`
}

function summaryOf(item: Item) {
  const content = current(item)
  return { id: item.id, kind: item.kind, status: item.status, title: content.title, project: item.project, origin: item.origin.title, subscribers: item.subscribers.map((each) => each.title) }
}

export function inboxTools(): Job<Tool, InboxState>[] {
  return [
    inboxTool(
      'propose',
      'Put a proposal in the inbox: the Problems that block a goal, biggest first, each with the one Solution you would ship. The person approves it or corrects it. Declare the Architecture each Solution changes as drawings, and the inbox draws it from the code.',
      schemas.propose,
      (input, mod) => file(mod, { kind: 'proposal', ...input } as DeclaredContent),
    ),
    inboxTool(
      'propose_options',
      'Put a choice in the inbox: one Problem and two or more specific, good Solutions, and the person picks one. Use it only when each option is one you would ship and only the person can choose between them.',
      schemas.propose_options,
      (input, mod) => file(mod, { kind: 'options', ...input } as DeclaredContent),
    ),
    inboxTool(
      'ask_question',
      'Put one product or Capability question in the inbox, when it comes up. Never a technical question: those are yours to answer.',
      schemas.ask_question,
      (input, mod) => file(mod, { kind: 'question', ...input } as DeclaredContent),
    ),
    inboxTool(
      'revise',
      'Replace what an inbox item says with a new revision, after a correction or when you learn more. Any session may revise any open item. Give the whole item again, in the same kind it was filed as.',
      schemas.revise,
      async (input, mod) => {
        const item = find(mod, input['id'] as string)
        if (item.status === 'answered' || item.status === 'withdrawn') throw new Error(`${item.id} is ${item.status}. Put a new item in the inbox instead.`)
        const kind = (['proposal', 'options', 'question'] as const).find((each) => input[each] !== undefined)
        if (kind !== item.kind) throw new Error(`${item.id} is a ${kindWords[item.kind]}, so revise it with ${item.kind}.`)
        const content = await completeContent({ kind, ...(input[kind] as object) } as DeclaredContent, item.project)
        const by = author()
        const revised: Item = { ...item, revisions: [...item.revisions, { ...by, content, at: new Date().toISOString() }], status: 'waiting' }
        await save(mod, revised)
        await tell(revised, `${by.title} revised "${content.title}" (${item.id}) in the inbox.`, 'note', by)
        return `Revised ${item.id}. It waits for the person again.`
      },
    ),
    inboxTool('withdraw', 'Take an item out of the inbox because it no longer needs an answer.', schemas.withdraw, async (input, mod) => {
      const item = find(mod, input['id'] as string)
      if (item.status === 'answered' || item.status === 'withdrawn') throw new Error(`${item.id} is already ${item.status}.`)
      const by = author()
      const withdrawn: Item = {
        ...item,
        status: 'withdrawn',
        answers: [...item.answers, { kind: 'withdraw', words: input['reason'] as string, revision: item.revisions.length - 1, by, at: new Date().toISOString() }],
      }
      await save(mod, withdrawn)
      await tell(withdrawn, `${by.title} withdrew "${current(item).title}" (${item.id}) from the inbox: ${input['reason'] as string}`, 'note', by)
      return `Withdrew ${item.id}.`
    }),
    inboxTool('subscribe', 'Hear every change to an inbox item in this session: each revision, the answer, and a withdrawal.', schemas.subscribe, async (input, mod) => {
      const item = find(mod, input['id'] as string)
      const by = author()
      if (item.subscribers.some((each) => each.session === by.session)) return `This session already hears ${item.id}.`
      await save(mod, { ...item, subscribers: [...item.subscribers, by] })
      return `This session now hears every change to ${item.id}.`
    }),
    inboxTool('unsubscribe', 'Stop hearing changes to an inbox item in this session.', schemas.unsubscribe, async (input, mod) => {
      const item = find(mod, input['id'] as string)
      const by = author()
      await save(mod, { ...item, subscribers: item.subscribers.filter((each) => each.session !== by.session) })
      return `This session no longer hears ${item.id}.`
    }),
    inboxTool('read', "Read one inbox item, with every answer the person gave and the revision each answers, or list every open item when you give no id. An answer is the person's call with that revision in front of them, not a rule for later items.", schemas.read, (input, mod) => {
      const id = input['id'] as string | undefined
      if (id === undefined) return mod.state.memory.items.filter((each) => each.status === 'waiting' || each.status === 'corrected').map(summaryOf)
      const item = find(mod, id)
      return { ...summaryOf(item), revision: item.revisions.length - 1, content: current(item), answers: item.answers }
    }),
  ]
}
