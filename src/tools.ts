import { sessions, type Job, type Mod, type Tool } from '../node_modules/@cmodjs/core/mod.js'
import { tool } from '../node_modules/@cmodjs/core/jobs/tool.js'
import { author, change, create, find, tell } from './actions.js'
import { completeContent, type DeclaredContent } from './drawings.js'
import { current, type Item, type Kind } from './inbox.js'
import { schemas } from './schemas.js'
import type { InboxState } from './state.js'

type Input = Record<string, unknown>

type Execute = (input: Input, mod: Mod<InboxState>) => unknown

function inboxTool(loaded: Promise<void>, name: string, description: string, schema: object, execute: Execute): Job<Tool, InboxState> {
  return tool<{ type: 'object' }, InboxState>({
    name,
    description,
    inputSchema: schema as { type: 'object' },
    execute: async (input, mod) => {
      await loaded
      return execute(input, mod)
    },
  })
}

const kindWords: Readonly<Record<Kind, string>> = { proposal: 'proposal', options: 'options', question: 'question' }

function isClosed(item: Item): boolean {
  return item.status === 'answered' || item.status === 'withdrawn'
}

async function file(mod: Mod<InboxState>, declared: DeclaredContent): Promise<string> {
  const project = sessions.current.project
  const content = await completeContent(declared, project)
  const by = await author()
  const now = new Date().toISOString()
  const item = await create(mod, declared.title, (id) => ({
    id,
    kind: declared.kind,
    project,
    origin: by,
    subscribers: [by],
    revisions: [{ ...by, content, at: now }],
    answers: [],
    lastRead: -1,
    queuedAt: now,
    updatedAt: now,
    status: 'waiting',
  }))
  return `The inbox holds the ${kindWords[item.kind]} "${declared.title}" as ${item.id}. This session is subscribed, so the answer arrives here as a prompt. Revise it with the revise tool when it is corrected.`
}

function summaryOf(item: Item) {
  const content = current(item)
  return { id: item.id, kind: item.kind, status: item.status, title: content.title, project: item.project, origin: item.origin.title, subscribers: item.subscribers.map((each) => each.title) }
}

export function inboxTools(loaded: Promise<void>): Job<Tool, InboxState>[] {
  return [
    inboxTool(
      loaded,
      'propose',
      'Put a proposal in the inbox: the Problems that block a goal, biggest first, each with the one Solution you would ship. The person approves it or corrects it. Declare the Architecture each Solution changes as drawings, and the inbox draws it from the code.',
      schemas.propose,
      (input, mod) => file(mod, { kind: 'proposal', ...input } as DeclaredContent),
    ),
    inboxTool(
      loaded,
      'propose_options',
      'Put a choice in the inbox: one Problem and two or more specific, good Solutions, and the person picks one. Use it only when each option is one you would ship and only the person can choose between them.',
      schemas.propose_options,
      (input, mod) => file(mod, { kind: 'options', ...input } as DeclaredContent),
    ),
    inboxTool(
      loaded,
      'ask_question',
      'Put one product or Capability question in the inbox, when it comes up. Never a technical question: those are yours to answer.',
      schemas.ask_question,
      (input, mod) => file(mod, { kind: 'question', ...input } as DeclaredContent),
    ),
    inboxTool(
      loaded,
      'revise',
      'Replace what an inbox item says with a new revision, after a correction or when you learn more. Any session may revise any open item. Give the whole item again, under the key of the kind it was filed as: proposal, options, or question.',
      schemas.revise,
      async (input, mod) => {
        const known = find(mod, input['id'] as string)
        const kinds = (['proposal', 'options', 'question'] as const).filter((each) => input[each] !== undefined)
        if (kinds.length !== 1 || kinds[0] !== known.kind) throw new Error(`${known.id} is a ${kindWords[known.kind]}, so give exactly one key, ${known.kind}, with the whole item.`)
        const content = await completeContent({ kind: known.kind, ...(input[known.kind] as object) } as DeclaredContent, known.project)
        const by = await author()
        const revised = await change(mod, known.id, (fresh) => {
          if (isClosed(fresh)) throw new Error(`${fresh.id} is ${fresh.status}. Put a new item in the inbox instead.`)
          return { ...fresh, revisions: [...fresh.revisions, { ...by, content, at: new Date().toISOString() }], status: 'waiting' }
        })
        await tell(revised, `${by.title} revised "${content.title}" (${revised.id}) in the inbox.`, 'note', by)
        return `Revised ${revised.id}. It waits for the person again.`
      },
    ),
    inboxTool(loaded, 'withdraw', 'Take an item out of the inbox because it no longer needs an answer.', schemas.withdraw, async (input, mod) => {
      const by = await author()
      const reason = input['reason'] as string
      const withdrawn = await change(mod, input['id'] as string, (fresh) => {
        if (isClosed(fresh)) throw new Error(`${fresh.id} is already ${fresh.status}.`)
        return { ...fresh, status: 'withdrawn', answers: [...fresh.answers, { kind: 'withdraw', words: reason, revision: fresh.revisions.length - 1, by, at: new Date().toISOString() }] }
      })
      await tell(withdrawn, `${by.title} withdrew "${current(withdrawn).title}" (${withdrawn.id}) from the inbox: ${reason}`, 'note', by)
      return `Withdrew ${withdrawn.id}.`
    }),
    inboxTool(loaded, 'subscribe', 'Hear every change to an inbox item in this session: each revision, the answer, and a withdrawal.', schemas.subscribe, async (input, mod) => {
      const by = await author()
      let isNew = false
      const item = await change(mod, input['id'] as string, (fresh) => {
        isNew = !fresh.subscribers.some((each) => each.session === by.session)
        return isNew ? { ...fresh, subscribers: [...fresh.subscribers, by] } : fresh
      })
      return isNew ? `This session now hears every change to ${item.id}.` : `This session already hears ${item.id}.`
    }),
    inboxTool(loaded, 'unsubscribe', 'Stop hearing changes to an inbox item in this session.', schemas.unsubscribe, async (input, mod) => {
      const by = await author()
      const item = await change(mod, input['id'] as string, (fresh) => ({ ...fresh, subscribers: fresh.subscribers.filter((each) => each.session !== by.session) }))
      return `This session no longer hears ${item.id}.`
    }),
    inboxTool(loaded, 'read', "Read one inbox item, with every answer the person gave and the revision each answers, or list every open item when you give no id. An answer is the person's call with that revision in front of them, not a rule for later items.", schemas.read, (input, mod) => {
      const id = input['id'] as string | undefined
      if (id === undefined) return mod.state.memory.items.filter((each) => !isClosed(each)).map(summaryOf)
      const item = find(mod, id)
      return { ...summaryOf(item), revision: item.revisions.length - 1, content: current(item), answers: item.answers }
    }),
  ]
}
