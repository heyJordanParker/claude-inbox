import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Dashboard, Person, Prompt, ToolCall, ToolResult, type InterfaceMethods, type Subprocess } from '../node_modules/@cmodjs/core/mod.js'
import { testMod, type FakeProvider, type FakeSession, type TestedMod } from '../node_modules/@cmodjs/core/testing.js'
import { claudeCodeOf } from '../node_modules/@cmodjs/core/testing/claude-code.js'
import { fakeAgent } from '../node_modules/@cmodjs/core/testing/fake-claude.js'
import { emptyGoals, nextId, type Goals } from '../src/goals/goal.js'
import { goalsMarkdown, parseGoals } from '../src/goals/markdown.js'
import { updateGoals, type Lock } from '../src/goals/store.js'
import type { Item } from '../src/items/item.js'
import { format } from '../src/items/markdown.js'
import { storeIn, updatePerson, type Disk } from '../src/items/store.js'
import { inbox } from '../src/mod.js'
import type { InboxState } from '../src/state.js'

const data = '/test/home/.local/share/cmod/data/inbox'

const goalsFile = (session: string) => `${data}/goals/${session}.md`

const progressFile = (session: string) => `${data}/progress/${session}.json`

function serving(): Subprocess {
  async function* written() {
    yield { stream: 'stdout' as const, text: '127.0.0.1:4800\n' }
    return await new Promise<never>(() => undefined)
  }
  return Object.assign(written(), { result: new Promise<never>(() => undefined) })
}

type Rulebook = { readonly exitCode: number; readonly stdout: string }

const deliveringSince = { [`${data}/delivering-since`]: '2026-10-01T00:00:00.000Z\n' }

function withProcesses<Faked extends Pick<TestedMod<InboxState>, 'fakes'>>(mod: Faked, rulebook?: (markdown: string) => Rulebook): Faked {
  mod.fakes.process.run = async (argv, run) => {
    const ran = argv[0] === 'rulebook' ? (rulebook?.(String(run?.stdin ?? '')) ?? { exitCode: 0, stdout: '' }) : { exitCode: 0, stdout: argv[0] === 'git' ? '/work/.git' : JSON.stringify({ results: [] }) }
    return { ...ran, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  mod.fakes.process.spawn = () => serving()
  return mod
}

function tested(options: { readonly files?: Record<string, string>; readonly rulebook?: (markdown: string) => Rulebook; readonly sessions?: readonly FakeSession[] } = {}) {
  return withProcesses(
    testMod(inbox, {
      projectRoot: '/work',
      files: { ...deliveringSince, ...options.files },
      sessions: options.sessions ?? [{ id: 'test-session', title: 'claude inbox', isRunning: true }, { id: 'planner', title: 'schema planning', isRunning: true }],
    }),
    options.rulebook,
  )
}

type Tested = ReturnType<typeof tested>

function ticking(mod: Pick<Tested, 'fakes' | 'settle'>): () => Promise<void> {
  const ticks: (() => unknown)[] = []
  mod.fakes.clock.every = (_, tick) => {
    ticks.push(tick)
    return { cancel: () => undefined }
  }
  return async () => {
    for (const tick of ticks) await tick()
    await mod.settle()
  }
}

async function said(mod: Tested, text: string): Promise<string> {
  const [prompt] = await mod.add({ type: Prompt, text, from: { type: Person } })
  if (prompt === undefined) throw new Error('No prompt was added.')
  return prompt.id
}

async function called(mod: Tested, name: string, input: Record<string, unknown>): Promise<string> {
  const answer = await mod.callTool(name, input)
  if (!('result' in answer)) throw new Error(`The ${name} call was denied: ${JSON.stringify(answer)}`)
  return String(answer.result)
}

async function denied(mod: Tested, name: string, input: Record<string, unknown>): Promise<string> {
  const answer = await mod.callTool(name, input)
  if (!('deny' in answer)) throw new Error(`The ${name} call was accepted: ${JSON.stringify(answer)}`)
  return answer.deny ?? ''
}

async function storedGoals(mod: Tested, session = 'test-session'): Promise<Goals> {
  return parseGoals(session, String(await mod.fakes.fs.read?.(goalsFile(session))))
}

async function planned(mod: Tested, tasks: readonly Record<string, unknown>[]): Promise<void> {
  const id = await said(mod, 'Show the progress bar beside the session')
  await called(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: 'Progress shows beside the session', quotes: ['progress bar beside the session'] }] })
  await called(mod, 'plan', { tasks })
}

const question = { title: 'Do we want courses?', why: 'It decides the schema' }

test("a person prompt that is not filed refuses the turn end with its id and text, and filing a quote of its words lets the turn end", async () => {
  const mod = tested()
  const id = await said(mod, 'Make the bar green')

  const refused = await mod.raise.beforeTurnEnd()
  await called(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: 'The bar is green', quotes: ['the bar green'] }] })

  expect(refused).toEqual({ refuse: expect.stringContaining(`- ${id}: "Make the bar green"`) })
  expect(await mod.raise.beforeTurnEnd()).toBeUndefined()
  expect((await storedGoals(mod)).requirements).toEqual([{ id: 'r1', capability: 'Progress view', line: 'The bar is green', quotes: [{ words: 'the bar green', source: 'prompt', id, at: expect.any(String) }] }])
})

test('file refuses a quote that is not word for word in the prompt, and keeps the prompt waiting', async () => {
  const mod = tested()
  const id = await said(mod, 'Make the bar green')

  const deny = await denied(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: 'The bar is green', quotes: ['a green bar'] }] })

  expect(deny).toBe(`The file tool failed: "a green bar" is not word for word in ${id}. Copy the user's exact words from it: "Make the bar green"`)
  expect(mod.state.session.unfiled.map((each) => each.id)).toEqual([id])
})

test('an inbox answer with words waits to be filed as <item id>#<answer number>, and an answer with no words does not', async () => {
  const mod = tested()
  const tick = ticking(mod)
  await called(mod, 'propose', { title: 'Ship it', goal: 'It ships', problems: [{ title: 'It is not out', ideas: [{ idea: 'Nobody can use it.' }], solution: { title: 'Release it', ideas: [{ idea: 'Push the tag.', drawing: { kind: 'example', language: 'sh', code: 'git push --tags' } }] } }] })
  await mod.shown.view.press('approve')
  await tick()
  const approved = [...mod.state.session.unfiled]

  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''
  await mod.shown.view.input(`answer:${asked}`, 'Yes, but only paid ones')
  await tick()

  expect(approved).toEqual([])
  expect(mod.state.session.unfiled).toEqual([{ id: `${asked}#1`, source: 'answer', text: 'Yes, but only paid ones', at: expect.any(String) }])
})

test('a task this session started refuses the turn end until finish, wait, or drop ends it', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }, { title: 'Color the bar', serves: ['r1'] }, { title: 'Test the bar', serves: ['r1'] }])
  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''

  const refusals: unknown[] = []
  for (const [task, end] of [
    ['t1', { name: 'finish', input: { task: 't1', evidence: ['bun test: 3 pass'] } }],
    ['t2', { name: 'wait', input: { task: 't2', on: asked } }],
    ['t3', { name: 'drop', input: { task: 't3', reason: 'The suite covers it' } }],
  ] as const) {
    await called(mod, 'start', { task })
    refusals.push(await mod.raise.beforeTurnEnd())
    await called(mod, end.name, end.input)
  }

  expect(refusals).toEqual([
    { refuse: expect.stringContaining('- t1: Draw the bar') },
    { refuse: expect.stringContaining('- t2: Color the bar') },
    { refuse: expect.stringContaining('- t3: Test the bar') },
  ])
  expect(await mod.raise.beforeTurnEnd()).toBeUndefined()
})

test('wait on an open item shows the task waiting on you, and the answer shows it active again', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Pick the schema', serves: ['r1'] }])
  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''
  await called(mod, 'start', { task: 't1' })
  await called(mod, 'wait', { task: 't1', on: asked })
  const waiting = JSON.parse(await called(mod, 'read', { session: 'test-session' })) as { tasks: { state: string }[] }

  await mod.shown.view.input(`answer:${asked}`, 'Yes')
  const answered = JSON.parse(await called(mod, 'read', { session: 'test-session' })) as { tasks: { state: string }[] }

  expect([waiting.tasks[0]?.state, answered.tasks[0]?.state]).toEqual(['waiting on you', 'active'])
})

test("plan with a template reads the project's copy before the person's, and drop refuses a task the template marks required", async () => {
  const release = (from: string) => [`- [ ] Run the suite (required)`, `- [ ] Note it in the ${from} changelog`].join('\n')
  const mod = tested({ files: { '/work/.claude/cmods/inbox/templates/release.md': release('project'), '/test/home/.claude/cmods/inbox/templates/release.md': release('person'), '/test/home/.claude/cmods/inbox/templates/hotfix.md': '- [ ] Patch it' } })
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])

  await called(mod, 'plan', { template: 'release', serves: ['r1'] })
  await called(mod, 'plan', { template: 'hotfix', serves: ['r1'] })
  const deny = await denied(mod, 'drop', { task: 't2', reason: 'No time' })

  expect((await storedGoals(mod)).tasks.map((each) => [each.id, each.title, each.isRequired, each.template])).toEqual([
    ['t1', 'Draw the bar', false, undefined],
    ['t2', 'Run the suite', true, 'release'],
    ['t3', 'Note it in the project changelog', false, 'release'],
    ['t4', 'Patch it', false, 'hotfix'],
  ])
  expect(deny).toBe('The drop tool failed: t2 is required by the template release, so it cannot be dropped. Finish it with its evidence.')
})

test('the compaction note holds the goal, each requirement with the words the user wrote, and each open task', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }, { title: 'Color the bar', serves: ['r1'] }])
  await called(mod, 'goal', { text: 'You see progress in the Sidebar' })
  await called(mod, 'start', { task: 't1' })
  await called(mod, 'finish', { task: 't1', evidence: ['bun test: 3 pass'] })

  const answer = await mod.raise.beforeSessionStart({ source: 'compact' })

  expect(answer?.note?.split('\n')).toEqual([
    "Inbox: this session's goal, the user's requirements in their exact words, and your open tasks.",
    'Goal: You see progress in the Sidebar',
    'Requirements:',
    '- r1 open, Progress view: Progress shows beside the session',
    expect.stringMatching(/^ {4}prompt \S+:$/),
    '    > progress bar beside the session',
    'Open tasks:',
    '- t2 planned: Color the bar (serves r1)',
  ])
})

test("Claude Code's checklist tools are refused with a pointer to the inbox tools, for the main agent and for a subagent", async () => {
  const mod = tested()
  const task = await mod.startTask({ title: 'Explore', agentType: 'Explore' })
  await mod.add({ type: Prompt, text: 'Map the code' }, { task })

  const main = await mod.raise.beforeToolCall({ name: 'TaskCreate', input: { subject: 'Draw the bar' } })
  const subagent = await mod.raise.beforeToolCall({ name: 'TodoWrite', input: { todos: [] } }, { task })

  expect([main, subagent]).toEqual([{ refuse: expect.stringContaining('mcp__inbox__plan adds tasks') }, { refuse: expect.stringContaining('mcp__inbox__plan adds tasks') }])
})

test("a subagent's start stores its cmod task, and its stop is refused while that task is active", async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  const task = await mod.startTask({ title: 'Draw it', agentType: 'general-purpose' })
  await mod.add({ type: Prompt, text: 'Draw the bar' }, { task })
  const claudeCode = claudeCodeOf(mod)

  await mod.raise.beforeToolCall({ name: 'mcp__inbox__start', input: { task: 't1' } }, { task })
  await called(mod, 'start', { task: 't1' })
  const stopped = await claudeCode.fire('SubagentStop', { agent_id: task, agent_type: 'general-purpose', stop_hook_active: false, agent_transcript_path: '', last_assistant_message: 'Done.' })

  expect((await storedGoals(mod)).tasks[0]?.cmodTask).toBe(task)
  expect(stopped).toEqual({ block: expect.stringContaining('- t1: Draw the bar') })
  expect(await mod.raise.beforeTurnEnd()).toBeUndefined()
})

test("start with another session's id takes a task in that session's list, which this session then owns", async () => {
  const planner: Goals = { ...emptyGoals('planner', '/work'), tasks: [{ id: 't1', title: 'Write the migration', state: 'planned', serves: [], isRequired: false, corrections: [] }] }
  const mod = tested({ files: { [goalsFile('planner')]: goalsMarkdown(planner) } })
  await mod.add({ type: Prompt, text: 'Take the migration' })

  await called(mod, 'start', { task: 't1', session: 'planner' })

  expect((await storedGoals(mod, 'planner')).tasks[0]).toEqual(expect.objectContaining({ state: 'active', owner: 'test-session' }))
  expect(await mod.raise.beforeTurnEnd()).toEqual({ refuse: expect.stringContaining('- t1 of session planner: Write the migration') })
})

const listed: readonly FakeSession[] = [
  { id: 'test-session', title: 'claude inbox', isRunning: true, goal: 'You see progress in the Sidebar' },
  { id: 'planner', title: 'schema planning', isRunning: true, goal: 'Courses have a schema' },
  { id: 'ended', title: 'old migration', isRunning: false, goal: 'The migration runs' },
]

test('a load parses the goals files of this session and of each running session and only the progress file of this session, and never a file of a session that does not run', async () => {
  const files = Object.fromEntries(
    listed.flatMap(({ id }) => [
      [goalsFile(id), goalsMarkdown(emptyGoals(id, '/work'))],
      [progressFile(id), JSON.stringify({ session: id, blocks: [{ kind: 'note', text: 'Tests run' }], at: '2026-11-22T10:00:00.000Z' })],
    ]),
  )
  const mod = tested({ files, sessions: listed })

  await mod.start()
  await mod.settle()

  expect([Object.keys(mod.state.memory.goals).sort(), mod.state.memory.progress?.session]).toEqual([['planner', 'test-session'], 'test-session'])
  expect(mod.calls.filter((call) => call.call === 'fs.read' && [goalsFile('ended'), progressFile('ended'), progressFile('planner')].includes(String(call.args[0])))).toEqual([])
})

test("start with the id of a session that does not run reads that session's goals file and takes the task, and read with its id lists it", async () => {
  const ended: Goals = { ...emptyGoals('ended', '/work'), tasks: [{ id: 't1', title: 'Write the migration', state: 'planned', serves: [], isRequired: false, corrections: [] }] }
  const mod = tested({ files: { [goalsFile('ended')]: goalsMarkdown(ended) }, sessions: listed })
  await mod.add({ type: Prompt, text: 'Take the migration' })
  const states = async () => (JSON.parse(await called(mod, 'read', { session: 'ended' })) as { readonly tasks: readonly { readonly id: string; readonly state: string }[] }).tasks.map((each) => [each.id, each.state])

  const before = await states()
  await called(mod, 'start', { task: 't1', session: 'ended' })

  expect([before, await states()]).toEqual([[['t1', 'planned']], [['t1', 'active']]])
  expect((await storedGoals(mod, 'ended')).tasks[0]).toEqual(expect.objectContaining({ state: 'active', owner: 'test-session' }))
  expect(await mod.raise.beforeTurnEnd()).toEqual({ refuse: expect.stringContaining('- t1 of session ended: Write the migration') })
})

test("a cmod/Sessions Change of one session's goal rereads that session's goal text alone, and a later listing reads no goal text again", async () => {
  const otherDevice = { name: 'cmod/Sessions', mod: 'remote', program: 'sessions', methods: { sessions: () => [] } as unknown as InterfaceMethods<'cmod/Sessions'> } as const
  const running = [...listed.slice(0, 2), { id: 'reviewer', title: 'schema review', isRunning: true, goal: 'The schema reads well' }]
  const mod = withProcesses(testMod(inbox, { projectRoot: '/work', files: deliveringSince, sessions: running, providers: [otherDevice] }))
  const tick = ticking(mod)
  const goalReads = () =>
    mod.calls
      .flatMap((call) => {
        const [asked] = call.args as readonly { readonly method?: string; readonly input?: { readonly session?: string } }[]
        return call.call === 'cmod.call' && asked?.method === 'cmod:goal' && asked.input?.session !== 'test-session' ? [asked.input?.session] : []
      })
      .sort()
  await mod.start()
  await mod.settle()
  const first = goalReads()

  await tick()
  const listedAgain = goalReads()
  mod.providers[0].tell('Change', { session: 'planner', part: 'goal' })
  await mod.settle()

  expect([first, listedAgain, goalReads()]).toEqual([
    ['planner', 'reviewer'],
    ['planner', 'reviewer'],
    ['planner', 'planner', 'reviewer'],
  ])
  expect(mod.state.memory.goalTexts).toEqual({ 'test-session': 'You see progress in the Sidebar', planner: 'Courses have a schema', reviewer: 'The schema reads well' })
})

const inboxProgram = { name: 'inbox/Goals', mod: 'inbox', program: 'inbox', methods: { goals: () => ({}), sessions: () => [] } } as const

async function changingGoals<const Given extends readonly FakeProvider[]>(providers: Given) {
  const others = [
    { id: 's1', title: 'schema planning', isRunning: true, goal: 'Courses have a schema' },
    { id: 's2', title: 'schema review', isRunning: true, goal: 'The schema reads well' },
  ]
  const mod = withProcesses(testMod(inbox, { projectRoot: '/work', files: deliveringSince, sessions: [...listed.slice(0, 1), ...others], providers }))
  const kit = mod.fakes.cmod.call
  const goals = new Map(others.map((each) => [each.id, each.goal]))
  mod.fakes.cmod.call = (call) => {
    const asked = call as { readonly method?: string; readonly input?: { readonly session?: string } }
    const text = asked.method === 'cmod:goal' ? goals.get(String(asked.input?.session)) : undefined
    return text === undefined ? (kit?.(call) ?? Promise.reject(new Error('The test kit set no cmod.call fake.'))) : Promise.resolve({ text })
  }
  await mod.start()
  await mod.settle()
  const before = mod.state.memory.goalTexts
  goals.set('s1', 'Courses have a schema and a price')
  goals.set('s2', 'Every review names the schema it read')
  return { mod, before }
}

test("an inbox/Goals Change with part 'goal' from the inbox program rereads that session's goal text alone, as no cmod/Sessions provider lists this computer", async () => {
  const { mod, before } = await changingGoals([inboxProgram])

  mod.providers[0].tell('Change', { session: 's2', part: 'goal' })
  await mod.settle()

  expect(before).toEqual({ 'test-session': 'You see progress in the Sidebar', s1: 'Courses have a schema', s2: 'The schema reads well' })
  expect(mod.state.memory.goalTexts).toEqual({ 'test-session': 'You see progress in the Sidebar', s1: 'Courses have a schema', s2: 'Every review names the schema it read' })
})

test('after the inbox program restarts, the mod still hears the goal changes the new copy tells', async () => {
  const { mod } = await changingGoals([inboxProgram, { ...inboxProgram, isStarted: false }])
  const [first, restarted] = mod.providers

  first.remove()
  restarted.start()
  await mod.settle()
  restarted.tell('Change', { session: 's2', part: 'goal' })
  await mod.settle()

  expect(mod.state.memory.goalTexts).toEqual({ 'test-session': 'You see progress in the Sidebar', s1: 'Courses have a schema', s2: 'Every review names the schema it read' })
})

test("a session no Claude app shows never calls provider('inbox/Goals'), so a claude -p session never starts the inbox program", async () => {
  const askedFor = async (isShown: boolean) => {
    const mod = withProcesses(testMod(inbox, { projectRoot: '/work', files: deliveringSince, sessions: listed, providers: [inboxProgram] }))
    mod.fakes.session.surfaces = async () => (isShown ? ['terminal'] : [])
    await mod.start()
    await mod.settle()
    return mod.calls.filter(({ call, args }) => {
      const [asked] = args as readonly { readonly method?: string; readonly input?: { readonly interface?: string } }[]
      return call === 'cmod.call' && asked?.method === 'cmod:provider' && asked.input?.interface === 'inbox/Goals'
    }).length
  }

  expect([await askedFor(false), await askedFor(true)]).toEqual([0, 1])
})

test('the Sessions widget lists a running session that has a goal text and no goals file', async () => {
  const mod = tested({ sessions: [{ id: 'test-session', title: 'claude inbox', isRunning: true }, ...listed.slice(1)] })

  await mod.start()
  await mod.settle()
  const lines = await mod.lines(Dashboard)

  expect(lines).toHaveLength(2)
  expect(lines.filter((line) => line.includes('Courses have a schema'))).toHaveLength(1)
})

test('the goals file reads back as the goals it was written from', () => {
  const quote = { words: 'this isn\'t effective\n\nput it in the "sidebar" {"x": 1}', source: 'prompt' as const, id: 'b2f7', at: '2026-11-22T10:00:00.000Z' }
  const goals: Goals = {
    ...emptyGoals('test-session', '/work'),
    requirements: [{ id: 'r1', capability: 'Progress view', line: 'Progress shows beside the session', quotes: [quote, { ...quote, source: 'answer', id: 'courses#2' }] }],
    filings: [
      { id: 'b2f7', source: 'prompt', requirements: ['r1'] },
      { id: 'c9a1', source: 'prompt', reason: 'Thanks the agent' },
    ],
    tasks: [
      { id: 't1', title: 'Draw the bar', state: 'done', serves: ['r1'], owner: 'test-session', isRequired: false, evidence: ['bun test: 3 pass'], startedAt: '2026-11-22T10:01:00.000Z', endedAt: '2026-11-22T10:02:00.000Z', corrections: [{ ...quote, source: 'view', id: 'view:2026-11-22T10:03:00.000Z' }] },
      { id: 't2', title: 'Run the suite', state: 'active', serves: ['r1'], after: 't1', waitsOn: 'courses', owner: 'planner', cmodTask: 'agent-7', template: 'release', isRequired: true, startedAt: '2026-11-22T10:04:00.000Z', corrections: [] },
      { id: 't3', title: 'Note it', state: 'dropped', serves: [], isRequired: false, reason: 'No changelog', endedAt: '2026-11-22T10:05:00.000Z', corrections: [] },
    ],
  }

  expect(parseGoals('test-session', goalsMarkdown(goals))).toEqual(goals)
})

test('a rulebook refusal of the goals file stores nothing, and the prompt still waits to be filed', async () => {
  const mod = tested({ rulebook: () => ({ exitCode: 1, stdout: "Don't write em dashes." }) })
  const id = await said(mod, 'Make the bar green')

  const deny = await denied(mod, 'file', { prompt: id, reason: 'Asks nothing' })

  expect(deny).toBe("The file tool failed: Don't write em dashes.")
  expect(await mod.fakes.fs.exists?.(goalsFile('test-session'))).toBe(false)
  expect(mod.state.session.unfiled.map((each) => each.id)).toEqual([id])
})

test("a subagent's first prompt carries the goal, the requirements, and the open tasks", async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  const task = await mod.startTask({ title: 'Draw it', agentType: 'general-purpose' })

  const answer = await mod.raise.beforePrompt({ text: 'Draw the bar' }, { task })

  expect(answer).toEqual({ note: expect.stringContaining('- t1 planned: Draw the bar (serves r1)') })
  expect(answer).toEqual({ note: expect.stringContaining('    > progress bar beside the session') })
})

test('a task that starts waiting on the user toasts once, with Open on the item', async () => {
  const mod = tested()
  const tick = ticking(mod)
  await planned(mod, [{ title: 'Pick the schema', serves: ['r1'] }])
  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''
  await called(mod, 'start', { task: 't1' })
  await tick()

  await called(mod, 'wait', { task: 't1', on: asked })
  await tick()
  await tick()

  expect(mod.shown.toasts.filter((each) => each.message.includes('waits on you'))).toEqual([{ type: 'info', message: '"Pick the schema" waits on you', description: 'Do we want courses?' }])
})

test("a goals file the mod reads for the first time toasts none of its tasks that already wait on the user, and a task in it that starts waiting later toasts", async () => {
  const mod = tested()
  const tick = ticking(mod)
  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''
  const task = (id: string, title: string, waitsOn?: string): Goals['tasks'][number] => ({ id, title, state: 'active', serves: [], owner: 'planner', startedAt: '2026-11-22T10:00:00.000Z', isRequired: false, corrections: [], ...(waitsOn === undefined ? {} : { waitsOn }) })
  const planner = (second?: string): Goals => ({ ...emptyGoals('planner', '/work'), tasks: [task('t1', 'Pick the schema', asked), task('t2', 'Name the tables', second)], updatedAt: new Date().toISOString() })
  await tick()

  await mod.fakes.fs.write?.(goalsFile('planner'), goalsMarkdown(planner()))
  await tick()
  await mod.fakes.fs.write?.(goalsFile('planner'), goalsMarkdown(planner(asked)))
  await tick()

  expect(mod.shown.toasts.filter((each) => each.message.includes('waits on you'))).toEqual([{ type: 'info', message: '"Name the tables" waits on you', description: 'Do we want courses?' }])
})

async function goalSet(mod: Tested, words: string): Promise<void> {
  await mod.shown.view.press('goal:edit')
  await mod.shown.view.input('goal:text', words)
}

test("changing the goal from the view tells the agent as a note during a turn and as a prompt between turns, and waits to be filed in the user's words", async () => {
  const mod = tested()
  await mod.hotkey('goal')
  await goalSet(mod, 'Progress shows in the Sidebar')
  await mod.add({ type: Prompt, text: 'Keep going' })
  await goalSet(mod, 'Progress shows in the Sidebar and the browser')

  const read = JSON.parse(await called(mod, 'read', { session: 'test-session' })) as { goal: string }

  expect(read.goal).toBe('Progress shows in the Sidebar and the browser')
  expect([mod.shown.prompts.at(-1), mod.shown.notes.at(-1)]).toEqual([expect.stringContaining('"Progress shows in the Sidebar"'), expect.stringContaining('"Progress shows in the Sidebar and the browser"')])
  expect(mod.state.session.unfiled.map((each) => [each.source, each.text])).toEqual([
    ['view', 'Progress shows in the Sidebar'],
    ['prompt', 'Keep going'],
    ['view', 'Progress shows in the Sidebar and the browser'],
  ])
})

test("a requirement the user adds holds their words, and a correction becomes a quote the agent is told", async () => {
  const mod = tested()
  await mod.hotkey('goal')
  await mod.shown.view.press('goal:add:open')
  await mod.shown.view.input('goal:add:capability', 'Progress view', 'change')
  await mod.shown.view.input('goal:add', 'The bar shows the tests')

  await mod.shown.view.press('quotes:r1')
  await mod.shown.view.press('goal:correct:r1:open')
  await mod.shown.view.input('goal:correct:r1', 'Only the failing ones')

  expect((await storedGoals(mod)).requirements).toEqual([
    {
      id: 'r1',
      capability: 'Progress view',
      line: 'The bar shows the tests',
      quotes: [
        { words: 'The bar shows the tests', source: 'view', id: expect.stringMatching(/^view:/), at: expect.any(String) },
        { words: 'Only the failing ones', source: 'view', id: expect.stringMatching(/^view:/), at: expect.any(String) },
      ],
    },
  ])
  expect(mod.shown.notes.at(-1)).toBe('Inbox: the user corrected requirement r1, "The bar shows the tests": "Only the failing ones"')
})

test('only a done task offers Reopen, and it reopens planned for anyone to take', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  await called(mod, 'start', { task: 't1' })
  await mod.hotkey('tasks')
  const active = await mod.shown.view.lines()
  await called(mod, 'finish', { task: 't1', evidence: ['bun test: 3 pass'] })

  await mod.shown.view.press('evidence:t1')
  await mod.shown.view.press('reopen:t1')

  expect(active.join('\n')).not.toContain('Reopen')
  expect((await storedGoals(mod)).tasks[0]).toEqual({ id: 't1', title: 'Draw the bar', state: 'planned', serves: ['r1'], isRequired: false, corrections: [] })
})

test('no file in src/goals imports @cmodjs/core, so the inbox program reads the same goals', () => {
  const core = new URL('../src/goals/', import.meta.url).pathname
  const files = readdirSync(core).filter((name) => name.endsWith('.ts'))

  expect(files).toContain('store.ts')
  expect(files.filter((name) => readFileSync(`${core}${name}`, 'utf8').includes('@cmodjs/core'))).toEqual([])
})

test('the turn-end gate refuses a stop once for each set of unfiled prompts, saying the next stop passes, lets the next stop on that set pass with no answer, and refuses a changed set again', async () => {
  const mod = tested()
  const first = await said(mod, 'Make the bar green')

  const refused = await mod.raise.beforeTurnEnd()
  const passed = await mod.raise.beforeTurnEnd()
  const second = await said(mod, 'And make it wider')
  const refusedAgain = await mod.raise.beforeTurnEnd()

  expect(refused).toEqual({ refuse: expect.stringContaining(`- ${first}: "Make the bar green"`) })
  expect(refused).toEqual({ refuse: expect.stringMatching(/\nIf you stop again with these left open, that stop passes and they stay open in the inbox\.$/) })
  expect(passed).toBeUndefined()
  expect(refusedAgain).toEqual({ refuse: expect.stringContaining(`- ${second}: "And make it wider"`) })
})

test("a subagent's stop is refused once for each set of its active tasks, and passes with no answer on the same set", async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }, { title: 'Color the bar', serves: ['r1'] }])
  const task = await mod.startTask({ title: 'Draw it', agentType: 'general-purpose' })
  await mod.add({ type: Prompt, text: 'Draw the bar' }, { task })
  const claudeCode = claudeCodeOf(mod)
  const stop = (isAfterRefusal: boolean) => claudeCode.fire('SubagentStop', { agent_id: task, agent_type: 'general-purpose', stop_hook_active: isAfterRefusal, agent_transcript_path: '', last_assistant_message: 'Done.' })
  await mod.raise.beforeToolCall({ name: 'mcp__inbox__start', input: { task: 't1' } }, { task })
  await called(mod, 'start', { task: 't1' })

  const refused = await stop(false)
  const passed = await stop(true)
  await mod.raise.beforeToolCall({ name: 'mcp__inbox__start', input: { task: 't2' } }, { task })
  await called(mod, 'start', { task: 't2' })
  const refusedAgain = await stop(true)

  expect(refused).toEqual({ block: expect.stringContaining('- t1: Draw the bar') })
  expect(passed).toEqual({})
  expect(refusedAgain).toEqual({ block: expect.stringContaining('- t2: Color the bar') })
})

test("the rulebook check reads the agent's words and never the user's quotes, so a quote with an em dash stores and a line with one is refused", async () => {
  const dash = String.fromCharCode(0x2014)
  const mod = tested({ rulebook: (markdown) => (markdown.includes(dash) ? { exitCode: 1, stdout: "Don't write em dashes." } : { exitCode: 0, stdout: '' }) })
  const id = await said(mod, `Make the bar green ${dash} and wide`)

  const deny = await denied(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: `The bar is green ${dash} and wide`, quotes: [`green ${dash} and wide`] }] })
  await called(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: 'The bar is green and wide', quotes: [`green ${dash} and wide`] }] })

  expect(deny).toBe("The file tool failed: Don't write em dashes.")
  expect((await storedGoals(mod)).requirements[0]?.quotes.map((each) => each.words)).toEqual([`green ${dash} and wide`])
})

test('a stored task title the rulebook now refuses never blocks finishing another task, because the check reads only the words a write adds', async () => {
  const dash = String.fromCharCode(0x2014)
  const goals: Goals = { ...emptyGoals('test-session', '/work'), tasks: [activeTask('t1', `Draw the bar ${dash} wide`, 'test-session'), activeTask('t2', 'Color the bar', 'test-session')] }
  const checked: string[] = []
  const mod = tested({
    files: { [goalsFile('test-session')]: goalsMarkdown(goals) },
    rulebook: (markdown) => {
      checked.push(markdown)
      return markdown.includes(dash) ? { exitCode: 1, stdout: "Don't write em dashes." } : { exitCode: 0, stdout: '' }
    },
  })
  await mod.add({ type: Prompt, text: 'Finish the color' })

  await called(mod, 'finish', { task: 't2', evidence: ['bun test: 3 pass'] })

  expect((await storedGoals(mod)).tasks.map((each) => each.state)).toEqual(['active', 'done'])
  expect(checked).toEqual([expect.stringContaining('bun test: 3 pass')])
  expect(checked[0]).not.toContain('Draw the bar')
})

test('a stored task title the rulebook now refuses never blocks finishing or dropping that same task, because the check reads only the words that changed', async () => {
  const dash = String.fromCharCode(0x2014)
  const goals: Goals = { ...emptyGoals('test-session', '/work'), tasks: [activeTask('t1', `Draw the bar ${dash} wide`, 'test-session'), activeTask('t2', `Color the bar ${dash} green`, 'test-session')] }
  const checked: string[] = []
  const mod = tested({
    files: { [goalsFile('test-session')]: goalsMarkdown(goals) },
    rulebook: (markdown) => {
      checked.push(markdown)
      return markdown.includes(dash) ? { exitCode: 1, stdout: "Don't write em dashes." } : { exitCode: 0, stdout: '' }
    },
  })
  await mod.add({ type: Prompt, text: 'Close both tasks' })

  await called(mod, 'finish', { task: 't1', evidence: ['bun test: 3 pass'] })
  await called(mod, 'drop', { task: 't2', reason: 'The bar keeps its color' })

  expect((await storedGoals(mod)).tasks.map((each) => [each.id, each.title, each.state])).toEqual([
    ['t1', `Draw the bar ${dash} wide`, 'done'],
    ['t2', `Color the bar ${dash} green`, 'dropped'],
  ])
  expect(checked).toEqual([expect.stringContaining('bun test: 3 pass'), expect.stringContaining('The bar keeps its color')])
  expect(checked.join('\n')).not.toContain('Draw the bar')
  expect(checked.join('\n')).not.toContain('Color the bar')
})

test('file that only adds quotes to an existing requirement runs no rulebook check, because it adds no words of the agent', async () => {
  const goals: Goals = { ...emptyGoals('test-session', '/work'), requirements: [{ id: 'r1', capability: 'Progress view', line: 'Progress shows beside the session', quotes: [{ words: 'progress bar', source: 'prompt', id: 'earlier', at: '2026-11-22T10:00:00.000Z' }] }] }
  const checked: string[] = []
  const mod = tested({
    files: { [goalsFile('test-session')]: goalsMarkdown(goals) },
    rulebook: (markdown) => {
      checked.push(markdown)
      return { exitCode: 0, stdout: '' }
    },
  })
  const id = await said(mod, 'Make the progress bar green')

  await called(mod, 'file', { prompt: id, requirements: [{ id: 'r1', quotes: ['progress bar green'] }] })

  expect(checked).toEqual([])
  expect((await storedGoals(mod)).requirements[0]?.quotes.map((each) => each.words)).toEqual(['progress bar', 'progress bar green'])
  expect((await storedGoals(mod)).filings).toEqual([{ id, source: 'prompt', requirements: ['r1'] }])
})

const disk: Disk = {
  read: (path) => readFile(path, 'utf8'),
  write: async (path, text) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  },
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  list: async (folder) =>
    Promise.all(
      (await readdir(folder, { withFileTypes: true })).map(async (entry) => {
        const { size, mtimeMs } = await stat(join(folder, entry.name))
        return { name: entry.name, isFile: entry.isFile(), size, modifiedAt: mtimeMs }
      }),
    ),
}

const folderLock: Lock = {
  makeFolder: async (path) => {
    await mkdir(path, { recursive: true })
  },
  take: async (path, token) => {
    const isTaken = await mkdir(path).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST') return false
        throw error
      },
    )
    if (isTaken) await writeFile(join(path, token), '')
    return isTaken
  },
  heldSince: (path) =>
    stat(path).then(
      (held) => held.mtimeMs,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return undefined
        throw error
      },
    ),
  tokens: async (path) => {
    const names = await readdir(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const stamped = await Promise.all(names.map(async (name) => ({ name, modifiedAt: await folderLock.heldSince(join(path, name)) })))
    return stamped.flatMap(({ name, modifiedAt }) => (modifiedAt === undefined ? [] : [{ name, modifiedAt }]))
  },
  remove: async (path) => Bun.spawnSync(['rm', '-d', path], { stderr: 'ignore' }).exitCode === 0,
  wait: async () => undefined,
}

const plannedTask = (title: string, known: Goals): Goals['tasks'][number] => ({ id: nextId('t', known.tasks), title, state: 'planned', serves: [], isRequired: false, corrections: [] })

test('two goals writes over one data folder through two separate Disks, run at once, both land', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'inbox-goals-test-'))
  try {
    const added = (title: string) =>
      updateGoals(
        storeIn(folder, { ...disk }),
        folderLock,
        's1',
        (fresh) => {
          const known = fresh ?? emptyGoals('s1', '/work')
          return { ...known, tasks: [...known.tasks, plannedTask(title, known)] }
        },
        [],
      )

    await Promise.all([added('Draw the bar'), added('Color the bar')])

    const stored = parseGoals('s1', readFileSync(join(folder, 'goals', 's1.md'), 'utf8'))
    expect(stored.tasks.map((each) => each.id)).toEqual(['t1', 't2'])
    expect(stored.tasks.map((each) => each.title).sort()).toEqual(['Color the bar', 'Draw the bar'])
    expect(readdirSync(join(folder, 'goals'))).toEqual(['s1.md'])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a goals write breaks a lock whose token is older than 10 seconds, which a writer that stopped midway left', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'inbox-goals-test-'))
  try {
    const lock = join(folder, 'goals', 's1.md.lock')
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'stopped'), '')
    const left = new Date(Date.now() - 11_000)
    utimesSync(join(lock, 'stopped'), left, left)
    const told: string[] = []

    await updateGoals(storeIn(folder, disk), folderLock, 's1', () => emptyGoals('s1', '/work'), told)

    expect(parseGoals('s1', readFileSync(join(folder, 'goals', 's1.md'), 'utf8')).session).toBe('s1')
    expect(readdirSync(join(folder, 'goals'))).toEqual(['s1.md'])
    expect(told).toEqual([])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a goals write breaks an empty lock folder older than 10 seconds, which a writer that stopped before it wrote its token left', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'inbox-goals-test-'))
  try {
    const lock = join(folder, 'goals', 's1.md.lock')
    mkdirSync(lock, { recursive: true })
    const left = new Date(Date.now() - 11_000)
    utimesSync(lock, left, left)

    await updateGoals(storeIn(folder, disk), folderLock, 's1', () => emptyGoals('s1', '/work'), [])

    expect(parseGoals('s1', readFileSync(join(folder, 'goals', 's1.md'), 'utf8')).session).toBe('s1')
    expect(readdirSync(join(folder, 'goals'))).toEqual(['s1.md'])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('a release that fails after the write landed returns the stored goals with a warning, never a throw, so the agent does not write them again', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'inbox-goals-test-'))
  try {
    const stuck: Lock = { ...folderLock, remove: async () => false }
    const told: string[] = []

    const goals = await updateGoals(
      storeIn(folder, disk),
      stuck,
      's1',
      (fresh) => {
        const known = fresh ?? emptyGoals('s1', '/work')
        return { ...known, tasks: [plannedTask('Draw the bar', known)] }
      },
      told,
    )

    expect(goals.tasks.map((each) => each.title)).toEqual(['Draw the bar'])
    expect(parseGoals('s1', readFileSync(join(folder, 'goals', 's1.md'), 'utf8')).tasks.map((each) => each.title)).toEqual(['Draw the bar'])
    const [token] = readdirSync(join(folder, 'goals', 's1.md.lock'))
    expect(told).toEqual([`The goals of session s1 were written. rm could not remove the token ${token} from the lock ${join(folder, 'goals', 's1.md.lock')}, so the next write waits until it is 10 s old.`])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test("a writer whose lock was broken as stale leaves the next writer's lock in place, and its answer warns that the next write can replace its own", async () => {
  const folder = mkdtempSync(join(tmpdir(), 'inbox-goals-test-'))
  try {
    const lock = join(folder, 'goals', 's1.md.lock')
    const firstWriting = Promise.withResolvers<void>()
    const secondTook = Promise.withResolvers<void>()
    const firstDone = Promise.withResolvers<void>()
    const slow: Disk = {
      ...disk,
      write: async (path, text) => {
        if (path.endsWith('/s1.md')) {
          firstWriting.resolve()
          await secondTook.promise
        }
        return disk.write(path, text)
      },
    }
    const waiting: Disk = { ...disk, write: async (path, text) => (path.endsWith('/s1.md') ? firstDone.promise.then(() => disk.write(path, text)) : disk.write(path, text)) }
    const second: Lock = {
      ...folderLock,
      take: async (path, token) => {
        const isTaken = await folderLock.take(path, token)
        if (isTaken) secondTook.resolve()
        return isTaken
      },
    }
    const added = (onDisk: Disk, lockOf: Lock, title: string, told: string[]) =>
      updateGoals(
        storeIn(folder, onDisk),
        lockOf,
        's1',
        (fresh) => {
          const known = fresh ?? emptyGoals('s1', '/work')
          return { ...known, tasks: [...known.tasks, plannedTask(title, known)] }
        },
        told,
      )
    const told: string[] = []

    const first = added(slow, folderLock, 'Draw the bar', told)
    await firstWriting.promise
    const [stale = ''] = readdirSync(lock)
    const left = new Date(Date.now() - 11_000)
    utimesSync(join(lock, stale), left, left)
    const next = added(waiting, second, 'Color the bar', [])
    await first
    const heldAfterFirst = readdirSync(lock)
    firstDone.resolve()
    await next

    expect(heldAfterFirst).toHaveLength(1)
    expect(heldAfterFirst).not.toContain(stale)
    expect(told).toEqual([`The goals of session s1 were written. This write held the lock ${lock} over 10 s, so another writer broke it as stale, and that writer's write can have replaced this one.`])
    expect(parseGoals('s1', readFileSync(join(folder, 'goals', 's1.md'), 'utf8')).tasks.map((each) => each.title)).toEqual(['Color the bar'])
    expect(readdirSync(join(folder, 'goals'))).toEqual(['s1.md'])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('two writers that both find a stale lock never both write inside it, though the first breaks and takes it before the second acts on what it found', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'inbox-goals-test-'))
  try {
    const lock = join(folder, 'goals', 's1.md.lock')
    mkdirSync(lock, { recursive: true })
    writeFileSync(join(lock, 'stopped'), '')
    const left = new Date(Date.now() - 11_000)
    utimesSync(join(lock, 'stopped'), left, left)
    const secondFoundStale = Promise.withResolvers<void>()
    const firstTook = Promise.withResolvers<void>()
    const secondTookAgain = Promise.withResolvers<void>()
    let inside = 0
    let mostInside = 0
    const writer = (isFirst: boolean): Lock => {
      let held: string | undefined
      let takes = 0
      let hasFoundStale = false
      return {
        ...folderLock,
        take: async (path, token) => {
          const isTaken = await folderLock.take(path, token)
          takes += 1
          if (isTaken) {
            held = `${path}/${token}`
            inside += 1
            mostInside = Math.max(mostInside, inside)
            if (isFirst) firstTook.resolve()
          }
          if (!isFirst && takes === 2) secondTookAgain.resolve()
          return isTaken
        },
        tokens: async (path) => {
          if (path !== lock || hasFoundStale) return folderLock.tokens(path)
          hasFoundStale = true
          if (isFirst) await secondFoundStale.promise
          const found = await folderLock.tokens(path)
          if (!isFirst) {
            secondFoundStale.resolve()
            await firstTook.promise
          }
          return found
        },
        remove: async (path) => {
          const isRemoved = await folderLock.remove(path)
          if (isRemoved && path === held) {
            held = undefined
            inside -= 1
          }
          return isRemoved
        },
      }
    }
    const heldOpen: Disk = { ...disk, write: async (path, text) => (path.endsWith('/s1.md') ? secondTookAgain.promise.then(() => disk.write(path, text)) : disk.write(path, text)) }
    const told: string[] = []
    const added = (onDisk: Disk, lockOf: Lock, title: string) =>
      updateGoals(
        storeIn(folder, onDisk),
        lockOf,
        's1',
        (fresh) => {
          const known = fresh ?? emptyGoals('s1', '/work')
          return { ...known, tasks: [...known.tasks, plannedTask(title, known)] }
        },
        told,
      )

    const written = await Promise.allSettled([added(heldOpen, writer(true), 'Draw the bar'), added({ ...disk }, writer(false), 'Color the bar')])

    expect(mostInside).toBe(1)
    expect(written.map((each) => each.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(told).toEqual([])
    expect(parseGoals('s1', readFileSync(join(folder, 'goals', 's1.md'), 'utf8')).tasks.map((each) => each.title)).toEqual(['Draw the bar', 'Color the bar'])
    expect(readdirSync(join(folder, 'goals'))).toEqual(['s1.md'])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})

test('parseGoals refuses an active task with no owner, and names what it lacks', () => {
  const goals: Goals = { ...emptyGoals('test-session', '/work'), tasks: [{ id: 't1', title: 'Draw the bar', state: 'active', serves: [], owner: 'test-session', isRequired: false, startedAt: '2026-11-22T10:01:00.000Z', corrections: [] }] }
  const ownerless = goalsMarkdown(goals).replace('"owner":"test-session",', '')

  expect(ownerless).not.toContain('owner')
  expect(() => parseGoals('test-session', ownerless)).toThrow('goals/test-session.md heading 1, "task", has no owner, which every active task holds.')
})

test('the gate refuses a set once per turn, so a task left active refuses the stop again in the next turn', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  await called(mod, 'start', { task: 't1' })
  const refused = await mod.raise.beforeTurnEnd()
  const passed = await mod.raise.beforeTurnEnd()

  const next = await said(mod, 'Keep going')
  await called(mod, 'file', { prompt: next, reason: 'Asks nothing new' })
  const nextTurn = await mod.raise.beforeTurnEnd()

  expect([refused, passed]).toEqual([{ refuse: expect.stringContaining('- t1: Draw the bar') }, undefined])
  expect(nextTurn).toEqual({ refuse: expect.stringContaining('- t1: Draw the bar') })
})

test("a subagent that ends with its task active hands the task back to the main agent's gate", async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  await mod.add({ type: ToolCall, name: 'Agent', callId: 'agent-call', input: { description: 'Draw it', prompt: 'Draw the bar' } })
  const task = await mod.startTask({ title: 'Draw it', agentType: 'general-purpose', openedBy: 'agent-call' })
  await mod.add({ type: Prompt, text: 'Draw the bar' }, { task })
  const claudeCode = claudeCodeOf(mod)
  const stop = (isAfterRefusal: boolean) => claudeCode.fire('SubagentStop', { agent_id: task, agent_type: 'general-purpose', stop_hook_active: isAfterRefusal, agent_transcript_path: '', last_assistant_message: 'Done.' })
  await mod.raise.beforeToolCall({ name: 'mcp__inbox__start', input: { task: 't1' } }, { task })
  await called(mod, 'start', { task: 't1' })

  await stop(false)
  await stop(true)
  await stop(true)
  await mod.add({ type: ToolResult, callId: 'agent-call', output: 'Done.' })
  await mod.settle()

  expect((await storedGoals(mod)).tasks[0]).toEqual(expect.objectContaining({ state: 'active', owner: 'test-session' }))
  expect((await storedGoals(mod)).tasks[0]?.cmodTask).toBeUndefined()
  expect(await mod.raise.beforeTurnEnd()).toEqual({ refuse: expect.stringContaining('- t1: Draw the bar') })
})

test("a subagent's note leaves out the main agent's unfiled prompts", async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  await said(mod, 'Make the bar green')
  const task = await mod.startTask({ title: 'Draw it', agentType: 'general-purpose' })

  const subagent = await mod.raise.beforePrompt({ text: 'Draw the bar' }, { task })
  const main = await mod.raise.beforeSessionStart({ source: 'compact' })

  expect(subagent).toEqual({ note: expect.stringContaining('- t1 planned: Draw the bar (serves r1)') })
  expect(JSON.stringify(subagent)).not.toContain('Make the bar green')
  expect(JSON.stringify(subagent)).not.toContain('Not filed yet')
  expect(main?.note).toContain('Make the bar green')
})

test('a person prompt sends the agent a note naming the id to file it under, and a worded answer names its id', async () => {
  const mod = tested()
  const tick = ticking(mod)
  const id = await said(mod, 'Make the bar green')
  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''

  await mod.shown.view.input(`answer:${asked}`, 'Yes, but only paid ones')
  await tick()

  expect(mod.shown.notes).toContainEqual(`Inbox: the user's words in this prompt wait to be filed. Call mcp__inbox__file with prompt ${id}.`)
  expect(mod.shown.prompts.at(-1)?.split('\n').at(-1)).toBe(`The user's words in this answer wait to be filed. Call mcp__inbox__file with prompt ${asked}#1.`)
})

test('file refuses a quote that is part of a word, and takes the same letters as whole words', async () => {
  const mod = tested()
  const id = await said(mod, 'start the release')

  const deny = await denied(mod, 'file', { prompt: id, requirements: [{ capability: 'Release', line: 'The release starts', quotes: ['art'] }] })
  await called(mod, 'file', { prompt: id, requirements: [{ capability: 'Release', line: 'The release starts', quotes: ['start the'] }] })

  expect(deny).toBe(`The file tool failed: "art" is not word for word in ${id}. Copy the user's exact words from it: "start the release"`)
  expect((await storedGoals(mod)).requirements[0]?.quotes.map((each) => each.words)).toEqual(['start the'])
})

test('Correct… on a task in the Tasks view stores the typed words in its corrections, which the next note quotes', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  await mod.hotkey('tasks')

  await mod.shown.view.press('task:t1')
  await mod.shown.view.press('tasks:correct:t1:open')
  await mod.shown.view.input('tasks:correct:t1', 'Only the failing tests')
  const note = await mod.raise.beforeSessionStart({ source: 'compact' })

  expect((await storedGoals(mod)).tasks[0]?.corrections).toEqual([{ words: 'Only the failing tests', source: 'view', id: expect.stringMatching(/^view:/), at: expect.any(String) }])
  expect(mod.state.session.openField).toBeNull()
  expect(note?.note?.split('\n')).toContain('    > Only the failing tests')
})

const activeTask = (id: string, title: string, owner: string, cmodTask?: string): Goals['tasks'][number] => ({ id, title, state: 'active', serves: [], owner, startedAt: '2026-11-22T10:00:00.000Z', isRequired: false, corrections: [], ...(cmodTask === undefined ? {} : { cmodTask }) })

test('a /resume to a session gives a note holding its requirements and open tasks, read from its goals file', async () => {
  const resumed: Goals = {
    ...emptyGoals('resumed', '/work'),
    requirements: [{ id: 'r1', capability: 'Progress view', line: 'Progress shows beside the session', quotes: [{ words: 'progress bar beside the session', source: 'prompt', id: 'p1', at: '2026-11-22T10:00:00.000Z' }] }],
    tasks: [{ id: 't1', title: 'Draw the bar', state: 'planned', serves: ['r1'], isRequired: false, corrections: [] }],
  }
  const mod = tested({ files: { [goalsFile('resumed')]: goalsMarkdown(resumed) } })
  await mod.start()

  const started = JSON.stringify(await claudeCodeOf(mod).fire('SessionStart', { source: 'resume', session_id: 'resumed' }))

  expect(started).toContain('- r1 open, Progress view: Progress shows beside the session')
  expect(started).toContain('- t1 planned: Draw the bar (serves r1)')
})

test('a session no Claude app shows, such as claude -p, files no prompt, is never refused at its stop, and keeps its checklist', async () => {
  const mod = tested()
  mod.fakes.session.surfaces = async () => []
  await said(mod, 'Make the bar green')

  const stopped = await mod.raise.beforeTurnEnd()
  const checklist = await mod.raise.beforeToolCall({ name: 'TaskCreate', input: { subject: 'Draw the bar' } })

  expect([stopped, checklist, mod.state.session.unfiled]).toEqual([undefined, undefined, []])
})

test("finish, wait, and drop refuse a task of another session that a running third session took, naming that session", async () => {
  const planner: Goals = { ...emptyGoals('planner', '/work'), tasks: [activeTask('t1', 'Write the migration', 'reviewer')] }
  const mod = tested({ files: { [goalsFile('planner')]: goalsMarkdown(planner) }, sessions: [...listed, { id: 'reviewer', title: 'schema review', isRunning: true }] })
  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''
  await mod.settle()

  const denials = [
    await denied(mod, 'finish', { task: 't1', session: 'planner', evidence: ['bun test: 3 pass'] }),
    await denied(mod, 'wait', { task: 't1', session: 'planner', on: asked }),
    await denied(mod, 'drop', { task: 't1', session: 'planner', reason: 'No time' }),
  ]

  expect(denials).toEqual([
    'The finish tool failed: t1 is active in session reviewer, which took it and still runs, so only that session can finish it.',
    'The wait tool failed: t1 is active in session reviewer, which took it and still runs, so only that session can make it wait.',
    'The drop tool failed: t1 is active in session reviewer, which took it and still runs, so only that session can drop it.',
  ])
  expect((await storedGoals(mod, 'planner')).tasks[0]).toEqual(activeTask('t1', 'Write the migration', 'reviewer'))
})

test('a requirement the user adds between turns prompts the agent, and a task the user reopens in the turn that prompt opens is a note', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  await called(mod, 'start', { task: 't1' })
  await called(mod, 'finish', { task: 't1', evidence: ['bun test: 3 pass'] })
  await mod.endTurn()
  await mod.hotkey('goal')
  await mod.shown.view.press('goal:add:open')
  await mod.shown.view.input('goal:add:capability', 'Progress view', 'change')
  await mod.shown.view.input('goal:add', 'The bar shows the tests')
  const added = mod.shown.prompts.at(-1)

  await mod.hotkey('tasks')
  await mod.shown.view.press('evidence:t1')
  await mod.shown.view.press('reopen:t1')

  expect([added, mod.shown.notes.at(-1)]).toEqual(['Inbox: the user added requirement r2 to Progress view: "The bar shows the tests"', 'Inbox: the user reopened task t1, "Draw the bar", so it is planned again.'])
})

test("a load hands back to the main agent's gate an active task whose subagent no longer runs, and keeps the task of a subagent that runs", async () => {
  const mod = tested()
  const tick = ticking(mod)
  const running = await mod.startTask({ title: 'Color it', agentType: 'general-purpose' })
  mod.fakes.agent.list = async () => [fakeAgent({ id: running, type: 'general-purpose', description: 'Color it', status: 'running' })]
  const goals: Goals = { ...emptyGoals('test-session', '/work'), tasks: [activeTask('t1', 'Draw the bar', 'test-session', 'agent-gone'), activeTask('t2', 'Color the bar', 'test-session', running)], updatedAt: new Date().toISOString() }
  await mod.fakes.fs.write?.(goalsFile('test-session'), goalsMarkdown(goals))

  await tick()
  await mod.add({ type: Prompt, text: 'Keep going' })
  const refused = await mod.raise.beforeTurnEnd()

  expect((await storedGoals(mod)).tasks.map((each) => [each.id, each.cmodTask])).toEqual([
    ['t1', undefined],
    ['t2', running],
  ])
  expect(refused).toEqual({ refuse: expect.stringContaining('- t1: Draw the bar') })
  expect(JSON.stringify(refused)).not.toContain('Color the bar')
})

test('a task taken in the list of a session that does not run stays in the gate after a reload of every file', async () => {
  const ended: Goals = { ...emptyGoals('ended', '/work'), tasks: [{ id: 't1', title: 'Write the migration', state: 'planned', serves: [], isRequired: false, corrections: [] }] }
  const mod = tested({ files: { [goalsFile('ended')]: goalsMarkdown(ended) }, sessions: listed })
  await called(mod, 'start', { task: 't1', session: 'ended' })

  await mod.startSession({ source: 'resume', id: 'test-session' })
  await mod.add({ type: Prompt, text: 'Keep going' })

  expect(mod.state.session.takenFrom).toEqual(['ended'])
  expect(await mod.raise.beforeTurnEnd()).toEqual({ refuse: expect.stringContaining('- t1 of session ended: Write the migration') })
})

test('a refusal and the quote error name an unfiled prompt by its first line, cut to 120 characters, and the compaction note keeps its whole text', async () => {
  const mod = tested()
  const rest = 'and then '.repeat(560)
  const multiline = await said(mod, `Make the bar green\n${rest}`)
  const oneLine = await said(mod, `Make the bar wide ${rest}`)

  const stopped = await mod.raise.beforeTurnEnd()
  const refused = stopped !== undefined && 'refuse' in stopped ? stopped.refuse : ''
  const deny = await denied(mod, 'file', { prompt: multiline, requirements: [{ capability: 'Progress view', line: 'The bar is green', quotes: ['a green bar'] }] })
  const note = (await mod.raise.beforeSessionStart({ source: 'compact' }))?.note ?? ''

  expect(`Make the bar green\n${rest}`.length).toBeGreaterThan(5000)
  expect(refused).toContain(`- ${multiline}: "Make the bar green…"`)
  expect(refused).toContain(`- ${oneLine}: "${`Make the bar wide ${rest}`.slice(0, 119)}…"`)
  expect(refused).not.toContain(rest.trim())
  expect(deny).toBe(`The file tool failed: "a green bar" is not word for word in ${multiline}. Copy the user's exact words from it: "Make the bar green…"`)
  expect(note).toContain(JSON.stringify(`Make the bar green\n${rest.trim()}`))
})

test("a subagent's start that is denied before it runs, then the main agent's start of the same task, stores no cmod task", async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  const task = await mod.startTask({ title: 'Draw it', agentType: 'general-purpose' })
  await mod.add({ type: Prompt, text: 'Draw the bar' }, { task })

  await mod.raise.beforeToolCall({ name: 'mcp__inbox__start', input: { task: 't1' }, callId: 'denied-start' }, { task })
  await mod.add({ type: ToolCall, name: 'mcp__inbox__start', callId: 'denied-start', input: { task: 't1' } }, { task })
  await mod.add({ type: ToolResult, callId: 'denied-start', output: 'The user denied this call.', isError: true }, { task })
  await called(mod, 'start', { task: 't1' })

  expect((await storedGoals(mod)).tasks[0]).toEqual(expect.objectContaining({ state: 'active', owner: 'test-session' }))
  expect((await storedGoals(mod)).tasks[0]?.cmodTask).toBeUndefined()
})

test('finish of a task whose owner session no longer runs succeeds from another session', async () => {
  const planner: Goals = { ...emptyGoals('planner', '/work'), tasks: [activeTask('t1', 'Write the migration', 'ended')] }
  const mod = tested({ files: { [goalsFile('planner')]: goalsMarkdown(planner) }, sessions: listed })
  await mod.start()
  await mod.settle()

  const finished = await called(mod, 'finish', { task: 't1', session: 'planner', evidence: ['bun test: 3 pass'] })

  expect(finished).toStartWith('Finished t1: Write the migration.')
  expect((await storedGoals(mod, 'planner')).tasks[0]).toEqual(expect.objectContaining({ state: 'done', owner: 'ended', evidence: ['bun test: 3 pass'] }))
})

test("a fork gets a note holding the requirements of the conversation it was forked from, and the fork's goals file holds them", async () => {
  const mod = tested()
  const id = await said(mod, 'Make the bar green')
  await called(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: 'The bar is green', quotes: ['the bar green'] }] })

  const started = JSON.stringify(await claudeCodeOf(mod).fire('SessionStart', { source: 'fork', session_id: 'forked' }))

  expect(started).toContain('- r1 open, Progress view: The bar is green')
  expect((await storedGoals(mod, 'forked')).requirements).toEqual([{ id: 'r1', capability: 'Progress view', line: 'The bar is green', quotes: [{ words: 'the bar green', source: 'prompt', id, at: expect.any(String) }] }])
  expect((await storedGoals(mod, 'forked')).filings).toEqual([{ id, source: 'prompt', requirements: ['r1'] }])
  expect(mod.state.session.goalsSession).toBe('forked')
})

test('file refuses a quote that holds no letter or digit, though the prompt holds it', async () => {
  const mod = tested()
  const id = await said(mod, 'Make the bar green.')

  const deny = await denied(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: 'The bar is green', quotes: ['.'] }] })

  expect(deny).toBe(`The file tool failed: "." is not word for word in ${id}. Copy the user's exact words from it: "Make the bar green."`)
  expect(mod.state.session.unfiled.map((each) => each.id)).toEqual([id])
})

test("finish of the only task taken from a session that does not run drops that session, so a reload of every file no longer reads its goals file", async () => {
  const ended: Goals = { ...emptyGoals('ended', '/work'), tasks: [{ id: 't1', title: 'Write the migration', state: 'planned', serves: [], isRequired: false, corrections: [] }] }
  const mod = tested({ files: { [goalsFile('ended')]: goalsMarkdown(ended) }, sessions: listed })
  await called(mod, 'start', { task: 't1', session: 'ended' })
  const taken = mod.state.session.takenFrom
  await called(mod, 'finish', { task: 't1', session: 'ended', evidence: ['bun test: 3 pass'] })
  const finishedAt = mod.calls.length

  await mod.startSession({ source: 'resume', id: 'test-session' })

  expect([taken, mod.state.session.takenFrom]).toEqual([['ended'], []])
  expect(mod.calls.slice(finishedAt).filter((call) => call.call === 'fs.read' && call.args[0] === goalsFile('ended'))).toEqual([])
  expect(Object.keys(mod.state.memory.goals)).not.toContain('ended')
})

test('Correct… on a task that session planner took sends the words to planner, and never to this session', async () => {
  const goals: Goals = { ...emptyGoals('test-session', '/work'), tasks: [activeTask('t1', 'Draw the bar', 'planner')] }
  const mod = tested({ files: { [goalsFile('test-session')]: goalsMarkdown(goals) } })
  await mod.start()
  await mod.settle()
  await mod.hotkey('tasks')

  await mod.shown.view.press('task:t1')
  await mod.shown.view.press('tasks:correct:t1:open')
  await mod.shown.view.input('tasks:correct:t1', 'Only the failing tests')

  const told = 'Inbox: the user corrected task t1, "Draw the bar": "Only the failing tests"'
  expect(mod.shown.sent).toEqual([expect.objectContaining({ session: 'planner', text: told })])
  expect([...mod.shown.prompts, ...mod.shown.notes]).not.toContain(told)
})

test('a session no Claude app shows adds no unfiled entry for a worded answer, and its prompt holds no filing sentence', async () => {
  const mod = tested()
  mod.fakes.session.surfaces = async () => []
  const tick = ticking(mod)
  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''

  await mod.shown.view.input(`answer:${asked}`, 'Yes, but only paid ones')
  await tick()

  expect(mod.shown.prompts.at(-1)).toBe(`Inbox: the user answered "Do we want courses?" (${asked}), answer 1: "Yes, but only paid ones"`)
  expect(mod.state.session.unfiled).toEqual([])
})

test("a fork whose first copy of the requirements fails still copies them on a later load, after a file call wrote the fork's own file", async () => {
  const mod = tested()
  const tick = ticking(mod)
  const id = await said(mod, 'Make the bar green')
  await called(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: 'The bar is green', quotes: ['the bar green'] }] })
  const parent = String(await mod.fakes.fs.read?.(goalsFile('test-session')))
  await mod.fakes.fs.write?.(goalsFile('test-session'), 'not goals')

  await mod.startSession({ source: 'fork', id: 'forked' })
  const thanks = await said(mod, 'Thanks')
  await called(mod, 'file', { prompt: thanks, reason: 'Thanks the agent' })
  const beforeCopy = mod.state.session.goalsSession
  await mod.fakes.fs.write?.(goalsFile('test-session'), parent)
  await tick()

  expect(beforeCopy).toBe('test-session')
  expect((await storedGoals(mod, 'forked')).requirements.map((each) => each.line)).toEqual(['The bar is green'])
  expect((await storedGoals(mod, 'forked')).filings.map((each) => each.id)).toEqual([thanks, id])
  expect(mod.state.session.goalsSession).toBe('forked')
})

test('an item answer stored while a stale goals lock is held lands before the lock breaks', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'inbox-goals-test-'))
  try {
    const store = storeIn(folder, disk)
    const isWaiting = Promise.withResolvers<void>()
    const breaks = Promise.withResolvers<void>()
    let isBroken = false
    const stale: Lock = {
      ...folderLock,
      take: async (path, token) => isBroken && folderLock.take(path, token),
      tokens: async () => [{ name: 'stopped', modifiedAt: Date.now() }],
      wait: async () => {
        isWaiting.resolve()
        await breaks.promise
        isBroken = true
      },
    }
    const at = '2026-11-22T10:00:00.000Z'
    const item: Item = { format, id: 'courses', kind: 'question', project: '/work', origin: { session: 's1' }, subscribers: [{ session: 's1', since: at }], revisions: [{ session: 's1', content: { kind: 'question', ...question }, at }], updatedAt: at }
    const goalsWrite = updateGoals(store, stale, 's1', () => emptyGoals('s1', '/work'), [])
    await isWaiting.promise

    const answered = await updatePerson(store, item, (fresh) => ({ ...fresh, answers: [{ kind: 'answer', words: 'Yes', revision: 0, at }] }))
    breaks.resolve()
    await goalsWrite

    expect(answered.answers.map((each) => each.words)).toEqual(['Yes'])
    expect(readdirSync(join(folder, 'goals'))).toEqual(['s1.md'])
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}, 1000)

test('after a resume to another session, the note shows its task that waits on an open item as waiting on you', async () => {
  const mod = tested()
  const asked = (await called(mod, 'ask_question', question)).match(/ as (\S+), /)?.[1] ?? ''
  const resumed: Goals = { ...emptyGoals('resumed', '/work'), tasks: [{ ...activeTask('t1', 'Pick the schema', 'resumed'), waitsOn: asked }] }
  await mod.fakes.fs.write?.(goalsFile('resumed'), goalsMarkdown(resumed))
  const { read, exists } = mod.fakes.fs
  const secondLoad = Promise.withResolvers<void>()
  let loads = 0
  mod.fakes.fs.exists = async (path) => {
    if (path === progressFile('resumed') && ++loads === 2) secondLoad.resolve()
    return (await exists?.(path)) === true
  }
  mod.fakes.fs.read = async (path) => {
    if (path.startsWith(`${data}/items/`)) await secondLoad.promise
    return String(await read?.(path))
  }

  const started = JSON.stringify(await claudeCodeOf(mod).fire('SessionStart', { source: 'resume', session_id: 'resumed' }))

  expect(started).toContain(`- t1 waiting on you on ${asked}: Pick the schema`)
})

test("an unreadable goals file in session.takenFrom leaves this session's own requirements in the note", async () => {
  const ended: Goals = { ...emptyGoals('ended', '/work'), tasks: [{ id: 't1', title: 'Write the migration', state: 'planned', serves: [], isRequired: false, corrections: [] }] }
  const mod = tested({ files: { [goalsFile('ended')]: goalsMarkdown(ended) }, sessions: listed })
  const id = await said(mod, 'Make the bar green')
  await called(mod, 'file', { prompt: id, requirements: [{ capability: 'Progress view', line: 'The bar is green', quotes: ['the bar green'] }] })
  await called(mod, 'start', { task: 't1', session: 'ended' })
  await mod.fakes.fs.write?.(goalsFile('ended'), 'not goals')

  const answer = await mod.raise.beforeSessionStart({ source: 'compact' })

  expect(mod.state.session.takenFrom).toEqual(['ended'])
  expect(answer?.note).toContain('- r1 open, Progress view: The bar is green')
})

test("a load keeps the cmod task of a task that a running subagent's own subagent holds", async () => {
  const mod = tested()
  const tick = ticking(mod)
  const parent = await mod.startTask({ title: 'Plan it', agentType: 'general-purpose' })
  const nested = await mod.startTask({ title: 'Draw it', agentType: 'general-purpose', parent })
  const goals: Goals = { ...emptyGoals('test-session', '/work'), tasks: [activeTask('t1', 'Draw the bar', 'test-session', nested)], updatedAt: new Date().toISOString() }
  await mod.fakes.fs.write?.(goalsFile('test-session'), goalsMarkdown(goals))

  await tick()

  expect((await storedGoals(mod)).tasks[0]?.cmodTask).toBe(nested)
})

test('a goal changed from the Goal view tells the agent the id to file it under', async () => {
  const mod = tested()
  await mod.hotkey('goal')

  await goalSet(mod, 'Progress shows in the Sidebar')

  const [unfiled] = mod.state.session.unfiled
  expect(unfiled?.id).toStartWith('view:')
  expect(mod.shown.prompts.at(-1)?.split('\n')).toEqual(['Inbox: the user set this session\'s goal: "Progress shows in the Sidebar"', `The user's words in this goal wait to be filed. Call mcp__inbox__file with prompt ${unfiled?.id}.`])
})
