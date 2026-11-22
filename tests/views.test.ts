import { expect, test } from 'bun:test'
import { BelowPrompt, Dashboard, Person, Prompt, Working, type Subprocess } from '../node_modules/@cmodjs/core/mod.js'
import { testMod } from '../node_modules/@cmodjs/core/testing.js'
import { counts, emptyGoals, shownState, type Goals } from '../src/goals/goal.js'
import { goalsMarkdown } from '../src/goals/markdown.js'
import { inbox } from '../src/mod.js'

const data = '/test/home/.local/share/cmod/data/inbox'

const goalsFile = (session: string) => `${data}/goals/${session}.md`

function serving(): Subprocess {
  async function* written() {
    yield { stream: 'stdout' as const, text: '127.0.0.1:4800\n' }
    return await new Promise<never>(() => undefined)
  }
  return Object.assign(written(), { result: new Promise<never>(() => undefined) })
}

function tested(files: Record<string, string> = {}) {
  const mod = testMod(inbox, {
    projectRoot: '/work',
    files: { [`${data}/delivering-since`]: '2026-10-01T00:00:00.000Z\n', ...files },
    sessions: [
      { id: 'test-session', title: 'claude inbox', isRunning: true, goal: 'You see progress in the Sidebar' },
      { id: 'planner', title: 'schema planning', isRunning: true, goal: 'Courses have a schema' },
    ],
  })
  mod.fakes.process.run = async (argv) => ({ exitCode: 0, stdout: argv[0] === 'git' ? '/work/.git' : JSON.stringify({ results: [] }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  mod.fakes.process.spawn = () => serving()
  return mod
}

type Tested = ReturnType<typeof tested>

async function called(mod: Tested, name: string, input: Record<string, unknown>): Promise<string> {
  const answer = await mod.callTool(name, input)
  if (!('result' in answer)) throw new Error(`The ${name} call was denied: ${JSON.stringify(answer)}`)
  return String(answer.result)
}

async function planned(mod: Tested, tasks: readonly Record<string, unknown>[]): Promise<void> {
  const [prompt] = await mod.add({ type: Prompt, text: 'Show the progress bar beside the session', from: { type: Person } })
  await called(mod, 'file', { prompt: prompt?.id, requirements: [{ capability: 'Progress view', line: 'Progress shows beside the session', quotes: ['progress bar beside the session'] }] })
  await called(mod, 'plan', { tasks })
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const ownGoals: Goals = {
  ...emptyGoals('test-session', '/work'),
  requirements: [
    { id: 'r1', capability: 'Progress view', line: 'Progress shows beside the session', quotes: [{ words: 'put it in the sidebar', source: 'prompt', id: 'p1', at: minutesAgo(40) }] },
    { id: 'r2', capability: 'Progress view', line: 'Agents set it from blocks', quotes: [{ words: 'from primitives', source: 'prompt', id: 'p1', at: minutesAgo(40) }] },
  ],
  tasks: [
    { id: 't1', title: 'Draw the bar', state: 'done', serves: ['r1'], owner: 'test-session', isRequired: false, evidence: ['bun test: 3 pass'], startedAt: minutesAgo(38), endedAt: minutesAgo(20), corrections: [] },
    { id: 't2', title: 'Move the browser view', state: 'active', serves: ['r2'], owner: 'test-session', isRequired: false, startedAt: minutesAgo(12), corrections: [] },
  ],
}

const plannerGoals: Goals = {
  ...emptyGoals('planner', '/work'),
  requirements: [{ id: 'r1', capability: 'Schema', line: 'Courses have a table', quotes: [{ words: 'a courses table', source: 'prompt', id: 'p9', at: minutesAgo(30) }] }],
  tasks: [{ id: 't1', title: 'Write the migration', state: 'done', serves: ['r1'], owner: 'planner', isRequired: false, evidence: ['migrated'], startedAt: minutesAgo(28), endedAt: minutesAgo(25), corrections: [] }],
}

test('a task waiting on an open item is waiting on you, and its Open on the Tasks view shows that item in the Inbox view', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Pick the schema', serves: ['r1'] }])
  const asked = (await called(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })).match(/ as (\S+), /)?.[1] ?? ''
  await called(mod, 'start', { task: 't1' })
  await mod.hotkey('tasks')
  await expect(mod.shown.view.press('open:t1')).rejects.toThrow('open:t1')

  await called(mod, 'wait', { task: 't1', on: asked })
  const { goals, items, person } = mod.state.memory
  const own = goals['test-session'] ?? emptyGoals('test-session', '/work')
  await mod.shown.view.press('open:t1')

  expect(own.tasks.map((task) => shownState(task, own, items, person))).toEqual(['waiting on you'])
  expect([mod.shown.view.id, mod.state.session.viewing]).toEqual(['inbox', asked])
})

test("Reopen on a done task's evidence makes it Planned", async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  await called(mod, 'start', { task: 't1' })
  await called(mod, 'finish', { task: 't1', evidence: ['bun test: 3 pass'] })

  await mod.hotkey('tasks')
  await mod.shown.view.press('evidence:t1')
  await mod.shown.view.press('reopen:t1')

  expect(mod.state.memory.goals['test-session']?.tasks[0]).toEqual({ id: 't1', title: 'Draw the bar', state: 'planned', serves: ['r1'], isRequired: false, corrections: [] })
})

test('Edit, typed text, and Save and tell on the Goal view set the goal and send the agent a prompt while it is idle', async () => {
  const mod = tested()
  await mod.hotkey('goal')

  await mod.shown.view.press('goal:edit')
  await mod.shown.view.input('goal:text', 'Progress shows in the Sidebar and the browser', 'change')
  await mod.shown.view.press('goal:save')
  const read = JSON.parse(await called(mod, 'read', { session: 'test-session' })) as { goal: string }

  expect(read.goal).toBe('Progress shows in the Sidebar and the browser')
  expect(mod.shown.prompts.at(-1)?.split('\n')[0]).toBe('Inbox: the user set this session\'s goal: "Progress shows in the Sidebar and the browser"')
  expect(mod.state.session.openField).toBeNull()
})

test('Correct… on a requirement stores the typed words as a quote on it', async () => {
  const mod = tested()
  await planned(mod, [{ title: 'Draw the bar', serves: ['r1'] }])
  await mod.hotkey('goal')

  await mod.shown.view.press('quotes:r1')
  await mod.shown.view.press('goal:correct:r1:open')
  await mod.shown.view.input('goal:correct:r1', 'Only the failing tests')

  expect(mod.state.memory.goals['test-session']?.requirements[0]?.quotes.map((each) => [each.source, each.words])).toEqual([
    ['prompt', 'progress bar beside the session'],
    ['view', 'Only the failing tests'],
  ])
})

test('Add a requirement on the Goal view stores the typed words under the capability', async () => {
  const mod = tested()
  await mod.hotkey('goal')

  await mod.shown.view.press('goal:add:open')
  await mod.shown.view.input('goal:add:capability', 'Toasts', 'change')
  await mod.shown.view.input('goal:add', 'A toast names the item')

  expect(mod.state.memory.goals['test-session']?.requirements).toEqual([{ id: 'r1', capability: 'Toasts', line: 'A toast names the item', quotes: [{ words: 'A toast names the item', source: 'view', id: expect.stringMatching(/^view:/), at: expect.any(String) }] }])
})

test('the goal, task, and Sessions widgets each draw from the goals files, and the goal and task widgets open their views', async () => {
  const mod = tested({ [goalsFile('test-session')]: goalsMarkdown(ownGoals), [goalsFile('planner')]: goalsMarkdown(plannerGoals) })
  await mod.start()
  await mod.settle()
  const { goals, goalTexts, items, person } = mod.state.memory

  expect(goals).toEqual({ 'test-session': ownGoals, planner: plannerGoals })
  expect(goalTexts).toEqual({ 'test-session': 'You see progress in the Sidebar', planner: 'Courses have a schema' })
  expect([counts(ownGoals, items, person), counts(plannerGoals, items, person)]).toEqual([
    { met: 1, requirements: 2, done: 1, tasks: 2, waitingOnYou: 0 },
    { met: 1, requirements: 1, done: 1, tasks: 1, waitingOnYou: 0 },
  ])
  expect(await mod.lines(Dashboard)).toHaveLength(3)

  await mod.press(BelowPrompt, 'open-goal')
  expect(mod.shown.view.id).toBe('goal')
  await mod.press(Working, 'open-tasks')
  expect(mod.shown.view.id).toBe('tasks')
})

test('the goal, task, and Sessions widgets draw nothing without a goals file', async () => {
  const mod = testMod(inbox, { projectRoot: '/work', files: { [`${data}/delivering-since`]: '2026-10-01T00:00:00.000Z\n' }, sessions: [{ id: 'test-session', title: 'claude inbox', isRunning: true }] })
  mod.fakes.process.run = async () => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  mod.fakes.process.spawn = () => serving()
  await mod.start()
  await mod.settle()

  expect([await mod.lines(BelowPrompt), await mod.lines(Working), await mod.lines(Dashboard)]).toEqual([[], [], []])
})

test('the goal and tasks hotkeys open their views, and a second press hides them', async () => {
  const mod = tested()

  await mod.hotkey('goal')
  const goal = mod.shown.view.id
  await mod.hotkey('tasks')
  const tasks = mod.shown.view.id
  await mod.hotkey('tasks')

  expect([goal, tasks]).toEqual(['goal', 'tasks'])
  expect(() => mod.shown.view.id).toThrow('No view of inbox shows in the Sidebar')
})
