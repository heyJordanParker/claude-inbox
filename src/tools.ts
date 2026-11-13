import { messageOf, process, sessions, type Job, type Mod, type Tool } from '../node_modules/@cmodjs/core/mod.js'
import { tool } from '../node_modules/@cmodjs/core/jobs/tool.js'
import { author, change, create, find, learnSenders, load, personIn, senderIn, storeOf } from './actions.js'
import { completeContent, type DeclaredContent } from './completion.js'
import { byQueue, closingOf, current, deliveriesOf, isUnnamed, isWithAgent, revisionNumber, revisionOf, statusOf, type Deliveries, type Item, type Kind } from './items/item.js'
import { format } from './items/markdown.js'
import { itemPath, type Check } from './items/store.js'
import { schemas } from './schemas.js'
import type { InboxState } from './state.js'

type Input = Record<string, unknown>

type Execute = (input: Input, mod: Mod<InboxState>) => unknown

const kinds: readonly Kind[] = ['proposal', 'options', 'question', 'report']

function linkOf(mod: Mod<InboxState>, item: Item): string {
  return `[${current(item).title}](file://${itemPath(storeOf(mod), item.id)})`
}

function linkLine(mod: Mod<InboxState>, item: Item): string {
  return `Give the user this link in your reply, which opens it in their Sidebar: ${linkOf(mod, item)}`
}

const rulebookMs = 20_000

function rulebookCheck(mod: Mod<InboxState>, told: string[]): Check {
  return async (id, markdown) => {
    const command = ['rulebook', 'check', `--stdin-file-path=@inbox/${id}.md`]
    const notRun = (why: string) => {
      told.push(`rulebook did not check this item, because ${command.join(' ')} ${why}`)
    }
    const ran = await process.run(command, { stdin: markdown, cwd: mod.folder, timeoutMs: rulebookMs }).catch((error: unknown) => messageOf(error))
    if (typeof ran === 'string') return notRun(`did not run: ${ran}`)
    const said = ran.stdout.trim()
    if (ran.exitCode === 1) throw new Error(said)
    if (ran.exitCode !== 0) return notRun(`exited ${ran.exitCode}: ${ran.stderr.trim()}`)
    if (said !== '') told.push(said)
  }
}

function withTold(answer: string, told: readonly string[]): string {
  return [answer, ...told].join('\n\n')
}

export function inboxTools(loaded: Promise<void>, shown: (mod: Mod<InboxState>, id: string) => void): Job<Tool, InboxState>[] {
  const inboxTool = (name: string, description: string, schema: object, execute: Execute): Job<Tool, InboxState> =>
    tool<{ type: 'object' }, InboxState>({
      name,
      description,
      inputSchema: schema as { type: 'object' },
      execute: async (input, mod) => {
        await loaded
        return execute(input, mod)
      },
    })

  const file = async (mod: Mod<InboxState>, kind: Kind, input: Input): Promise<string> => {
    const { project: given, delivers, ...fields } = input
    const project = typeof given === 'string' ? given.replace(/\/+$/, '') : sessions.current.project
    const declared = { kind, ...fields } as DeclaredContent
    const ids = (delivers as readonly string[] | undefined) ?? []
    if (ids.length > 0) await load(mod)
    const delivered = deliverable(mod, ids)
    const content = await completeContent(declared, project)
    const by = author()
    const now = new Date().toISOString()
    const told: string[] = []
    const item = await create(
      mod,
      declared.title,
      (id) => ({
        format,
        id,
        kind: declared.kind,
        project,
        origin: by,
        subscribers: [{ ...by, since: now }],
        revisions: [{ ...by, content, at: now }],
        ...(delivered.length === 0 ? {} : { delivers: delivered.map((each) => each.id) }),
        updatedAt: now,
      }),
      rulebookCheck(mod, told),
    )
    shown(mod, item.id)
    const finished = delivered.length === 0 ? '' : ` It delivers ${delivered.map((each) => each.id).join(', ')}, which leave the user's list with it.`
    return withTold(`The inbox holds the ${item.kind} "${declared.title}" as ${item.id}, and shows it to the user.${finished} This session is subscribed, so the answer arrives here as a prompt. ${linkLine(mod, item)}`, told)
  }

  return [
    inboxTool(
      'propose',
      'Put a proposal in the inbox: the Problems that block a goal, biggest first, each with the one Solution you would ship. The user approves it, rejects it, or requests changes. Read the proposals Skill first: each idea carries the drawing that shows it, and the inbox draws the files, API, and data from the code.',
      schemas.propose,
      (input, mod) => file(mod, 'proposal', input),
    ),
    inboxTool(
      'propose_options',
      'Put a choice in the inbox: one Problem and two or more specific, good Solutions, and the user picks one or rejects every option. Use it only when each option is one you would ship and only the user can choose between them.',
      schemas.propose_options,
      (input, mod) => file(mod, 'options', input),
    ),
    inboxTool(
      'ask_question',
      'Put one product or Capability question in the inbox, when it comes up. Never a technical question: those are yours to answer.',
      schemas.ask_question,
      (input, mod) => file(mod, 'question', input),
    ),
    inboxTool(
      'report',
      "Put a report in the inbox when work is done: each thing that changed for the user with how you know it works, and the Problems left open. Name in delivers the proposal, choice, or question the work ships and each earlier report this one replaces, so they leave the user's list. The user marks it done or requests changes. Read the proposals Skill first.",
      schemas.report,
      (input, mod) => file(mod, 'report', input),
    ),
    inboxTool(
      'revise',
      'Replace what an open or rejected proposal, choice, or question says with a new revision, after a correction, after a rejection, or when you learn more. A revision reopens a rejected item for the user, so revise it instead of filing a new item. A report is final: file a new report for the next round of work. Any session may revise any open or rejected item, and revising subscribes this session to it. Give the whole item again, under the key of the kind it was filed as: proposal, options, question, or report.',
      schemas.revise,
      async (input, mod) => {
        const known = find(mod, input['id'] as string)
        if (known.kind === 'report') throw new Error(`${known.id} is a report, and a report is final. File a new report for the next round of work.`)
        const given = kinds.filter((each) => input[each] !== undefined)
        if (given.length !== 1 || given[0] !== known.kind) throw new Error(`${known.id} was filed as ${known.kind}, so give exactly one key, ${known.kind}, with the whole item.`)
        const content = await completeContent({ kind: known.kind, ...(input[known.kind] as object) } as DeclaredContent, known.project)
        const by = author()
        const told: string[] = []
        const revised = await change(
          mod,
          known.id,
          (fresh, person) => {
            const status = statusOf(fresh, person)
            if (status !== 'open' && closingOf(fresh, person)?.kind !== 'reject') throw new Error(`${fresh.id} is ${status}. Put a new item in the inbox instead.`)
            if (JSON.stringify(content) === JSON.stringify(current(fresh))) throw new Error(`${fresh.id} already says exactly this as revision ${revisionNumber(revisionOf(fresh))}. Change what it says before you revise it.`)
            const at = new Date().toISOString()
            const subscribers = fresh.subscribers.some((each) => each.session === by.session) ? fresh.subscribers : [...fresh.subscribers, { ...by, since: at }]
            return { ...fresh, subscribers, revisions: [...fresh.revisions, { ...by, content, at }] }
          },
          rulebookCheck(mod, told),
        )
        shown(mod, revised.id)
        return withTold(`Revised ${revised.id} to revision ${revisionNumber(revisionOf(revised))}, and the inbox shows it to the user. ${linkLine(mod, revised)}`, told)
      },
    ),
    inboxTool('withdraw', 'Take an item out of the inbox because it no longer needs an answer.', schemas.withdraw, async (input, mod) => {
      const by = author()
      const reason = input['reason'] as string
      const withdrawn = await change(mod, input['id'] as string, (fresh, person) => {
        const status = statusOf(fresh, person)
        if (status !== 'open') throw new Error(`${fresh.id} is already ${status}.`)
        return { ...fresh, withdrawal: { kind: 'withdraw', words: reason, revision: revisionOf(fresh), by, at: new Date().toISOString() } }
      })
      return `Withdrew ${withdrawn.id}.`
    }),
    inboxTool('subscribe', 'Hear every change to an inbox item in this session: each revision, the answer, and a withdrawal.', schemas.subscribe, async (input, mod) => {
      const by = author()
      let isNew = false
      const item = await change(mod, input['id'] as string, (fresh) => {
        isNew = !fresh.subscribers.some((each) => each.session === by.session)
        return isNew ? { ...fresh, subscribers: [...fresh.subscribers, { ...by, since: new Date().toISOString() }] } : fresh
      })
      return isNew ? `This session now hears every change to ${item.id}.` : `This session already hears ${item.id}.`
    }),
    inboxTool('unsubscribe', 'Stop hearing changes to an inbox item in this session.', schemas.unsubscribe, async (input, mod) => {
      const by = author()
      const item = await change(mod, input['id'] as string, (fresh) => ({ ...fresh, subscribers: fresh.subscribers.filter((each) => each.session !== by.session) }))
      return `This session no longer hears ${item.id}.`
    }),
    inboxTool('read', "Read one inbox item, with every answer the user gave and the revision each answers, or list every open item when you give no id. An answer is the user's call with that revision in front of them, not a rule for later items.", schemas.read, async (input, mod) => {
      await load(mod)
      if (isUnnamed(mod.state.memory.items, mod.state.memory.senders)) await learnSenders(mod)
      const id = input['id'] as string | undefined
      const deliveries = deliveriesOf(mod.state.memory.items)
      if (id === undefined)
        return mod.state.memory.items
          .filter((item) => statusOf(item, personIn(mod, item)) === 'open' && deliveries[item.id] === undefined)
          .sort(byQueue(mod.state.memory.person))
          .map((item) => summaryOf(mod, item, deliveries))
      const item = find(mod, id)
      const closings = [...personIn(mod, item).answers, ...(item.withdrawal === undefined ? [] : [item.withdrawal])].sort((a, b) => a.at.localeCompare(b.at))
      const answers = closings.map((closing) => ({ ...numbered(closing), ...('corrections' in closing && closing.corrections !== undefined ? { corrections: closing.corrections.map(numbered) } : {}) }))
      return { ...summaryOf(mod, item, deliveries), revision: revisionNumber(revisionOf(item)), content: current(item), answers }
    }),
  ]
}

function deliverable(mod: Mod<InboxState>, ids: readonly string[]): Item[] {
  return ids.map((id) => {
    const item = find(mod, id)
    const person = personIn(mod, item)
    if (closingOf(item, person)?.kind === 'reject') throw new Error(`The user rejected ${id}, so this report cannot deliver it. Revise ${id} if the work answers the rejection, or leave it out of delivers.`)
    if (isWithAgent(item, person)) throw new Error(`The user is waiting on your changes to ${id}, so this report cannot deliver it. Revise ${id} with the changes, or leave it out of delivers.`)
    return item
  })
}

function numbered<Each extends { readonly revision: number }>(each: Each): Each {
  return { ...each, revision: revisionNumber(each.revision) }
}

function summaryOf(mod: Mod<InboxState>, item: Item, deliveries: Deliveries) {
  const deliveredBy = deliveries[item.id]?.id
  return {
    id: item.id,
    kind: item.kind,
    status: statusOf(item, personIn(mod, item)),
    ...(deliveredBy === undefined ? {} : { deliveredBy }),
    ...(item.delivers === undefined ? {} : { delivers: item.delivers }),
    title: current(item).title,
    project: item.project,
    origin: senderIn(mod, item, item.origin).title,
    subscribers: item.subscribers.map((each) => senderIn(mod, item, each).title),
    link: linkOf(mod, item),
  }
}
