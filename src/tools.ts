import { fs, messageOf, process, sessions, type Job, type Mod, type Tool } from '../node_modules/@cmodjs/core/mod.js'
import { tool } from '../node_modules/@cmodjs/core/jobs/tool.js'
import { author, change, changeGoals, create, find, learnSessions, load, loadGoalsOf, personIn, ran, rememberProgress, senderIn, storeOf } from './actions.js'
import { completeContent, type DeclaredContent } from './completion.js'
import { cmodTaskOf, firstLineOf } from './gates.js'
import { counts, emptyGoals, isClosed, isMet, nextId, shownState, type Goals, type Task } from './goals/goal.js'
import { setProgress, type Rename } from './goals/progress.js'
import { parseTemplate, templatePaths, type TemplateTask } from './goals/templates.js'
import { byNewest, closingOf, current, deliveriesOf, isRunning, isUnnamed, isWithAgent, kinds, revisionNumber, revisionOf, statusOf, type Deliveries, type Item, type Kind } from './items/item.js'
import { format } from './items/markdown.js'
import { itemPath, type Check } from './items/store.js'
import { schemas } from './schemas.js'
import type { InboxState } from './state.js'

type Input = Record<string, unknown>

type Execute<Schema extends object> = Parameters<typeof tool<Schema, InboxState>>[0]['execute']

type InboxTool = <Schema extends object>(name: string, description: string, schema: Schema, execute: Execute<Schema>, isDeferred?: boolean) => Job<Tool, InboxState>

const untyped = (schema: object) => schema as { readonly type: 'object' }

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
      told.push(`rulebook did not check this ${id.startsWith('goals/') ? 'goals write' : 'item'}, because ${command.join(' ')} ${why}`)
    }
    const checked = await process.run(command, { stdin: markdown, cwd: mod.folder, timeoutMs: rulebookMs }).catch((error: unknown) => messageOf(error))
    if (typeof checked === 'string') return notRun(`did not run: ${checked}`)
    const said = checked.stdout.trim()
    if (checked.exitCode === 1) throw new Error(said)
    if (checked.exitCode !== 0) return notRun(`exited ${checked.exitCode}: ${checked.stderr.trim()}`)
    if (said !== '') told.push(said)
  }
}

function withTold(answer: string, told: readonly string[]): string {
  return [answer, ...told].join('\n\n')
}

export function inboxTools(loaded: Promise<void>, shown: (mod: Mod<InboxState>, id: string) => void): Job<Tool, InboxState>[] {
  const inboxTool: InboxTool = (name, description, schema, execute, isDeferred) =>
    tool<typeof schema, InboxState>({
      name,
      description,
      inputSchema: schema,
      ...(isDeferred === undefined ? {} : { isDeferred }),
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
      untyped(schemas.propose),
      (input, mod) => file(mod, 'proposal', input),
    ),
    inboxTool(
      'propose_options',
      'Put a choice in the inbox: one Problem and two or more specific, good Solutions, and the user picks one or rejects every option. Use it only when each option is one you would ship and only the user can choose between them.',
      untyped(schemas.propose_options),
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
      untyped(schemas.report),
      (input, mod) => file(mod, 'report', input),
    ),
    inboxTool(
      'revise',
      'Replace what an open or rejected proposal, choice, or question says with a new revision, after a correction, after a rejection, or when you learn more. A revision reopens a rejected item for the user, so revise it instead of filing a new item. A report is final: file a new report for the next round of work. Any session may revise any open or rejected item, and revising subscribes this session to it. Give the whole item again, under the key of the kind it was filed as: proposal, options, question, or report.',
      untyped(schemas.revise),
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
      const withdrawn = await change(mod, input.id, (fresh, person) => {
        const status = statusOf(fresh, person)
        if (status !== 'open') throw new Error(`${fresh.id} is already ${status}.`)
        return { ...fresh, withdrawal: { kind: 'withdraw', words: input.reason, revision: revisionOf(fresh), by, at: new Date().toISOString() } }
      })
      return `Withdrew ${withdrawn.id}.`
    }),
    inboxTool('subscribe', 'Hear every change to an inbox item in this session: each revision, the answer, and a withdrawal.', schemas.subscribe, async (input, mod) => {
      const by = author()
      let isNew = false
      const item = await change(mod, input.id, (fresh) => {
        isNew = !fresh.subscribers.some((each) => each.session === by.session)
        return isNew ? { ...fresh, subscribers: [...fresh.subscribers, { ...by, since: new Date().toISOString() }] } : fresh
      })
      return isNew ? `This session now hears every change to ${item.id}.` : `This session already hears ${item.id}.`
    }),
    inboxTool('unsubscribe', 'Stop hearing changes to an inbox item in this session.', schemas.unsubscribe, async (input, mod) => {
      const by = author()
      const item = await change(mod, input.id, (fresh) => ({ ...fresh, subscribers: fresh.subscribers.filter((each) => each.session !== by.session) }))
      return `This session no longer hears ${item.id}.`
    }),
    inboxTool('read', "Read one inbox item, with every answer the user gave and the revision each answers, or list every open item when you give no id. An answer is the user's call with that revision in front of them, not a rule for later items. With session, read that session's goal, the user's requirements in their exact words, and its tasks, such as to take a planned task of another session with start.", schemas.read, async (input, mod) => {
      await load(mod)
      if (isUnnamed(mod.state.memory.items, mod.state.memory.senders)) await learnSessions(mod)
      const { id, session: shown } = input
      if (shown !== undefined) {
        if (id !== undefined) throw new Error('Give id to read an item, or session to read a session, never both.')
        return sessionSummary(mod, shown)
      }
      const deliveries = deliveriesOf(mod.state.memory.items)
      if (id === undefined)
        return mod.state.memory.items
          .filter((item) => statusOf(item, personIn(mod, item)) === 'open' && deliveries[item.id] === undefined)
          .sort(byNewest)
          .map((item) => summaryOf(mod, item, deliveries))
      const item = find(mod, id)
      const closings = [...personIn(mod, item).answers, ...(item.withdrawal === undefined ? [] : [item.withdrawal])].sort((a, b) => a.at.localeCompare(b.at))
      const answers = closings.map((closing) => ({ ...numbered(closing), ...('corrections' in closing && closing.corrections !== undefined ? { corrections: closing.corrections.map(numbered) } : {}) }))
      return { ...summaryOf(mod, item, deliveries), revision: revisionNumber(revisionOf(item)), content: current(item), answers }
    }),
    ...goalsTools(inboxTool),
    inboxTool(
      'progress',
      "Set this session's progress: the bars, checklists, notes, tables, and presets the user reads on the Tasks view beside the session. Call it each time the progress changes, with every block, because each call replaces the blocks set before. The user sees progress there and never in the chat, so leave it out of your replies. A long command, such as a test run, updates it while it runs with `inbox progress '<blocks JSON>'`, which takes the same list of blocks.",
      schemas.progress,
      async (input, mod) => {
        rememberProgress(mod, await setProgress(storeOf(mod), rename, sessions.current.id, input['blocks']))
        return "Set this session's progress."
      },
    ),
  ]
}

const rename: Rename = (from, to) => ran(['mv', '-f', from, to])

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

const singleSpaced = (text: string) => text.replace(/\s+/g, ' ').trim()

const wordCharacter = /[\p{L}\p{N}]/u

const isWordCharacter = (character: string | undefined) => character !== undefined && wordCharacter.test(character)

function isQuoteOf(text: string, quote: string): boolean {
  const words = singleSpaced(text)
  const quoted = singleSpaced(quote)
  if (!wordCharacter.test(quoted)) return false
  for (let at = words.indexOf(quoted); at !== -1; at = words.indexOf(quoted, at + 1)) {
    const isCutBefore = isWordCharacter(words[at - 1]) && isWordCharacter(quoted[0])
    const isCutAfter = isWordCharacter(words[at + quoted.length]) && isWordCharacter(quoted.at(-1))
    if (!isCutBefore && !isCutAfter) return true
  }
  return false
}

const whose = (session: string) => (session === sessions.current.id ? 'This session' : `Session ${session}`)

function requirementList(goals: Goals): string {
  return goals.requirements.length === 0 ? 'This session has no requirements yet: file the user\'s words with file first.' : `The requirements are ${goals.requirements.map((each) => `${each.id} (${each.line})`).join(', ')}.`
}

function standing(mod: Mod<InboxState>, goals: Goals): string {
  const { met, requirements, done, tasks } = counts(goals, mod.state.memory.items, mod.state.memory.person)
  return `${done} of ${tasks} tasks done, ${met} of ${requirements} requirements met.`
}

function refusalOf(task: Task, action: 'start' | 'finish' | 'wait on' | 'drop'): string {
  if (task.state === 'done') return `${task.id} is done. Only the user reopens a done task, from the Tasks view.`
  if (task.state === 'dropped') return `${task.id} was dropped: ${task.reason}. Plan a new task instead.`
  if (task.state === 'active') return `${task.id} is active already, taken by session ${task.owner}.`
  return `${task.id} is planned. Take it with start before you ${action === 'wait on' ? 'wait' : action} it.`
}

function refuseTakenElsewhere(mod: Mod<InboxState>, task: Task, action: 'finish it' | 'make it wait' | 'drop it'): void {
  if (task.state === 'active' && task.owner !== sessions.current.id && isRunning(task.owner, mod.state.memory.senders)) throw new Error(`${task.id} is active in session ${task.owner}, which took it and still runs, so only that session can ${action}.`)
}

function isChainedTo(goals: Goals, from: string, target: string): boolean {
  let at = goals.tasks.find((each) => each.id === from)
  for (let steps = 0; at !== undefined && steps <= goals.tasks.length; steps += 1) {
    if (at.id === target) return true
    const after = at.after
    at = after === undefined ? undefined : goals.tasks.find((each) => each.id === after)
  }
  return false
}

async function templateOf(project: string, name: string): Promise<TemplateTask[]> {
  const paths = templatePaths(project, name)
  for (const path of paths) if (await fs.exists(path)) return parseTemplate(await fs.read(path), path)
  throw new Error(`There is no template ${name}. A template is a Markdown task list, such as "- [ ] Run the suite (required)", at ${paths.join(' or ')}.`)
}

function taskIn(goals: Goals, id: string): Task {
  const task = goals.tasks.find((each) => each.id === id)
  if (task === undefined) throw new Error(`${whose(goals.session)} has no task ${id}. Call read with session ${goals.session} to list its tasks.`)
  return task
}

type TaskInput = { readonly task: string; readonly session?: string }

async function changeTask(mod: Mod<InboxState>, input: TaskInput, update: (task: Task, goals: Goals) => Task): Promise<{ readonly goals: Goals; readonly task: Task; readonly told: readonly string[] }> {
  const { task: id, session = sessions.current.id } = input
  const told: string[] = []
  const goals = await changeGoals(
    mod,
    session,
    (fresh) => {
      const known = fresh ?? emptyGoals(session, sessions.current.project)
      const task = taskIn(known, id)
      return { ...known, tasks: known.tasks.map((each) => (each === task ? update(task, known) : each)) }
    },
    rulebookCheck(mod, told),
    told,
  )
  return { goals, task: taskIn(goals, id), told }
}

async function sessionSummary(mod: Mod<InboxState>, session: string) {
  const goals = (await loadGoalsOf(mod, session)) ?? emptyGoals(session, '')
  const { items, person } = mod.state.memory
  const read = session === sessions.current.id ? Promise.resolve(sessions.current) : sessions.get(session)
  return read.then(async (shown) => ({
    session,
    goal: await shown.goal.text(),
    requirements: goals.requirements.map((each) => ({ ...each, isMet: isMet(each, goals) })),
    tasks: goals.tasks.map((task) => ({ ...task, state: shownState(task, goals, items, person) })),
    ...(session === sessions.current.id ? { unfiled: mod.state.session.unfiled.length } : {}),
  }))
}

function goalsTools(inboxTool: InboxTool): Job<Tool, InboxState>[] {
  return [
    inboxTool('goal', "Set what this session is for, in one plain sentence as the user would say it, when the user names it or it changes. The user reads it on top of the Goal view, and you read it again after every compaction.", schemas.goal, async (input) => {
      const text = input.text.trim()
      await sessions.current.goal.update({ text })
      return `This session's goal is now: ${text}`
    }),
    inboxTool(
      'file',
      "File the user's prompt or inbox answer into requirements, in the user's exact words, so you keep them after a compaction. Every prompt and every worded answer of the user's waits to be filed, and your turn cannot end until each is. For each thing it asks for, give a requirement: the id of an existing one the words add to, or the capability and your one line for a new one, each with quotes copied exactly from the words. When the words ask for nothing to build or change, give the reason instead.",
      schemas.file,
      async (input, mod) => {
        const { prompt: id, requirements: entries, reason } = input
        const { unfiled } = mod.state.session
        const words = unfiled.find((each) => each.id === id)
        if (words === undefined) throw new Error(unfiled.length === 0 ? `Nothing waits to be filed, so ${id} is filed already or holds no words of the user's.` : `${id} does not wait to be filed. These do: ${unfiled.map((each) => each.id).join(', ')}.`)
        if ((entries === undefined) === (reason === undefined)) throw new Error('Give requirements, each with the words that ask for it, or reason, when the words ask for nothing. Never both.')
        for (const quote of (entries ?? []).flatMap((each) => each.quotes)) {
          if (!isQuoteOf(words.text, quote)) throw new Error(`"${quote}" is not word for word in ${id}. Copy the user's exact words from it: ${JSON.stringify(firstLineOf(words.text))}`)
        }
        const session = sessions.current.id
        const told: string[] = []
        const goals = await changeGoals(
          mod,
          session,
          (fresh) => {
            const known = fresh ?? emptyGoals(session, sessions.current.project)
            let requirements = known.requirements
            const ids: string[] = []
            for (const entry of entries ?? []) {
              const quotes = entry.quotes.map((each) => ({ words: each, source: words.source, id, at: words.at }))
              if (entry.id !== undefined) {
                const named = entry.id
                if (entry.capability !== undefined || entry.line !== undefined) throw new Error(`Give ${named} with its quotes alone: its capability and line stay as they are.`)
                if (!requirements.some((each) => each.id === named)) throw new Error(`There is no requirement ${named}. ${requirementList(known)}`)
                requirements = requirements.map((each) => (each.id === named ? { ...each, quotes: [...each.quotes, ...quotes] } : each))
                ids.push(named)
              } else {
                if (entry.capability === undefined || entry.line === undefined) throw new Error('A new requirement needs its capability and its line. To add the words to an existing requirement, give its id.')
                const added = nextId('r', requirements)
                requirements = [...requirements, { id: added, capability: entry.capability, line: entry.line, quotes }]
                ids.push(added)
              }
            }
            const filing = reason === undefined ? { id, source: words.source, requirements: ids } : { id, source: words.source, reason }
            return { ...known, requirements, filings: [...known.filings, filing] }
          },
          rulebookCheck(mod, told),
          told,
        )
        mod.state.session.unfiled = mod.state.session.unfiled.filter((each) => each.id !== id)
        const into = reason === undefined ? `Filed ${id} into ${goals.requirements.filter((each) => each.quotes.some((quote) => quote.id === id)).map((each) => `${each.id} (${each.line})`).join(', ')}.` : `Filed ${id}: ${reason}.`
        const left = mod.state.session.unfiled
        return withTold(left.length === 0 ? into : `${into} Still to file: ${left.map((each) => each.id).join(', ')}.`, told)
      },
      false,
    ),
    inboxTool(
      'plan',
      "Add tasks to this session's list, which the user reads on the Tasks view and you read again after every compaction. Claude Code's checklist is off: plan here instead. Each task names the requirements it serves, and can wait after another task. A template adds a list the user or the team keeps, such as release, read from the project's .claude/cmods/inbox/templates/<name>.md first, then the user's ~/.claude/cmods/inbox/templates/<name>.md. A task a template marks required cannot be dropped.",
      schemas.plan,
      async (input, mod) => {
        const { tasks: given = [], template: name, serves = [] } = input
        if (given.length === 0 && name === undefined) throw new Error('Give tasks, a template, or both.')
        const fromTemplate = name === undefined ? [] : (await templateOf(sessions.current.project, name)).map((each) => ({ ...each, serves, template: name }))
        const planned = [...given.map((each) => ({ ...each, isRequired: false as const })), ...fromTemplate]
        const session = sessions.current.id
        const told: string[] = []
        const goals = await changeGoals(
          mod,
          session,
          (fresh) => {
            const known = fresh ?? emptyGoals(session, sessions.current.project)
            const tasks = planned.reduce<readonly Task[]>((list, each) => {
              for (const served of each.serves) if (!known.requirements.some((requirement) => requirement.id === served)) throw new Error(`"${each.title}" serves ${served}, which is no requirement. ${requirementList(known)}`)
              const after = 'after' in each ? each.after : undefined
              if (after !== undefined && !list.some((task) => task.id === after)) throw new Error(`"${each.title}" waits after ${after}, which is no task in the list or earlier in this call.`)
              return [...list, { id: nextId('t', list), ...each, state: 'planned', corrections: [] }]
            }, known.tasks)
            return { ...known, tasks }
          },
          rulebookCheck(mod, told),
          told,
        )
        const added = goals.tasks.slice(-planned.length)
        return withTold(`Planned ${added.map((each) => `${each.id}: ${each.title}${each.isRequired ? ' (required)' : ''}`).join('; ')}. Take a task with start before you work on it.`, told)
      },
    ),
    inboxTool(
      'start',
      'Take a planned task before you work on it, in this session or, with session, in another session\'s list, so parallel sessions split one plan. The task shows active until you finish, wait, or drop it, and your turn cannot end while a task you took is active.',
      schemas.start,
      async (input, mod) => {
        const cmodTask = cmodTaskOf(mod, input.session, input.task)
        const { task, told } = await changeTask(mod, input, (fresh, goals) => {
          if (fresh.state !== 'planned') throw new Error(refusalOf(fresh, 'start'))
          const before = goals.tasks.find((each) => each.id === fresh.after)
          if (before !== undefined && !isClosed(before)) throw new Error(`${fresh.id} waits after ${before.id}, which is not done yet. Finish ${before.id} first.`)
          return { ...fresh, state: 'active', owner: sessions.current.id, ...(cmodTask === undefined ? {} : { cmodTask }), startedAt: new Date().toISOString() }
        })
        return withTold(`Started ${task.id}: ${task.title}. Before you stop, finish it with its evidence, wait on the user's answer or on another task, or drop it.`, told)
      },
    ),
    inboxTool('finish', 'Mark an active task done, with the evidence that shows it works. Only the user reopens a done task.', schemas.finish, async (input, mod) => {
      const { goals, task, told } = await changeTask(mod, input, (fresh) => {
        if (fresh.state !== 'active') throw new Error(refusalOf(fresh, 'finish'))
        refuseTakenElsewhere(mod, fresh, 'finish it')
        return { ...fresh, state: 'done', evidence: input.evidence, endedAt: new Date().toISOString() }
      })
      return withTold(`Finished ${task.id}: ${task.title}. ${standing(mod, goals)}`, told)
    }),
    inboxTool(
      'wait',
      "Make a task wait: on an open inbox item, while you need the user's answer, or after another task in the same list. A task that waits on you lets your turn end, and shows active again once the user answers. Wait on the item you filed to ask, never in the chat.",
      schemas.wait,
      async (input, mod) => {
        const { on, after } = input
        if ((on === undefined) === (after === undefined)) throw new Error('Give on, the inbox item whose answer the task waits for, or after, the task it waits for. Never both.')
        if (on !== undefined) {
          const item = find(mod, on)
          const status = statusOf(item, personIn(mod, item))
          if (status !== 'open') throw new Error(`${on} is ${status}, so no answer is left to wait for.`)
          if (isWithAgent(item, personIn(mod, item))) throw new Error(`The user requested changes to ${on}, so it waits on you. Revise it, then wait on it.`)
        }
        const { task, told } = await changeTask(mod, input, (fresh, goals) => {
          if (isClosed(fresh)) throw new Error(refusalOf(fresh, 'wait on'))
          refuseTakenElsewhere(mod, fresh, 'make it wait')
          if (on !== undefined) return { ...fresh, waitsOn: on }
          const before = goals.tasks.find((each) => each.id === after)
          if (before === undefined) throw new Error(`There is no task ${after} in the same list.`)
          if (isChainedTo(goals, before.id, fresh.id)) throw new Error(`${before.id} waits after ${fresh.id} already, so ${fresh.id} cannot wait after it.`)
          if (isClosed(before)) throw new Error(`${before.id} is ${before.state} already, so nothing is left to wait for.`)
          return { ...fresh, after: before.id }
        })
        const reached = on === undefined || find(mod, on).subscribers.some((each) => each.session === sessions.current.id) ? '' : ` This session does not hear ${on}, so call subscribe on it to get the answer here.`
        return withTold(on === undefined ? `${task.id} waits after ${task.after}, and shows active again once ${task.after} is done.` : `${task.id} waits on you now, and your turn may end. The answer to ${on} arrives as a prompt, and ${task.id} shows active again.${reached}`, told)
      },
    ),
    inboxTool('drop', 'Drop a planned or active task that is no longer needed, with the reason. A task its template marks required cannot be dropped: finish it.', schemas.drop, async (input, mod) => {
      const { goals, task, told } = await changeTask(mod, input, (fresh) => {
        if (isClosed(fresh)) throw new Error(refusalOf(fresh, 'drop'))
        refuseTakenElsewhere(mod, fresh, 'drop it')
        if (fresh.isRequired) throw new Error(`${fresh.id} is required by the template ${fresh.template}, so it cannot be dropped. Finish it with its evidence.`)
        return { ...fresh, state: 'dropped', reason: input.reason, endedAt: new Date().toISOString() }
      })
      return withTold(`Dropped ${task.id}: ${task.title}. ${standing(mod, goals)}`, told)
    }),
  ]
}
