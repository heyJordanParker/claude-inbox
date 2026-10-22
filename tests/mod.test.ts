import { expect, test } from 'bun:test'
import { AbovePrompt } from '../node_modules/@cmodjs/core/mod.js'
import { testMod, type FakeSession } from '../node_modules/@cmodjs/core/testing.js'
import type { Item } from '../src/inbox.js'
import { inbox } from '../src/mod.js'

const project = '/work'

const files = {
  '/work/src/match.ts': ['export function check(expr: Expr): Type {', '  return infer(expr)', '}', '', 'export function lower(expr: Expr): Node {', '  return emit(expr)', '}'].join('\n'),
}

const traced = (argv: readonly string[]) => {
  const command = argv[3]
  if (command === 'api')
    return {
      results: [
        { name: 'check', header: 'export function check(expr: Expr): Type { … }', line: 1 },
        { name: 'lower', header: 'export function lower(expr: Expr): Node { … }', line: 5 },
      ],
    }
  return { results: [{ callers: [{ label: 'compile', source_file: 'src/compiler.ts', source_line: 12 }] }] }
}

const itemsFolder = '/test/home/.local/share/cmod/data/inbox/items'

function question(subscribers: Item['subscribers']): Item {
  const origin = subscribers[0] ?? { session: 'planner', title: 'schema planning' }
  return {
    id: 'courses',
    kind: 'question',
    project,
    origin,
    subscribers,
    revisions: [{ ...origin, at: '2026-10-22T10:00:00.000Z', content: { kind: 'question', title: 'Do we want courses?', why: 'It decides the schema' } }],
    answers: [],
    lastRead: -1,
    queuedAt: '2026-10-22T10:00:00.000Z',
    status: 'waiting',
  }
}

function tested(options: { readonly sessions?: readonly FakeSession[]; readonly files?: Record<string, string> } = {}) {
  const mod = testMod(inbox, { projectRoot: project, files: { ...files, ...options.files }, ...(options.sessions === undefined ? {} : { sessions: options.sessions }) })
  mod.fakes.process.run = async (argv) => ({ exitCode: 0, stdout: JSON.stringify(traced(argv)), stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  return mod
}

const solution = {
  title: 'No default',
  summary: 'The compiler proves every case is handled',
  idea: 'A match that covers every case needs **no** default.',
  precedent: 'Rust, C#',
  capabilities: ['A match over an enum compiles without a default'],
  drawings: [
    { kind: 'files', files: [{ path: 'src/match.ts', change: 'edit', note: 'learns exhaustiveness' }] },
    { kind: 'api', path: 'src/match.ts', changes: [{ name: 'check', change: 'edit', signature: 'export function check(expr: Expr, cases: Case[]): Type', note: 'takes the cases' }] },
    { kind: 'diff', path: 'src/match.ts', old: '  return infer(expr)', new: '  return exhaustive(infer(expr))' },
  ],
}

const proposal = {
  title: 'Exhaustive match needs no default',
  goal: 'Enums ship without boilerplate defaults',
  problems: [
    {
      title: 'A full match still demands a default',
      summary: 'Every enum match carries dead code',
      impact: 'Users write a default the compiler could prove unreachable',
      solution,
    },
  ],
}

async function filed(mod: ReturnType<typeof tested>, tool: string, input: Record<string, unknown>): Promise<Item> {
  const answer = await mod.callTool(tool, input)
  if (!('result' in answer)) throw new Error(`The ${tool} call was denied: ${JSON.stringify(answer)}`)
  const item = mod.state.memory.items.at(-1)
  if (item === undefined) throw new Error('Nothing was filed.')
  return item
}

test('a proposal waits in the inbox, and the count shows above the prompt', async () => {
  const mod = tested()
  await filed(mod, 'propose', proposal)
  await mod.type('/inbox')

  expect(await mod.lines(AbovePrompt)).toEqual(['inbox: 1 waiting'])
  const lines = await mod.shown.page.lines({ columns: 160 })
  expect(lines).toContain('Exhaustive match needs no default')
  expect(lines).toContain('Goal: Enums ship without boilerplate defaults')
  expect(lines).toContain('▸ Problem: A full match still demands a default — Every enum match carries dead code')
  expect(lines.join('\n')).not.toContain('Users write a default')
})

test('opening a Problem shows what it blocks and its Solution, and opening the Solution shows its idea and drawings', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await mod.type('/inbox')
  await mod.shown.page.press(`toggle:${item.id}:p0`)

  let lines = await mod.shown.page.lines({ columns: 160 })
  expect(lines).toContain('  Blocks: Users write a default the compiler could prove unreachable')
  expect(lines).toContain('  ▸ Solution: No default (Rust, C#) — The compiler proves every case is handled')

  await mod.shown.page.press(`toggle:${item.id}:p0.s`)
  lines = await mod.shown.page.lines({ columns: 160 })
  expect(lines.join('\n')).toContain('A match that covers every case needs')
  expect(lines).toContain('    • A match over an enum compiles without a default')
  expect(lines).toContain('    ▸ Files: src/match.ts')
  expect(lines).toContain('    ▸ API: src/match.ts')
  expect(lines).toContain('    ▸ Diff: src/match.ts:2')
})

test('the inbox draws the whole public API of a changed file and the callers of a changed signature from the code', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await mod.type('/inbox')
  for (const path of ['p0', 'p0.s', 'p0.s.d0', 'p0.s.d1']) await mod.shown.page.press(`toggle:${item.id}:${path}`)

  const text = (await mod.shown.page.lines({ columns: 160 })).join('\n')
  expect(text).toContain('└── export function lower(expr: Expr): Node { … }')
  expect(text).toContain('-  export function check(expr: Expr): Type { … }')
  expect(text).toContain('+  export function check(expr: Expr, cases: Case[]): Type   <- takes the cases')
  expect(text).toContain('called by compile (src/compiler.ts:12)')
  expect(text).toContain('lower(expr: Expr): Node')
})

test('a drawing the code contradicts is refused with every reason, and nothing reaches the inbox', async () => {
  const mod = tested()
  const wrong = {
    ...proposal,
    problems: [
      {
        ...proposal.problems[0],
        solution: {
          ...solution,
          drawings: [
            { kind: 'files', files: [{ path: 'src/missing.ts', change: 'edit', note: 'is not there' }] },
            { kind: 'api', path: 'src/match.ts', changes: [{ name: 'compile', change: 'remove', note: 'goes away' }] },
            { kind: 'diff', path: 'src/match.ts', old: '  return guess(expr)', new: '' },
          ],
        },
      },
    ],
  }

  const answer = await mod.callTool('propose', wrong)

  expect(answer).toEqual({
    deny: [
      'The propose tool failed: The inbox refused it, because the code does not match:',
      '- Exhaustive match needs no default › A full match still demands a default › No default: src/missing.ts does not exist, so it cannot be edited.',
      '- Exhaustive match needs no default › A full match still demands a default › No default: src/match.ts declares no compile. It declares check, lower.',
      '- Exhaustive match needs no default › A full match still demands a default › No default: src/match.ts does not hold the old lines. Copy them from the file as they are now.',
    ].join('\n'),
  })
  expect(mod.state.memory.items).toEqual([])
})

test('a proposal without its Capabilities or a choice with one option never reaches the inbox', async () => {
  const mod = tested()
  const { capabilities: _, ...withoutCapabilities } = solution
  const missing = await mod.callTool('propose', { ...proposal, problems: [{ ...proposal.problems[0], solution: withoutCapabilities }] })
  const alone = await mod.callTool('propose_options', { title: 'Pick a default', goal: 'Enums ship', problem: { title: 'Defaults', summary: 'Dead code', impact: 'Users write it' }, options: [solution] })

  expect('deny' in missing && missing.deny).toContain('capabilities')
  expect('deny' in alone && alone.deny).toContain('The propose_options tool input is not valid')
  expect(mod.state.memory.items).toEqual([])
})

test('approving sends the answer to the session that proposed it, and the item leaves the queue', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await mod.type('/inbox')
  await mod.shown.page.press('approve')

  expect(mod.shown.prompts).toEqual([`Inbox: the user approved the proposal "Exhaustive match needs no default" (${item.id})`])
  expect(mod.state.memory.items[0]?.status).toBe('answered')
  expect(await mod.shown.page.lines({ columns: 160 })).toEqual(['The inbox is empty.'])
  expect(await mod.lines(AbovePrompt)).toEqual([])
})

test('a correction on one Solution names it, and a revision from another session marks what changed', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await mod.type('/inbox')
  await mod.shown.page.press(`toggle:${item.id}:p0`)
  await mod.shown.page.press(`toggle:${item.id}:p0.s`)
  await mod.shown.page.press(`correct:${item.id}:p0.s`)
  await mod.shown.page.input(`words:${item.id}:p0.s`, 'Name the precedent languages in the summary')

  expect(mod.shown.prompts).toEqual([
    `Inbox: the user corrected "Exhaustive match needs no default" (${item.id}) at "A full match still demands a default › Solution: No default": "Name the precedent languages in the summary". Revise it with the inbox's revise tool.`,
  ])
  expect(await mod.shown.page.lines({ columns: 160 })).toEqual(['The inbox is empty.', '', 'Being revised', 'test-session · Exhaustive match needs no default'])

  const revised = { ...proposal, problems: [{ ...proposal.problems[0], solution: { ...solution, summary: 'Rust and C# prove every case is handled' } }] }
  expect(await mod.callTool('revise', { id: item.id, proposal: revised })).toEqual({ result: `Revised ${item.id}. It waits for the person again.` })

  const lines = await mod.shown.page.lines({ columns: 160 })
  expect(lines).toContain('Exhaustive match needs no default')
  expect(lines.some((line) => line.includes('test-session · proposal · 1 of 1 · changed since you read it'))).toBe(true)
  expect(lines).toContain('▸ Problem: A full match still demands a default — Every enum match carries dead code  · changed inside')
})

test('picking an option answers with that option', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose_options', {
    title: 'Pick how a match handles a missing case',
    goal: 'Enums ship without boilerplate',
    problem: { title: 'Defaults', summary: 'Every match carries one', impact: 'Users write dead code' },
    options: [solution, { ...solution, title: 'Default required', precedent: 'Kotlin', drawings: [] }],
  })
  await mod.type('/inbox')
  expect(await mod.shown.page.lines({ columns: 160 })).toContain('▸ Option 2: Default required (Kotlin) — The compiler proves every case is handled')

  await mod.shown.page.press('option1')

  expect(mod.shown.prompts).toEqual([`Inbox: the user picked "Default required" in "Pick how a match handles a missing case" (${item.id})`])
})

test('a question is answered in the user’s words', async () => {
  const mod = tested()
  const item = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'A no makes the course tables unnecessary' })
  await mod.type('/inbox')
  expect(await mod.shown.page.lines({ columns: 160 })).toContain('A no makes the course tables unnecessary')

  await mod.shown.page.press('answer')
  await mod.shown.page.input('words', 'Yes, but only paid ones')

  expect(mod.shown.prompts).toEqual([`Inbox: the user answered "Do we want courses?" (${item.id}): "Yes, but only paid ones"`])
})

test('Later moves an item behind the rest, and Withdraw closes it for every subscriber', async () => {
  const mod = tested()
  await filed(mod, 'ask_question', { title: 'First question', why: 'It unlocks the first slice' })
  await filed(mod, 'ask_question', { title: 'Second question', why: 'It unlocks the second slice' })
  await mod.type('/inbox')
  expect((await mod.shown.page.lines({ columns: 160 }))[0]).toBe('First question')

  await mod.shown.page.press('later')
  expect((await mod.shown.page.lines({ columns: 160 }))[0]).toBe('Second question')

  await mod.shown.page.press('withdraw')
  expect(mod.shown.prompts.at(-1)).toContain('Inbox: the user withdrew "Second question"')
  expect((await mod.shown.page.lines({ columns: 160 }))[0]).toBe('First question')
})

test('every subscribed session that is running hears the answer, and one that is not subscribed does not', async () => {
  const mod = tested({
    sessions: [
      { id: 'planner', title: 'schema planning', isRunning: true },
      { id: 'reviewer', title: 'reviewer', isRunning: true },
      { id: 'bystander', title: 'bystander', isRunning: true },
    ],
    files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([{ session: 'planner', title: 'schema planning' }, { session: 'reviewer', title: 'reviewer' }])) },
  })
  await mod.type('/inbox')
  await mod.shown.page.press('answer')
  await mod.shown.page.input('words', 'Yes')

  const text = 'Inbox: the user answered "Do we want courses?" (courses): "Yes"'
  expect(mod.shown.sent.map(({ session, text }) => ({ session, text }))).toEqual([
    { session: 'planner', text },
    { session: 'reviewer', text },
  ])
  expect(mod.shown.prompts).toEqual([])
})

test('subscribe and unsubscribe change who hears an item', async () => {
  const mod = tested()
  const item = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })

  expect(await mod.callTool('subscribe', { id: item.id })).toEqual({ result: `This session already hears ${item.id}.` })
  expect(await mod.callTool('unsubscribe', { id: item.id })).toEqual({ result: `This session no longer hears ${item.id}.` })
  expect(mod.state.memory.items[0]?.subscribers).toEqual([])
  expect(await mod.callTool('subscribe', { id: item.id })).toEqual({ result: `This session now hears every change to ${item.id}.` })
})

test('read lists what is open, and gives one item with every answer and the revision it answers', async () => {
  const mod = tested()
  const item = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  expect(await mod.callTool('read', {})).toEqual({
    result: JSON.stringify([{ id: item.id, kind: 'question', status: 'waiting', title: 'Do we want courses?', project, origin: 'test-session', subscribers: ['test-session'] }]),
  })

  await mod.type('/inbox')
  await mod.shown.page.press('answer')
  await mod.shown.page.input('words', 'Yes')

  const answer = await mod.callTool('read', { id: item.id })
  const read = JSON.parse('result' in answer ? String(answer.result) : '{}') as { status: string; answers: { kind: string; words: string; revision: number }[] }
  expect(read.status).toBe('answered')
  expect(read.answers.map(({ kind, words, revision }) => ({ kind, words, revision }))).toEqual([{ kind: 'answer', words: 'Yes', revision: 0 }])
})

test('an item another session wrote shows when the inbox starts', async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([{ session: 'planner', title: 'schema planning' }])) } })
  await mod.type('/inbox')

  expect(await mod.shown.page.lines({ columns: 160 })).toContain('schema planning · question · 1 of 1')
})
