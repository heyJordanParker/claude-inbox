import { expect, setSystemTime, test } from 'bun:test'
import type { HookStream, ProcessSpawnChunk, ProcessSpawnRequest, ProcessSpawnResult } from 'claude-code'
import { AbovePrompt } from '../node_modules/@cmodjs/core/mod.js'
import { testMod, type FakeSession } from '../node_modules/@cmodjs/core/testing.js'
import { converted } from '../src/items/formats.js'
import type { Heard } from '../src/items/heard.js'
import { cardStatusOf, isWithAgent, personOf, queue, senderOf, sendersOf, shownOf, statusOf, unseenOf, type Author, type Content, type Item, type Person } from '../src/items/item.js'
import { itemMarkdown, parsePerson, personMarkdown, revisionMarkdown } from '../src/items/markdown.js'
import { revisedSince } from '../src/items/tree.js'
import { idOfLink, itemLinks } from '../src/links.js'
import { inbox } from '../src/mod.js'
import type { InboxState } from '../src/state.js'

const project = '/work'

const itemsFolder = '/test/home/.local/share/cmod/data/inbox/items'

const deliveringSince = '/test/home/.local/share/cmod/data/inbox/delivering-since'

const files = {
  '/work/src/match.ts': ['export function check(expr: Expr): Type {', '  return infer(expr)', '}', '', 'export function lower(expr: Expr): Node {', '  return emit(expr)', '}'].join('\n'),
}

const committedCheck = 'export function check(expr: Expr, strict: boolean): Type { … }'

const traced = () => ({
  results: [
    { name: 'check', kind: 'function', header: 'export function check(expr: Expr): Type { … }', line: 1 },
    { name: 'Case', kind: 'type', header: 'export type Case = { … }', line: 4 },
    { name: 'name', kind: 'property', header: 'readonly name: string', line: 4 },
    { name: 'lower', kind: 'function', header: 'export function lower(expr: Expr): Node { … }', line: 5 },
  ],
})

const committed = () => ({ results: [{ name: 'check', kind: 'function', header: committedCheck, line: 1 }, ...traced().results.slice(1)] })

const repositories: Readonly<Record<string, string>> = { '/work': '/work/.git', '/work/worktrees/design': '/work/.git', '/elsewhere': '/elsewhere/.git' }

const gitOutput = (argv: readonly string[]) => {
  if (argv.includes('rev-parse')) return repositories[argv[2] ?? ''] ?? ''
  return argv.includes('ls-tree') && argv.at(-1) === 'src/never.ts' ? '' : matchDiff
}

function question(subscribers: readonly Author[]): Omit<Item, 'subscribers'> & { readonly subscribers: readonly Author[] } & { readonly answers: readonly unknown[]; readonly lastRead: number; readonly queuedAt: string; readonly status: string } {
  const origin = subscribers[0] ?? { session: 'planner' }
  return {
    format: 2,
    id: 'courses',
    kind: 'question',
    project,
    origin,
    subscribers,
    revisions: [{ ...origin, at: '2026-10-22T10:00:00.000Z', content: { kind: 'question', title: 'Do we want courses?', why: 'It decides the schema' } }],
    answers: [],
    lastRead: -1,
    queuedAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
    status: 'open',
  }
}

const matchHunk = ['@@ -1,3 +1,3 @@', ' export function check(expr: Expr): Type {', '-  return guess(expr)', '+  return infer(expr)', ' }'].join('\n')

const matchDiff = `diff --git a/src/match.ts b/src/match.ts\n--- a/src/match.ts\n+++ b/src/match.ts\n${matchHunk}\n`

function serving(address: string): HookStream<ProcessSpawnChunk, ProcessSpawnResult> {
  async function* written(): AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> {
    yield { stream: 'stdout', text: `${address}\n` }
    return await new Promise<ProcessSpawnResult>(() => undefined)
  }
  return Object.assign(written(), { result: new Promise<ProcessSpawnResult>(() => undefined) }) as HookStream<ProcessSpawnChunk, ProcessSpawnResult>
}

function tested(options: { readonly sessions?: readonly FakeSession[]; readonly files?: Record<string, string>; readonly notes?: InboxState['global']['notes']; readonly heard?: Heard; readonly isFirstStart?: true } = {}) {
  const mod = testMod(inbox, {
    projectRoot: project,
    files: { ...(options.isFirstStart === true ? {} : { [deliveringSince]: '2026-10-01T00:00:00.000Z\n' }), ...files, ...options.files },
    sessions: [{ id: 'test-session', title: 'php#', isRunning: true }, { id: 'planner', title: 'schema planning' }, ...(options.sessions ?? [])],
    state: { ...(options.notes === undefined ? {} : { global: { notes: options.notes } }), ...(options.heard === undefined ? {} : { session: { heard: options.heard } }) },
  })
  mod.fakes.process.run = async (argv) => ({ exitCode: 0, stdout: argv[0] === 'git' ? gitOutput(argv) : JSON.stringify(argv.includes('--revision') ? committed() : traced()), stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  mod.fakes.process.spawn = () => serving('127.0.0.1:4800')
  return mod
}

type Tested = ReturnType<typeof tested>

const shownId = (mod: Tested) => shownOf(mod.state.memory.items, mod.state.memory.person, mod.state.memory.senders, mod.state.session.viewing)?.id

const personIn = (mod: Tested, item: Item): Person => personOf(mod.state.memory.person, item)

const senderIn = (mod: Tested, item: Item, author: Author) => senderOf(author, item.project, mod.state.memory.senders)

const personAt = (mod: Tested, index = 0): Person | undefined => {
  const item = mod.state.memory.items[index]
  return item === undefined ? undefined : personIn(mod, item)
}

const statusAt = (mod: Tested, index = 0) => {
  const item = mod.state.memory.items[index]
  return item === undefined ? undefined : statusOf(item, personIn(mod, item))
}

const personFolder = `${itemsFolder.slice(0, -'/items'.length)}/person`

const revisionsFolder = `${itemsFolder.slice(0, -'/items'.length)}/revisions`

const filesDrawing = { kind: 'files', files: [{ path: 'src/match.ts', change: 'edit', note: 'learns exhaustiveness' }] }

const solution = {
  title: 'No default',
  precedent: 'Rust, C#',
  ideas: [
    { idea: 'A match that covers every case compiles without a default.', drawing: filesDrawing },
    { idea: 'The checker takes the cases, so it proves the match covers them.', drawing: { kind: 'api', path: 'src/match.ts', changes: [{ name: 'check', change: 'edit', signature: 'export function check(expr: Expr, cases: Case[]): Type', note: 'takes the cases' }] } },
    { idea: 'Inference runs inside the exhaustiveness check.', drawing: { kind: 'diff', path: 'src/match.ts', old: '  return infer(expr)', new: '  return exhaustive(infer(expr))' } },
  ],
  problems: [
    {
      title: 'The spec demands a default',
      ideas: [{ idea: 'The spec says every match ends in one.' }],
      solution: { title: 'Drop the rule', ideas: [{ idea: 'Remove the sentence.', drawing: { kind: 'example', language: 'md', code: 'A match covers every case.' } }] },
    },
  ],
}

const proposal = {
  title: 'Exhaustive match needs no default',
  goal: 'Enums ship without boilerplate defaults',
  problems: [{ title: 'A full match still demands a default', ideas: [{ idea: 'Users write a default the compiler could prove unreachable.' }], solution }],
}

const withIdeas = (ideas: readonly Record<string, unknown>[]) => ({ ...proposal, problems: [{ ...proposal.problems[0], solution: { ...solution, ideas } }] })

const report = {
  title: 'The inbox ships',
  goal: 'Agents bring every proposal to one inbox',
  changes: [{ title: 'Every proposal now waits in one Sidebar page', evidence: ['Reproduced live: a filed proposal opens the page'], drawing: filesDrawing }],
}

async function filed(mod: Tested, tool: string, input: Record<string, unknown>): Promise<Item> {
  const answer = await mod.callTool(tool, input)
  if (!('result' in answer)) throw new Error(`The ${tool} call was denied: ${JSON.stringify(answer)}`)
  const item = mod.state.memory.items.at(-1)
  if (item === undefined) throw new Error('Nothing was filed.')
  return item
}

async function refusal(mod: Tested, tool: string, input: Record<string, unknown>): Promise<string> {
  const answer = await mod.callTool(tool, input)
  if (!('deny' in answer)) throw new Error(`The ${tool} call was accepted.`)
  return answer.deny ?? ''
}

async function note(mod: Tested, item: Item, path: string, words: string): Promise<void> {
  await mod.shown.page.press(`note:${item.id}:${path}`)
  await mod.shown.page.input(`words:${item.id}:${path}`, words)
}

const contentOf = (item: Item | undefined): Content | undefined => item?.revisions.at(-1)?.content

test('a filed item opens on the page, and the agent gets its link', async () => {
  const mod = tested()
  const answer = await mod.callTool('propose', proposal)
  const item = mod.state.memory.items[0]

  expect(mod.shown.page.id).toBe('inbox')
  expect(shownId(mod)).toBe(item?.id)
  expect('result' in answer && answer.result).toContain(`file://${itemsFolder}/${item?.id}.md`)
})

test('the inbox completes each drawing from the code: the file API around a changed signature, and the lines around a diff', async () => {
  const mod = tested()
  const content = contentOf(await filed(mod, 'propose', proposal))
  const ideas = content?.kind === 'proposal' ? (content.problems[0]?.solution?.ideas ?? []) : []
  const [, api, diff] = ideas.map((idea) => idea.drawing)

  expect(api?.kind === 'api' ? api.declarations.map((declaration) => declaration.name) : []).toEqual(['check', 'Case', 'lower'])
  expect(diff?.kind === 'diff' ? { startLine: diff.startLine, after: diff.after } : undefined).toEqual({ startLine: 2, after: ['}', '', 'export function lower(expr: Expr): Node {'] })
})

test('a Files drawing starts folded, and pressing a file opens its code in a proposal and the diff the work made in a report', async () => {
  const mod = tested()
  const proposed = await filed(mod, 'propose', proposal)
  await expect(mod.shown.page.press(`drawing:${proposed.id}:p0.s.i0.dopen:src/match.ts`)).rejects.toThrow('dopen:src/match.ts')
  await mod.shown.page.press(`fold:${proposed.id}:p0.s.i0.d`)
  await mod.shown.page.press(`drawing:${proposed.id}:p0.s.i0.dopen:src/match.ts`)

  expect(mod.shown.page.id).toBe('file')
  expect(mod.state.session.file).toEqual({ project, path: 'src/match.ts', view: { status: 'read', text: files['/work/src/match.ts'], isDiff: false } })

  const reported = contentOf(await filed(mod, 'report', report))
  const drawing = reported?.kind === 'report' ? reported.changes[0]?.drawing : undefined
  expect(drawing?.kind === 'files' ? drawing.files[0]?.diff : undefined).toBe(matchHunk)
  await mod.shown.page.press(`fold:${shownId(mod)}:c0.d`)
  await mod.shown.page.press(`drawing:${shownId(mod)}:c0.dopen:src/match.ts`)
  expect(mod.state.session.file).toEqual({ project, path: 'src/match.ts', view: { status: 'read', text: matchHunk, isDiff: true } })
})

test('/inbox hides the page when it shows, marking its item read, and shows it again', async () => {
  const mod = tested()
  await filed(mod, 'propose', proposal)

  await mod.type('/inbox')
  expect(personAt(mod)?.lastRead).toBe(0)
  await mod.type('/inbox')
  expect(mod.shown.page.id).toBe('inbox')
})

test('the toggle hotkey starts unbound and shows or hides the page like /inbox', async () => {
  const mod = tested()
  await filed(mod, 'propose', proposal)

  expect(inbox.hotkeys?.toggle).toEqual({ title: 'Show or hide the inbox' })
  await mod.hotkey('toggle')
  expect(personAt(mod)?.lastRead).toBe(0)
  await mod.hotkey('toggle')
  expect(mod.shown.page.id).toBe('inbox')
})

test('a report is final: revising one is refused, and the next round of work is a new report', async () => {
  const mod = tested()
  const item = await filed(mod, 'report', report)

  expect(await refusal(mod, 'revise', { id: item.id, report })).toContain('new report')
})

test('an agent working in another repository names it, and its paths are relative to it', async () => {
  const mod = tested({ files: { '/elsewhere/src/match.ts': files['/work/src/match.ts'] } })
  const item = await filed(mod, 'propose', { ...proposal, project: '/elsewhere/' })

  expect(item.project).toBe('/elsewhere')
  expect(await refusal(mod, 'propose', { ...proposal, project: '/nowhere' })).toContain('src/match.ts does not exist')
})

test('a drawing the code contradicts is refused for each reason, and nothing is filed', async () => {
  const mod = tested()
  const denied = await refusal(
    mod,
    'propose',
    withIdeas([
      { idea: 'A missing file.', drawing: { kind: 'files', files: [{ path: 'src/missing.ts', change: 'edit', note: 'is not there' }] } },
      { idea: 'A missing declaration.', drawing: { kind: 'api', path: 'src/match.ts', changes: [{ name: 'compile', change: 'remove', note: 'goes away' }] } },
      { idea: 'Missing lines.', drawing: { kind: 'diff', path: 'src/match.ts', old: '  return guess(expr)', new: '' } },
    ]),
  )

  expect(denied).toContain('src/missing.ts')
  expect(denied).toContain('compile')
  expect(denied).toContain('old lines')
  expect(mod.state.memory.items).toEqual([])
})

test('the format refuses a Solution with no ideas, a choice with one option, a long goal, and a report change without short evidence', async () => {
  const mod = tested()
  const change = { title: 'Every proposal now waits in one Sidebar page', drawing: filesDrawing }

  expect(await refusal(mod, 'propose', withIdeas([]))).toContain('ideas')
  expect(await refusal(mod, 'propose_options', { title: 'Pick', goal: 'Enums ship', problem: { title: 'Defaults', ideas: [{ idea: 'Dead code.' }] }, options: [solution] })).toContain('propose_options')
  expect(await refusal(mod, 'propose', { ...proposal, goal: `Enums ship without defaults: ${'every match covers its cases and the checker proves it, '.repeat(2)}` })).toContain('goal')
  expect(await refusal(mod, 'report', { ...report, changes: [change] })).toContain('evidence')
  expect(await refusal(mod, 'report', { ...report, changes: [{ ...change, evidence: [`Reproduced live: ${'one press opens the Solution and every drawing, '.repeat(3)}`] }] })).toContain('evidence')
})

test('a Solution that is only prose is refused, a screen sketch is not a drawing, and an example is enough', async () => {
  const mod = tested()
  const example = { kind: 'example', language: 'text', code: 'Nothing waits for you' }
  const prose = { ...solution, ideas: [{ idea: 'The page says so.', drawing: example }], problems: [{ ...solution.problems[0], solution: { title: 'Drop the rule', ideas: [{ idea: 'Remove it.' }] } }] }

  expect(await refusal(mod, 'propose', { ...proposal, problems: [{ ...proposal.problems[0], solution: prose }] })).toContain('Drop the rule: shows nothing')
  expect(await refusal(mod, 'propose', withIdeas([{ idea: 'The page says so.', drawing: { kind: 'screen', screen: 'the Inbox page', sketch: 'Nothing waits for you' } }]))).toContain('drawing')
  expect((await filed(mod, 'propose', withIdeas([{ idea: 'The page says so.', drawing: example }]))).kind).toBe('proposal')
})

test('a list of four items is accepted, one of five is refused, and two short lists in one idea are each counted alone', async () => {
  const mod = tested()
  const listing = (count: number) => ({ idea: `A task waits on:\n${Array.from({ length: count }, (_, index) => `- reason ${index + 1}`).join('\n')}` })

  expect((await filed(mod, 'propose', withIdeas([...solution.ideas, listing(4)]))).kind).toBe('proposal')
  expect(await refusal(mod, 'propose', withIdeas([...solution.ideas, listing(5)]))).toContain('lists 5 items')
  expect((await filed(mod, 'propose', withIdeas([...solution.ideas, { idea: 'Two kinds:\n- a\n- b\n- c\n\nAnd also:\n- d\n- e' }]))).kind).toBe('proposal')
})

test('a report checks its drawings against the code after the work', async () => {
  const mod = tested()
  const shipped = (drawing: Record<string, unknown>) => ({
    ...report,
    changes: [
      { title: 'A full match now compiles without a default', evidence: ['The exhaustiveness test passes'], drawing },
      { title: 'The checker learns exhaustiveness', evidence: ['The exhaustiveness test passes'], drawing: filesDrawing },
    ],
  })

  expect((await filed(mod, 'report', shipped({ kind: 'files', files: [{ path: 'src/match.ts', change: 'add', note: 'added' }] }))).kind).toBe('report')
  expect(await refusal(mod, 'report', shipped({ kind: 'files', files: [{ path: 'src/gone.ts', change: 'add', note: 'never written' }] }))).toContain('src/gone.ts')
  expect(await refusal(mod, 'report', shipped({ kind: 'files', files: [{ path: 'src/match.ts', change: 'remove', note: 'goes away' }] }))).toContain('still exists')
  expect(await refusal(mod, 'report', shipped({ kind: 'files', files: [{ path: 'src/never.ts', change: 'remove', note: 'never committed' }] }))).toContain('not in the last commit')
  expect((await filed(mod, 'report', shipped({ kind: 'files', files: [{ path: 'src/old.ts', change: 'remove', note: 'goes away' }] }))).kind).toBe('report')
  expect(await refusal(mod, 'report', shipped({ kind: 'api', path: 'src/match.ts', changes: [{ name: 'check', change: 'remove', note: 'goes away' }] }))).toContain('still declares check')
  expect(await refusal(mod, 'report', shipped({ kind: 'diff', path: 'src/match.ts', old: '  return guess(expr)', new: '' }))).toContain('new lines')

  const content = contentOf(await filed(mod, 'report', shipped({ kind: 'diff', path: 'src/match.ts', old: '  return guess(expr)', new: '  return infer(expr)' })))
  const diff = content?.kind === 'report' ? content.changes[0]?.drawing : undefined
  expect(diff?.kind === 'diff' ? diff.startLine : 0).toBe(2)

  const edited = contentOf(await filed(mod, 'report', shipped({ kind: 'api', path: 'src/match.ts', changes: [{ name: 'check', change: 'edit', signature: 'export function check(expr: Expr): Type', note: 'drops strict' }] })))
  const api = edited?.kind === 'report' ? edited.changes[0]?.drawing : undefined
  expect(api?.kind === 'api' ? api.changes[0]?.was : undefined).toEqual({ name: 'check', header: committedCheck, line: 1 })
})

test('an edited column of stored data needs the type it had, so the drawing shows both', async () => {
  const mod = tested()
  const table = (column: Record<string, unknown>) => withIdeas([...solution.ideas, { idea: 'A match stores its cases.', drawing: { kind: 'table', table: 'matches', columns: [{ name: 'id', type: 'bigint' }, column] } }])

  expect(await refusal(mod, 'propose', table({ name: 'cases', type: 'jsonb', change: 'edit' }))).toContain('cases needs was')
  expect((await filed(mod, 'propose', table({ name: 'cases', type: 'jsonb', change: 'edit', was: 'text' }))).kind).toBe('proposal')
})

test('old lines that appear twice are refused, and a trailing newline still matches', async () => {
  const mod = tested({ files: { '/work/src/twice.ts': 'return null\nfoo()\nreturn null\n' } })
  const withDiff = (old: string) => withIdeas([{ idea: 'It returns undefined.', drawing: { kind: 'diff', path: 'src/twice.ts', old, new: 'return undefined' } }, solution.ideas[0] ?? {}])

  expect(await refusal(mod, 'propose', withDiff('return null'))).toContain('2 times')
  const content = contentOf(await filed(mod, 'propose', withDiff('foo()\nreturn null\n')))
  const diff = content?.kind === 'proposal' ? content.problems[0]?.solution?.ideas[0]?.drawing : undefined
  expect(diff?.kind === 'diff' ? diff.startLine : 0).toBe(2)
})

test('approving tells the proposing session and closes the item', async () => {
  const mod = tested()
  const tick = ticking(mod)
  const item = await filed(mod, 'propose', proposal)
  await mod.shown.page.press('approve')
  await tick()

  expect(mod.shown.prompts).toHaveLength(1)
  expect(mod.shown.prompts[0]).toContain(item.id)
  expect(statusAt(mod)).toBe('answered')
  expect(queue(mod.state.memory.items, mod.state.memory.person, mod.state.memory.senders)).toEqual([])
})

const serverFile = `${itemsFolder.slice(0, -'/items'.length)}/server.json`

function opening(mod: Tested, codes: (url: string) => Promise<string>) {
  const fetched: string[] = []
  const opened: string[][] = []
  const run = mod.fakes.process.run
  mod.fakes.http.fetch = async (url, init) => {
    fetched.push(`${init?.method ?? 'GET'} ${url} ${init?.headers?.authorization ?? ''}`)
    return { status: 200, ok: true, headers: {}, text: JSON.stringify({ code: await codes(url) }) }
  }
  mod.fakes.process.run = async (argv, init) => {
    if (argv[0] !== 'xdg-open') return run === undefined ? Promise.reject(new Error(`No fake runs ${argv[0]}`)) : run(argv, init)
    opened.push([...argv])
    return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  return { fetched, opened }
}

test('Open in browser mints a code with the token in server.json and opens the item in this session and project, with the code in the fragment', async () => {
  const mod = tested({ files: { [serverFile]: JSON.stringify({ port: 4801, token: 'saved-token' }) } })
  const { fetched, opened } = opening(mod, async () => 'one-time')
  const item = await filed(mod, 'propose', proposal)
  await mod.shown.page.press('browser')

  expect(fetched).toEqual(['POST http://127.0.0.1:4801/api/codes Bearer saved-token'])
  expect(opened).toEqual([['xdg-open', `http://127.0.0.1:4801/items/${item.id}?session=test-session&project=%2Fwork#code=one-time`]])
  expect(mod.shown.toasts.filter((each) => each.type === 'error')).toEqual([])
})

test('Open in browser waits for the program when server.json names a stopped server, then reads server.json again', async () => {
  const mod = tested({ files: { [serverFile]: JSON.stringify({ port: 4700, token: 'old-token' }) } })
  const { fetched, opened } = opening(mod, async (url) => {
    if (!url.includes(':4700/')) return 'after-restart'
    await mod.fakes.fs.write?.(serverFile, JSON.stringify({ port: 4800, token: 'new-token' }))
    throw new Error('connection refused')
  })
  const item = await filed(mod, 'propose', proposal)
  await mod.shown.page.press('browser')

  expect(fetched).toEqual(['POST http://127.0.0.1:4700/api/codes Bearer old-token', 'POST http://127.0.0.1:4800/api/codes Bearer new-token'])
  expect(opened).toEqual([['xdg-open', `http://127.0.0.1:4800/items/${item.id}?session=test-session&project=%2Fwork#code=after-restart`]])
})

test('Open in browser with no server to ask shows why in a toast and opens nothing', async () => {
  const mod = tested()
  const { fetched, opened } = opening(mod, async () => 'unused')
  await filed(mod, 'propose', proposal)
  await mod.shown.page.press('browser')

  expect([fetched, opened]).toEqual([[], []])
  expect(mod.shown.toasts.at(-1)).toEqual({ type: 'error', message: 'The item did not open in the browser', description: `No inbox server answered at the address in ${serverFile}.` })
})

test('notes on several parts go out together as requested changes, each named by its part, and the item waits on the agent', async () => {
  const mod = tested()
  const tick = ticking(mod)
  const item = await filed(mod, 'propose', proposal)
  await note(mod, item, 'p0.s', 'Name the precedent')
  await note(mod, item, 'p0', 'Say who writes the default')
  await note(mod, item, 'p0.s.i2.d', 'Keep the old name')
  await mod.shown.page.press('request')
  await tick()

  const sent = mod.shown.prompts.at(-1) ?? ''
  expect(sent).toContain('Solution 1: No default: "Name the precedent"')
  expect(sent).toContain('Problem 1: A full match still demands a default: "Say who writes the default"')
  expect(sent).toContain('Solution 1: No default › Diff: src/match.ts:2: "Keep the old name"')
  const fresh = mod.state.memory.items[0]
  expect(fresh !== undefined && isWithAgent(fresh, personIn(mod, fresh))).toBe(true)
  expect(shownId(mod)).toBe(item.id)
})

test('a note on an idea names the idea by its words', async () => {
  const mod = tested()
  const tick = ticking(mod)
  const item = await filed(mod, 'propose', proposal)
  await note(mod, item, 'p0.s.i0', 'Say which languages do this')
  await mod.shown.page.press('request')
  await tick()

  expect(mod.shown.prompts.at(-1)).toContain('No default › "A match that covers every case compiles without a default.": "Say which languages do this"')
})

test('an empty note is dropped, and saving a saved note empty drops it', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await note(mod, item, 'p0', '  ')
  expect(personAt(mod)?.notes).toEqual([])

  await note(mod, item, 'p0', 'Drop this')
  await mod.shown.page.press(`edit:${item.id}:p0`)
  await mod.shown.page.input(`words:${item.id}:p0`, '')
  expect(personAt(mod)?.notes).toEqual([])
})

test('approving carries pending notes, and moving past the item with Next → keeps them', async () => {
  const mod = tested()
  const tick = ticking(mod)
  await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  const item = await filed(mod, 'propose', proposal)
  await note(mod, item, 'p0', 'Say who writes the default')
  await mod.shown.page.press('next')
  await mod.shown.page.press('next')
  await mod.shown.page.press('approve')
  await tick()

  expect(mod.shown.prompts.at(-1)).toContain('approved')
  expect(mod.shown.prompts.at(-1)).toContain('"Say who writes the default"')
})

test('a comment written in the footer is a note on the whole item, pressing it edits it, and it goes out with Approve', async () => {
  const mod = tested()
  const tick = ticking(mod)
  const item = await filed(mod, 'propose', proposal)
  await mod.shown.page.press('comment')
  await mod.shown.page.input(`words:${item.id}:`, 'Ship it behind a flag')
  await expect(mod.shown.page.press('comment')).rejects.toThrow('comment')
  await mod.shown.page.press(`edit:${item.id}:`)
  await mod.shown.page.input(`words:${item.id}:`, 'Ship it behind a flag first')
  await mod.shown.page.press('approve')
  await tick()

  expect(mod.shown.prompts.at(-1)).toBe([`Inbox: the user approved the proposal "Exhaustive match needs no default" (${item.id}), answer 1, with these notes:`, '- the whole item: "Ship it behind a flag first"', 'Apply them as you go.'].join('\n'))
})

test('a note being typed is kept in session state under its field key, and saving it clears it', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  const field = `words:${item.id}:p0`
  const words = 'Say who writes the default when a match covers each case, name the languages that already prove it, and show the checker refusing a match that misses one case, before the spec drops the rule for good.'
  await mod.shown.page.press(`note:${item.id}:p0`)
  await mod.shown.page.input(field, words, 'change')
  expect(mod.state.session.typed).toEqual({ [field]: words })

  await mod.shown.page.input(field, words)

  expect(mod.state.session.typed).toEqual({})
  expect(personAt(mod)?.notes.map((each) => each.words)).toEqual([words])
})

test('typed text goes when its field closes: a note closed unsaved, an answer when the page moves to another item or the answer is sent, and an answer stays while a comment opens', async () => {
  const mod = tested()
  const asked = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  const item = await filed(mod, 'propose', proposal)
  const answerField = `answer:${asked.id}`
  await mod.shown.page.press(`note:${item.id}:p0`)
  await mod.shown.page.input(`words:${item.id}:p0`, 'Say who writes the default', 'change')
  await mod.shown.page.press(`note:${item.id}:p0`)
  expect(mod.state.session.typed).toEqual({})

  await mod.shown.page.press(`view:${asked.id}`)
  await mod.shown.page.input(answerField, 'Yes, but only paid ones', 'change')
  await mod.shown.page.press('comment')
  expect(mod.state.session.typed).toEqual({ [answerField]: 'Yes, but only paid ones' })
  await mod.shown.page.press(`view:${item.id}`)
  expect(mod.state.session.typed).toEqual({})

  await mod.shown.page.press(`view:${asked.id}`)
  await mod.shown.page.input(answerField, 'Yes', 'change')
  await mod.shown.page.input(answerField, 'Yes')
  expect(mod.state.session.typed).toEqual({})
})

test('a saved note opened again draws its whole words above the field, because the field shows one cut-off line, and words typed over it take their place', async () => {
  const mod = tested()
  const asked = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  const drawn = async (words: string) => (await mod.shown.page.lines()).filter((line) => line.includes(words)).length
  await note(mod, asked, 'why', 'Name who waits on the answer')
  await mod.shown.page.press(`edit:${asked.id}:why`)
  expect(await drawn('Name who waits on the answer')).toBe(2)

  await mod.shown.page.input(`words:${asked.id}:why`, 'Name who waits', 'change')
  expect([await drawn('Name who waits on the answer'), await drawn('Name who waits')]).toEqual([1, 2])
})

test('words typed into the Answer box without pressing a keep the page on its item when this session files another, and the words stay', async () => {
  const mod = tested()
  const asked = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  const answerField = `answer:${asked.id}`
  await mod.shown.page.input(answerField, 'Yes, but only paid ones', 'change')

  await filed(mod, 'ask_question', { title: 'Do we want paid courses?', why: 'It decides the price' })

  expect(shownId(mod)).toBe(asked.id)
  expect(mod.state.session.typed).toEqual({ [answerField]: 'Yes, but only paid ones' })
  expect(mod.shown.toasts.at(-1)?.message).toBe('"Do we want paid courses?" is in the inbox')
})

test('a on a question moves the keyboard to the Answer box once, and the page shown again leaves it on the page, so x and m press Reject and Comment', async () => {
  const mod = tested()
  const asked = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  await mod.press(AbovePrompt, 'open-inbox')
  await mod.shown.page.press('answer')
  expect(await mod.shown.page.focusedKey()).toBe(`answer:${asked.id}`)

  await mod.press(AbovePrompt, 'open-inbox')
  expect(await mod.shown.page.focusedKey()).toBeUndefined()

  await mod.hotkey('toggle')
  await mod.hotkey('toggle')
  expect(await mod.shown.page.focusedKey()).toBeUndefined()
})

test('opening a note moves the keyboard to its field once, and the page shown again leaves it on the page', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await mod.press(AbovePrompt, 'open-inbox')
  await mod.shown.page.press(`note:${item.id}:p0`)
  expect(await mod.shown.page.focusedKey()).toBe(`words:${item.id}:p0`)

  await mod.press(AbovePrompt, 'open-inbox')
  expect(await mod.shown.page.focusedKey()).toBeUndefined()

  await mod.shown.page.press('comment')
  expect(await mod.shown.page.focusedKey()).toBe(`words:${item.id}:`)
})

test('a new note on a part keeps the note written on an earlier revision of it, and both go out', async () => {
  const mod = tested()
  const tick = ticking(mod)
  const item = await filed(mod, 'propose', proposal)
  await note(mod, item, 'p0', 'Say who writes the default')
  await mod.callTool('revise', { id: item.id, proposal: { ...proposal, goal: 'Enums ship with no boilerplate' } })
  await note(mod, item, 'p0', 'Name the precedent')
  await mod.shown.page.press('request')
  await tick()

  expect(mod.shown.prompts.at(-1)).toContain('(written on revision 1): "Say who writes the default"')
  expect(mod.shown.prompts.at(-1)).toContain('"Name the precedent"')
})

test('a revise that says exactly what the item already says is refused, and the item keeps its revision', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)

  const deny = await refusal(mod, 'revise', { id: item.id, proposal })

  expect(deny).toBe(`The revise tool failed: ${item.id} already says exactly this as revision 1. Change what it says before you revise it.`)
  expect(mod.state.memory.items[0]?.revisions).toHaveLength(1)
})

test('a revise or withdraw on an item the browser answered before this session loaded the answer is refused, and the item file stays as it was', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  const before = await fileText(mod, `${itemsFolder}/${item.id}.md`)
  await mod.fakes.fs.write?.(`${personFolder}/${item.id}.md`, personMarkdown({ notes: [], answers: [{ kind: 'approve', revision: 0, at: '2026-10-22T11:00:00.000Z' }], lastRead: 0, queuedAt: '2026-10-22T10:00:00.000Z' }))

  const revised = await refusal(mod, 'revise', { id: item.id, proposal: { ...proposal, goal: 'Enums ship with no boilerplate' } })
  const withdrawn = await refusal(mod, 'withdraw', { id: item.id, reason: 'Moved to billing' })

  expect(revised).toBe(`The revise tool failed: ${item.id} is answered. Put a new item in the inbox instead.`)
  expect(withdrawn).toBe(`The withdraw tool failed: ${item.id} is already answered.`)
  expect(await fileText(mod, `${itemsFolder}/${item.id}.md`)).toBe(before)
})

test('a revision ends the wait on the agent', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await note(mod, item, 'p0', 'Say who writes the default')
  await mod.shown.page.press('request')
  await mod.callTool('revise', { id: item.id, proposal: { ...proposal, goal: 'Enums ship with no boilerplate' } })

  const fresh = mod.state.memory.items[0]
  expect(fresh !== undefined && isWithAgent(fresh, personIn(mod, fresh))).toBe(false)
  expect(fresh !== undefined && unseenOf(fresh, personIn(mod, fresh))).toBe('changed')
})

test('one press opens a Problem a revision left unchanged, with its whole Solution and its code drawings', async () => {
  const mod = tested()
  await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  const item = await filed(mod, 'propose', proposal)
  await mod.shown.page.press('next')
  const added = { title: 'A default hides a new case', ideas: [{ idea: 'A case added later falls into the default unnoticed.' }], solution: { title: 'Warn on a missing case', ideas: [{ idea: 'The checker names the case the match misses.', drawing: filesDrawing }] } }
  await mod.callTool('revise', { id: item.id, proposal: { ...proposal, problems: [...proposal.problems, added] } })
  await mod.shown.page.press(`fold:${item.id}:p0`)
  await mod.shown.page.press(`drawing:${item.id}:p0.s.i2.dopen`)

  expect(mod.shown.page.id).toBe('file')
})

test('picking an option, answering a question, and marking a report done each tell the agent which', async () => {
  const mod = tested()
  const tick = ticking(mod)
  await filed(mod, 'propose_options', {
    title: 'Pick how a match handles a missing case',
    goal: 'Enums ship',
    problem: { title: 'Defaults', ideas: [{ idea: 'Users write dead code.' }] },
    options: [solution, { title: 'Default required', precedent: 'Kotlin', ideas: [solution.ideas[0]] }],
  })
  await mod.shown.page.press('option1')
  await tick()
  expect(mod.shown.prompts.at(-1)).toContain('picked "Default required"')

  const asked = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  await mod.shown.page.input(`answer:${asked.id}`, 'Yes, but only paid ones')
  await tick()
  expect(mod.shown.prompts.at(-1)).toContain('"Yes, but only paid ones"')

  await filed(mod, 'report', report)
  await mod.shown.page.press('done')
  await tick()
  expect(mod.shown.prompts.at(-1)).toContain('done')
})

test('Next → puts the item behind the rest, marks it read, and opens the next one, and it shows only while another item waits', async () => {
  const mod = tested()
  const first = await filed(mod, 'ask_question', { title: 'First question', why: 'It unlocks the first slice' })
  const second = await filed(mod, 'ask_question', { title: 'Second question', why: 'It unlocks the second slice' })
  const queued = () => queue(mod.state.memory.items, mod.state.memory.person, mod.state.memory.senders).map((each) => [each.id, unseenOf(each, personIn(mod, each))])
  expect(shownId(mod)).toBe(second.id)

  await mod.shown.page.press('next')
  expect(shownId(mod)).toBe(first.id)
  try {
    setSystemTime(new Date(Date.parse(personIn(mod, second).queuedAt) + 60_000))
    await mod.shown.page.press('next')
  } finally {
    setSystemTime()
  }
  expect(shownId(mod)).toBe(second.id)
  expect(queued()).toEqual([
    [second.id, undefined],
    [first.id, undefined],
  ])

  await mod.shown.page.press('reject')
  expect(shownId(mod)).toBe(first.id)
  await expect(mod.shown.page.press('next')).rejects.toThrow('next')
})

test('rejecting tells the agent what was rejected, with the notes when there are any, to resubmit it with revise, and a report has no Reject', async () => {
  const mod = tested()
  const tick = ticking(mod)
  const resubmit = "To resubmit it, revise it with the inbox's revise tool, which reopens it for the user. Never file it again as a new item."
  const proposed = await filed(mod, 'propose', proposal)
  await mod.shown.page.press('reject')
  await tick()
  expect(mod.shown.prompts.at(-1)).toBe([`Inbox: the user rejected the proposal "Exhaustive match needs no default" (${proposed.id}), answer 1`, resubmit].join('\n'))
  expect(statusOf(proposed, personIn(mod, proposed))).toBe('answered')

  const options = await filed(mod, 'propose_options', {
    title: 'Pick how a match handles a missing case',
    goal: 'Enums ship',
    problem: { title: 'Defaults', ideas: [{ idea: 'Users write dead code.' }] },
    options: [solution, { title: 'Default required', precedent: 'Kotlin', ideas: [solution.ideas[0]] }],
  })
  await note(mod, options, 'problem', 'Neither handles generics')
  await mod.shown.page.press('reject')
  await tick()
  expect(mod.shown.prompts.at(-1)).toBe([`Inbox: the user rejected every option in "Pick how a match handles a missing case" (${options.id}), answer 1, with these notes:`, '- Problem: Defaults: "Neither handles generics"', 'Apply them as you go.', resubmit].join('\n'))

  const asked = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  await mod.shown.page.press('reject')
  await tick()
  expect(mod.shown.prompts.at(-1)).toBe([`Inbox: the user rejected the question "Do we want courses?" (${asked.id}), answer 1`, resubmit].join('\n'))

  await filed(mod, 'report', report)
  await expect(mod.shown.page.press('reject')).rejects.toThrow('reject')
})

const choice = {
  title: 'Pick how a match handles a missing case',
  goal: 'Enums ship',
  problem: { title: 'Defaults', ideas: [{ idea: 'Users write dead code.' }] },
  options: [solution, { title: 'Default required', precedent: 'Kotlin', ideas: [solution.ideas[0]] }],
}

test('an agent revises a rejected proposal, choice, and question, and each revision reopens it, listed as changed, with the rejection kept', async () => {
  const mod = tested()
  const proposed = await filed(mod, 'propose', proposal)
  await mod.shown.page.press('reject')
  const picking = await filed(mod, 'propose_options', choice)
  await mod.shown.page.press('reject')
  const asked = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  await mod.shown.page.press('reject')
  const rejected = [proposed, picking, asked].map(({ id }) => id)
  const statuses = () =>
    rejected.map((id) => {
      const item = mod.state.memory.items.find((each) => each.id === id)
      return item === undefined ? 'gone' : [statusOf(item, personIn(mod, item)), cardStatusOf(item, personIn(mod, item), mod.state.memory.senders)?.word]
    })
  expect(statuses()).toEqual([
    ['answered', 'rejected'],
    ['answered', 'rejected'],
    ['answered', 'rejected'],
  ])

  const revised = [
    await mod.callTool('revise', { id: proposed.id, proposal: { ...proposal, goal: 'Enums ship with no boilerplate' } }),
    await mod.callTool('revise', { id: picking.id, options: { ...choice, goal: 'Enums ship with no boilerplate' } }),
    await mod.callTool('revise', { id: asked.id, question: { title: 'Do we want paid courses?', why: 'It decides the schema' } }),
  ]

  expect(revised.map((each) => ('result' in each ? String(each.result).split(',')[0] : each.deny))).toEqual(rejected.map((id) => `Revised ${id} to revision 2`))
  expect(statuses()).toEqual([
    ['open', 'changed'],
    ['open', 'changed'],
    ['open', 'changed'],
  ])
  expect(queue(mod.state.memory.items, mod.state.memory.person, mod.state.memory.senders).map((each) => each.id).sort()).toEqual([...rejected].sort())
  const one = await mod.callTool('read', { id: proposed.id })
  const read = JSON.parse('result' in one ? String(one.result) : '{}') as { status: string; revision: number; answers: { kind: string; revision: number }[] }
  expect(read.status).toBe('open')
  expect(read.revision).toBe(2)
  expect(read.answers.map(({ kind, revision }) => ({ kind, revision }))).toEqual([{ kind: 'reject', revision: 1 }])
})

test('revise still refuses an approved proposal, a picked choice, an answered question, and a withdrawn item, each with its reason', async () => {
  const mod = tested()
  const approved = await filed(mod, 'propose', proposal)
  await mod.shown.page.press('approve')
  const picked = await filed(mod, 'propose_options', choice)
  await mod.shown.page.press('option0')
  const answered = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  await mod.shown.page.input(`answer:${answered.id}`, 'Yes')
  const withdrawn = await filed(mod, 'ask_question', { title: 'Do we want paid courses?', why: 'It decides the schema' })
  await mod.callTool('withdraw', { id: withdrawn.id, reason: 'Moved to billing' })

  const refused = [
    await refusal(mod, 'revise', { id: approved.id, proposal: { ...proposal, goal: 'Enums ship with no boilerplate' } }),
    await refusal(mod, 'revise', { id: picked.id, options: { ...choice, goal: 'Enums ship with no boilerplate' } }),
    await refusal(mod, 'revise', { id: answered.id, question: { title: 'Do we want free courses?', why: 'It decides the schema' } }),
    await refusal(mod, 'revise', { id: withdrawn.id, question: { title: 'Do we want free courses?', why: 'It decides the schema' } }),
  ]

  expect(refused).toEqual([
    `The revise tool failed: ${approved.id} is answered. Put a new item in the inbox instead.`,
    `The revise tool failed: ${picked.id} is answered. Put a new item in the inbox instead.`,
    `The revise tool failed: ${answered.id} is answered. Put a new item in the inbox instead.`,
    `The revise tool failed: ${withdrawn.id} is withdrawn. Put a new item in the inbox instead.`,
  ])
})

test('an item is new until the page moves past it, an agent filing another never marks it read, and a revision makes it changed', async () => {
  const mod = tested()
  const first = await filed(mod, 'ask_question', { title: 'First question', why: 'It unlocks the first slice' })
  const second = await filed(mod, 'ask_question', { title: 'Second question', why: 'It unlocks the second slice' })
  const unseen = (id: string) => {
    const item = mod.state.memory.items.find((each) => each.id === id)
    return item === undefined ? 'gone' : unseenOf(item, personIn(mod, item))
  }
  expect([unseen(first.id), unseen(second.id)]).toEqual(['new', 'new'])

  await mod.shown.page.press(`view:${first.id}`)
  expect([unseen(first.id), unseen(second.id)]).toEqual(['new', undefined])

  await mod.callTool('revise', { id: second.id, question: { title: 'Second question, revised', why: 'It unlocks the second slice' } })
  expect(unseen(second.id)).toBe('changed')
})

test('every item in the list opens from the Sidebar, the sixth one included, as it does in the browser', async () => {
  const mod = tested()
  const titles = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh'].map((each) => `${each} question`)
  const filedItems = []
  for (const title of titles) filedItems.push(await filed(mod, 'ask_question', { title, why: 'It unlocks a slice' }))
  const sixth = filedItems[5]

  await mod.shown.page.press(`view:${sixth?.id}`)

  expect(shownId(mod)).toBe(sixth?.id)
})

test('an answered item stays in the Sidebar in the Archive and opens there with its answer and no answer buttons', async () => {
  const mod = tested()
  const rejected = await filed(mod, 'propose', proposal)
  await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  await mod.shown.page.press(`view:${rejected.id}`)
  await mod.shown.page.press('reject')

  await mod.shown.page.press(`view:${rejected.id}`)

  expect(shownId(mod)).toBe(rejected.id)
  await expect(mod.shown.page.press('approve')).rejects.toThrow('approve')
})

test('moving the page to another item closes the note being written, so the next filed item opens', async () => {
  const mod = tested()
  const first = await filed(mod, 'ask_question', { title: 'First question', why: 'It unlocks the first slice' })
  const second = await filed(mod, 'ask_question', { title: 'Second question', why: 'It unlocks the second slice' })
  await mod.shown.page.press('comment')
  expect(mod.state.session.editing).toBe(`${second.id}:`)

  await mod.shown.page.press(`view:${first.id}`)
  expect(mod.state.session.editing).toBe(null)
  const third = await filed(mod, 'ask_question', { title: 'Third question', why: 'It unlocks the third slice' })
  expect(shownId(mod)).toBe(third.id)
})

test('a revision is compared by what each part says: a removed part keeps the place it had, and an inserted idea is the only change', () => {
  const content = (problems: readonly Record<string, unknown>[]) => ({ kind: 'proposal', ...proposal, problems }) as unknown as Content
  const first = proposal.problems[0] ?? {}
  const second = { ...first, title: 'A second Problem' }

  expect(revisedSince(content([first, second]), content([second]))).toEqual({ changed: new Set(), removed: new Map([['p0', ['p0']]]), was: new Map() })

  const inserted = { ...first, solution: { ...solution, ideas: [{ idea: 'Kotlin does the same.' }, ...solution.ideas] } }
  expect(revisedSince(content([first]), content([inserted]))).toEqual({ changed: new Set(['p0.s.i0']), removed: new Map(), was: new Map() })

  const three = { ...first, solution: { ...solution, ideas: [{ idea: 'One.' }, { idea: 'Two.' }, { idea: 'Three.' }] } }
  const withoutTwo = { ...first, solution: { ...solution, ideas: [{ idea: 'One.' }, { idea: 'Three.' }] } }
  expect(revisedSince(content([second, three]), content([second, withoutTwo])).removed).toEqual(new Map([['p1.s.i1', ['p1.s.i1']]]))

  const reported = (open: readonly Record<string, unknown>[]) => ({ kind: 'report', ...report, open }) as unknown as Content
  expect(revisedSince(reported([first]), reported([])).removed).toEqual(new Map([['u0', ['u0']]]))

  const reworded = { ...first, solution: { ...solution, ideas: [{ ...solution.ideas[0], idea: 'A match that covers every case compiles with no default.' }, ...solution.ideas.slice(1)] } }
  expect(revisedSince(content([first]), content([reworded])).was).toEqual(new Map([['p0.s.i0', 'A match that covers every case compiles without a default.']]))

  const rewritten = { ...first, solution: { ...solution, ideas: [{ ...solution.ideas[0], idea: 'Rust proves it.' }, ...solution.ideas.slice(1)] } }
  expect(revisedSince(content([first]), content([rewritten]))).toEqual({ changed: new Set(['p0.s.i0']), removed: new Map([['p0.s.i0', ['p0.s.i0']]]), was: new Map() })

  const replaced = { ...first, title: 'Nothing proves a match covers its cases' }
  expect(revisedSince(content([first]), content([replaced]))).toEqual({
    changed: new Set(['p0', 'p0.i0', 'p0.s', 'p0.s.i0', 'p0.s.i1', 'p0.s.i2', 'p0.s.p0', 'p0.s.p0.i0', 'p0.s.p0.s', 'p0.s.p0.s.i0']),
    removed: new Map([['p0', ['p0']]]),
    was: new Map(),
  })
})

test('a renamed item keeps its old title to show', () => {
  const before = { kind: 'proposal', ...proposal } as unknown as Content
  const after = { ...before, title: 'A full match needs no default' } as Content

  expect(revisedSince(before, after)).toEqual({ changed: new Set(['title']), removed: new Map(), was: new Map([['title', 'Exhaustive match needs no default']]) })
})

test('a renamed Problem and Solution keep their old titles to show', () => {
  const before = { kind: 'proposal', ...proposal } as unknown as Content
  const first = proposal.problems[0] ?? { title: '', ideas: [], solution }
  const after = { ...before, problems: [{ ...first, title: 'A full match still demands a default case', solution: { ...solution, title: 'No default case' } }] } as unknown as Content

  expect(revisedSince(before, after)).toEqual({
    changed: new Set(['p0', 'p0.s']),
    removed: new Map(),
    was: new Map([
      ['p0', 'A full match still demands a default'],
      ['p0.s', 'No default'],
    ]),
  })
})

test('an item a 0.1.0 inbox stored reads as open, its correction keeps it with the agent, its content becomes ideas, and its diagram is drawn', () => {
  const stored = {
    ...question([{ session: 'planner' }]),
    format: undefined,
    kind: 'proposal',
    status: 'corrected',
    answers: [{ kind: 'correct', target: 'p0', words: 'Name it', revision: 0, by: 'person', at: '2026-10-22T10:05:00.000Z' }],
    revisions: [
      {
        session: 'planner',
        at: '2026-10-22T10:00:00.000Z',
        content: {
          kind: 'proposal',
          title: 'An old proposal',
          goal: 'Enums ship',
          problems: [{ title: 'A default is demanded', summary: 'Every match ends in one', impact: 'Users write dead code', solution: { title: 'No default', summary: 'The compiler proves it', idea: 'A full match needs none.', capabilities: ['A match compiles without a default'], drawings: [{ kind: 'diagram', mermaid: 'graph LR\n  Match --> Check' }] } }],
        },
      },
    ],
  }
  const { item, person } = converted(stored, undefined, [])
  const content = contentOf(item)
  const ideas = content?.kind === 'proposal' ? (content.problems[0]?.solution?.ideas ?? []) : []
  const diagram = ideas.at(-1)?.drawing

  const waiting = converted({ ...stored, status: 'waiting', answers: [] }, undefined, [])
  expect(person === undefined ? 'missing' : statusOf(item, person)).toBe('open')
  expect(person !== undefined && isWithAgent(item, person)).toBe(true)
  expect(waiting.person === undefined ? 'missing' : statusOf(waiting.item, waiting.person)).toBe('open')
  expect(content?.kind === 'proposal' ? content.problems[0]?.ideas.map((each) => each.idea) : []).toEqual(['Every match ends in one', 'Users write dead code'])
  expect(ideas.map((each) => each.idea)).toEqual(['The compiler proves it', 'A full match needs none.', '- A match compiles without a default', 'How the parts connect.'])
  expect(diagram?.kind === 'diagram' && diagram.drawn !== diagram.mermaid && diagram.drawn !== '').toBe(true)
})

test('a diagram is drawn when the agent files it, and Mermaid the inbox cannot draw is refused', async () => {
  const mod = tested()
  const withDiagram = (mermaid: string) => withIdeas([...solution.ideas, { idea: 'The check runs after inference.', drawing: { kind: 'diagram', mermaid } }])
  const content = contentOf(await filed(mod, 'propose', withDiagram('graph TD\n  Infer -->|type| Check')))
  const diagram = content?.kind === 'proposal' ? content.problems[0]?.solution?.ideas.at(-1)?.drawing : undefined

  expect(diagram?.kind === 'diagram' && diagram.drawn.split('\n').length > 2).toBe(true)
  expect(await refusal(mod, 'propose', withDiagram('pie of nothing'))).toContain('Mermaid')
})

test('a diagram keeps its boxes where they fit, and draws top to bottom where they would run past the page', async () => {
  const mod = tested()
  const branching = 'graph TD\n  Checks[the checks run on the item] -->|a finding at error| Refused[the agent gets every message]\n  Checks -->|none, or only warnings| Filed[the item files with its warnings]'
  await filed(mod, 'propose', withIdeas([...solution.ideas, { idea: 'A finding at error refuses the item.', drawing: { kind: 'diagram', mermaid: branching } }]))

  const narrow = (await mod.shown.page.lines({ columns: 70 })).join('\n')
  expect(narrow).toContain('│ the checks run on the item')
  expect(narrow).toContain('│ ├─ a finding at error')
  expect(narrow).toContain('│ │  ▼')
  expect(narrow).toContain('│ │  the agent gets every message')
  expect(narrow).toContain('│ └─ none, or only warnings')
  expect(narrow).toContain('│    the item files with its warnings')
  expect(narrow).not.toContain('┌')
  expect((await mod.shown.page.lines({ columns: 200 })).join('\n')).toContain('┌')
})

test('a list on the page draws its bullets as •, nested ones indented, and numbered ones keep their numbers', async () => {
  const mod = tested()
  await filed(mod, 'propose', withIdeas([...solution.ideas, { idea: 'A task waits on:\n- you\n  - with a link\n- another task\n\nIn order:\n1. file\n2. answer' }]))

  const lines = (await mod.shown.page.lines()).join('\n')
  expect(lines).toContain('│  • you')
  expect(lines).toContain('│    • with a link')
  expect(lines).toContain('│  • another task')
  expect(lines).toContain('│  1. file')
  expect(lines).not.toContain('- you')
})

const here = { session: 'test-session' }

const planner = { session: 'planner' }

const answered = (...answers: readonly Record<string, unknown>[]) => personMarkdown({ notes: [], answers: answers.map((each) => ({ revision: 0, ...each })) as unknown as Person['answers'], lastRead: 0, queuedAt: '2026-10-22T10:00:00.000Z' })

const requested = (words: string, at: string) => ({ kind: 'correct', corrections: [{ path: '', target: 'the whole item', words, revision: 0 }], at })

function ticking(mod: Tested): () => Promise<void> {
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

async function written(mod: Tested, path: string, text: string): Promise<void> {
  await mod.fakes.fs.write?.(path, text)
  await mod.fakes.fs.write?.(`${itemsFolder.slice(0, -'/items'.length)}/changed`, `${new Date().toISOString()} ${path.split('/').at(-1)?.slice(0, -'.md'.length) ?? ''}\n`)
}

async function writtenItem(mod: Tested, item: Item): Promise<void> {
  for (const index of item.revisions.slice(0, -1).keys()) await mod.fakes.fs.write?.(`${revisionsFolder}/${item.id}/${index + 1}.md`, revisionMarkdown(item, index))
  await written(mod, `${itemsFolder}/${item.id}.md`, itemMarkdown(item))
}

const loaded = (mod: Tested, id: string): Item => {
  const item = mod.state.memory.items.find((each) => each.id === id)
  if (item === undefined) throw new Error(`${id} is not loaded.`)
  return item
}

const answerNumbers = (prompts: readonly string[]) => prompts.map((each) => /\(courses\), answer (\d+)/.exec(each)?.[1])

test('an answer another writer stores arrives once at a subscriber, and never at a session that does not follow the item', async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([here])), [`${itemsFolder}/pricing.json`]: JSON.stringify({ ...question([planner]), id: 'pricing' }) } })
  const tick = ticking(mod)
  await mod.start()
  await written(mod, `${personFolder}/courses.md`, answered({ kind: 'answer', words: 'Yes', at: '2026-11-01T00:00:00.000Z' }))
  await written(mod, `${personFolder}/pricing.md`, answered({ kind: 'answer', words: 'No', at: '2026-11-01T00:00:00.000Z' }))
  await tick()
  await tick()

  expect(mod.shown.prompts).toEqual(['Inbox: the user answered "Do we want courses?" (courses), answer 1: "Yes"'])
  expect(mod.shown.sent).toEqual([])
})

test("this session's own revision and withdrawal never come back to it, and another session's revision arrives as a note", async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([planner, here])) } })
  const tick = ticking(mod)
  await mod.start()
  await mod.callTool('revise', { id: 'courses', question: { title: 'Do we want paid courses?', why: 'It decides the schema' } })
  await tick()
  expect(mod.shown.notes.filter((each) => each.includes('(courses)'))).toEqual([])

  const fresh = loaded(mod, 'courses')
  const revision = { ...planner, at: new Date().toISOString(), content: { kind: 'question', title: 'Do we want free courses?', why: 'It decides the schema' } as const }
  await writtenItem(mod, { ...fresh, revisions: [...fresh.revisions, revision], updatedAt: revision.at })
  await tick()
  await mod.callTool('withdraw', { id: 'courses', reason: 'Courses moved to the billing session' })
  await tick()

  expect(mod.shown.notes.filter((each) => each.includes('(courses)'))).toEqual(['schema planning revised "Do we want free courses?" (courses) in the inbox.'])
  expect(mod.shown.prompts).toEqual([])
})

test('a restart repeats only the answer whose send never finished, and delivers an answer given while the session was down', async () => {
  const item = { [`${itemsFolder}/courses.json`]: JSON.stringify(question([here])) }
  const first = requested('Say which courses', '2026-11-01T00:00:00.000Z')
  const second = requested('Say who pays', '2026-11-01T01:00:00.000Z')
  const before = tested({ files: { ...item, [`${personFolder}/courses.md`]: answered(first, second) } })
  const sent: string[] = []
  before.fakes.prompt.submit = async (input) => {
    sent.push(input.text)
    return sent.length === 1 ? { text: input.text } : new Promise(() => undefined)
  }
  await before.start()
  await before.settle()
  expect(answerNumbers(sent)).toEqual(['1', '2'])

  const after = tested({ files: { ...item, [`${personFolder}/courses.md`]: answered(first, second, { kind: 'answer', words: 'Yes', at: '2026-11-01T02:00:00.000Z' }) }, heard: before.state.session.heard })
  await after.start()
  await after.settle()

  expect(answerNumbers(after.shown.prompts)).toEqual(['2', '3'])
})

test('a send still in flight at /clear records no mark in the session that follows, which never had the prompt', async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([here])), [`${personFolder}/courses.md`]: answered({ kind: 'answer', words: 'Yes', at: '2026-11-01T00:00:00.000Z' }) } })
  let release = () => undefined as void
  const held = new Promise<void>((resolve) => (release = resolve))
  let reached = () => undefined as void
  const isSending = new Promise<void>((resolve) => (reached = resolve))
  mod.fakes.prompt.submit = async (input) => {
    reached()
    await held
    return { text: input.text }
  }
  await mod.start()
  await isSending

  await mod.startSession({ source: 'clear', id: 'after-clear' })
  release()
  await mod.settle()

  expect(mod.state.session.heard).toEqual({})
})

test('an answer at T1 still arrives once when another session revision at T2 is read first, in an earlier load', async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([planner, here])) } })
  const tick = ticking(mod)
  await mod.start()
  const fresh = loaded(mod, 'courses')
  const revision = { ...planner, at: '2026-11-01T02:00:00.000Z', content: { kind: 'question', title: 'Do we want free courses?', why: 'It decides the schema' } as const }
  await writtenItem(mod, { ...fresh, revisions: [...fresh.revisions, revision], updatedAt: revision.at })
  await tick()
  expect(mod.shown.notes.filter((each) => each.includes('(courses)'))).toEqual(['schema planning revised "Do we want free courses?" (courses) in the inbox.'])

  await written(mod, `${personFolder}/courses.md`, answered({ kind: 'answer', words: 'Yes', at: '2026-11-01T01:00:00.000Z' }))
  await tick()
  await tick()

  expect(answerNumbers(mod.shown.prompts)).toEqual(['1'])
})

test('a live session whose heard holds one mark per item hears no answer again after the update', async () => {
  const at = '2026-11-01T01:00:00.000Z'
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([here])), [`${personFolder}/courses.md`]: answered({ kind: 'answer', words: 'Yes', at }) }, heard: { courses: { at, count: 1 } } })
  await mod.start()
  await mod.settle()

  expect(mod.shown.prompts).toEqual([])
})

test('the first start of this release writes delivering-since and sends no answer given before it', async () => {
  const stored = { ...question([here]), status: 'answered', answers: [{ kind: 'answer', words: 'Yes', revision: 0, by: 'person', at: '2026-10-22T10:05:00.000Z' }] }
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(stored) }, isFirstStart: true })
  const startedAt = new Date().toISOString()
  await mod.start()
  await mod.settle()

  expect((await fileText(mod, deliveringSince)).trim() >= startedAt).toBe(true)
  expect(statusAt(mod)).toBe('answered')
  expect(mod.shown.prompts).toEqual([])
})

test('each session runs inbox serve on the data folder through cmod program, so one copy serves the whole computer', async () => {
  const mod = tested()
  const spawned: ProcessSpawnRequest[] = []
  mod.fakes.process.spawn = (request) => {
    spawned.push(request)
    return serving('127.0.0.1:4800')
  }
  await mod.start()
  await mod.settle()

  expect(spawned.map((request) => request.argv)).toEqual([['/test/home/.local/share/cmod/programs/cmod', 'program', 'inbox', '--no-wait', '--', 'inbox', 'serve', '--data', '/test/home/.local/share/cmod/data/inbox']])
})

test('an item whose files were deleted drops out of memory and out of read', async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([planner])), [`${itemsFolder}/pricing.json`]: JSON.stringify({ ...question([planner]), id: 'pricing' }), [`${personFolder}/pricing.md`]: answered() } })
  await mod.start()
  const { list } = mod.fakes.fs
  mod.fakes.fs.list = async (path) => ((await list?.(path)) ?? []).filter((entry) => entry.name !== 'pricing.md')
  const listed = await mod.callTool('read', {})

  expect((JSON.parse('result' in listed ? String(listed.result) : '[]') as { id: string }[]).map((each) => each.id)).toEqual(['courses'])
  expect(mod.state.memory.items.map((each) => each.id)).toEqual(['courses'])
  expect(Object.keys(mod.state.memory.person)).toEqual(['courses'])
})

test('subscribe and unsubscribe change who hears an item, and revising subscribes the reviser', async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([{ session: 'planner' }])) } })
  await mod.start()
  const hearing = () => mod.state.memory.items[0]?.subscribers.map((each) => each.session)

  await mod.callTool('subscribe', { id: 'courses' })
  expect(hearing()).toEqual(['planner', 'test-session'])
  await mod.callTool('unsubscribe', { id: 'courses' })
  expect(hearing()).toEqual(['planner'])
  await mod.callTool('revise', { id: 'courses', question: { title: 'Do we want paid courses?', why: 'It decides the schema' } })
  expect(hearing()).toEqual(['planner', 'test-session'])
})

test('read lists what is open with each link, and gives one item with every answer and the revision it answers', async () => {
  const mod = tested()
  const item = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })
  const listed = await mod.callTool('read', {})
  expect(JSON.parse('result' in listed ? String(listed.result) : '[]')).toEqual([expect.objectContaining({ id: item.id, status: 'open', link: `[Do we want courses?](file://${itemsFolder}/${item.id}.md)` })])

  const revised = await mod.callTool('revise', { id: item.id, question: { title: 'Do we want paid courses?', why: 'It decides the schema' } })
  expect('result' in revised && revised.result).toContain(`Revised ${item.id} to revision 2,`)
  await mod.shown.page.input(`answer:${item.id}`, 'Yes')
  const one = await mod.callTool('read', { id: item.id })
  const read = JSON.parse('result' in one ? String(one.result) : '{}') as { status: string; revision: number; answers: { kind: string; words: string; revision: number }[] }
  expect(read.status).toBe('answered')
  expect(read.revision).toBe(2)
  expect(read.answers.map(({ kind, words, revision }) => ({ kind, words, revision }))).toEqual([{ kind: 'answer', words: 'Yes', revision: 2 }])
})

test('a link to an item in a reply names that item, and other links are left alone', () => {
  const reply = `Read [the proposal](file://${itemsFolder}/courses.md) and [the docs](https://example.com).`

  expect(itemLinks(reply, itemsFolder)).toEqual([`file://${itemsFolder}/courses.md`])
  expect(idOfLink(`file://${itemsFolder}/courses.md`, itemsFolder)).toBe('courses')
})

test('an item another session wrote loads when the inbox starts, and an item file that does not read as an item is skipped, so read still answers', async () => {
  const mod = tested({
    files: {
      [`${itemsFolder}/courses.json`]: JSON.stringify(question([{ session: 'planner' }])),
      [`${itemsFolder}/half-written.md`]: '---\nformat: 7\nkind: "quest',
      [`${itemsFolder}/no-revisions.md`]: '---\nformat: 7\nkind: "question"\nrevision: 2\n---\n# Lost\n\nIt names a revision it does not hold\n',
    },
  })
  await mod.type('/inbox')
  const listed = await mod.callTool('read', {})

  expect(mod.state.memory.items.map((each) => each.id)).toEqual(['courses'])
  expect(mod.shown.debug.filter((line) => line.includes('skipped items/')).map((line) => line.slice(line.indexOf('skipped')))).toEqual([
    'skipped items/half-written.md, which does not read as an inbox item: items/half-written.md has no front matter between two --- lines.',
    "skipped items/no-revisions.md, which does not read as an inbox item: items/no-revisions.md's front matter has no valid by: undefined",
  ])
  expect('result' in listed).toBe(true)
})

test('an answer to a revision another session replaced is refused, and the item keeps waiting', async () => {
  const stored = question([{ session: 'planner' }])
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(stored) } })
  await mod.type('/inbox')
  const fresh = loaded(mod, 'courses')
  const revised = { ...fresh, revisions: [...fresh.revisions, { ...fresh.origin, at: '2026-10-22T11:00:00.000Z', content: { kind: 'question', title: 'Do we want paid courses?', why: 'It decides the schema' } as const }], updatedAt: '2026-10-22T11:00:00.000Z' }
  await mod.fakes.fs.write?.(`${revisionsFolder}/courses/1.md`, revisionMarkdown(revised, 0))
  await mod.fakes.fs.write?.(`${itemsFolder}/courses.md`, itemMarkdown(revised))
  await mod.shown.page.press('scope:all')
  await mod.shown.page.press('view:courses')
  await mod.shown.page.input('answer:courses', 'Yes')

  expect(mod.shown.toasts.at(-1)?.type).toBe('warning')
  expect(statusAt(mod)).toBe('open')
  expect(mod.shown.sent).toEqual([])
})

test('a second press while an answer is sending is ignored, so the person sees no refusal and the agent gets one answer', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  const { write } = mod.fakes.fs
  let release = () => undefined as void
  const held = new Promise<void>((resolve) => (release = resolve))
  let reached = () => undefined as void
  const isHeld = new Promise<void>((resolve) => (reached = resolve))
  mod.fakes.fs.write = async (path, text) => {
    if (path === `${personFolder}/${item.id}.md`) {
      reached()
      await held
    }
    return write?.(path, text)
  }

  const first = mod.shown.page.press('reject')
  await isHeld
  const second = mod.shown.page.press('reject')
  await new Promise((resolve) => setTimeout(resolve, 50))
  release()
  await Promise.all([first, second])

  expect(mod.shown.toasts.filter((each) => each.type !== 'success')).toEqual([])
  expect(personIn(mod, item).answers.map((each) => each.kind)).toEqual(['reject'])
})

test('a note whose write fails shows the reason, and the note stays open with its words', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  const { write } = mod.fakes.fs
  mod.fakes.fs.write = async (path, text) => {
    if (path === `${personFolder}/${item.id}.md`) throw new Error('The disk is full')
    return write?.(path, text)
  }

  await note(mod, item, 'goal', 'Say it in one line')

  expect(mod.shown.toasts.filter((each) => each.type !== 'success').map(({ type, description }) => ({ type, description }))).toEqual([{ type: 'error', description: 'The disk is full' }])
  expect(mod.state.session.editing).toBe(`${item.id}:goal`)
  expect(personIn(mod, item).notes).toEqual([])
})

test('a blank answer is refused with a warning, and the question keeps waiting', async () => {
  const mod = tested()
  const asked = await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })

  await mod.shown.page.input(`answer:${asked.id}`, '  \n')

  expect(mod.shown.toasts.at(-1)).toEqual({ type: 'warning', message: 'Write an answer before you send it.' })
  expect(statusOf(asked, personIn(mod, asked))).toBe('open')
})

test('a note on a revision another session replaced is refused with a warning, and the note stays open', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  const revised = { ...item, revisions: [...item.revisions, { ...item.origin, at: '2026-10-22T11:00:00.000Z', content: { ...contentOf(item), goal: 'Enums ship with no boilerplate' } as Content }] }
  await mod.fakes.fs.write?.(`${revisionsFolder}/${item.id}/1.md`, revisionMarkdown(revised, 0))
  await mod.fakes.fs.write?.(`${itemsFolder}/${item.id}.md`, itemMarkdown(revised))

  await note(mod, item, 'goal', 'Say it in one line')

  expect(mod.shown.toasts.at(-1)).toEqual({ type: 'warning', message: '"Exhaustive match needs no default" was revised while you wrote the note. Read the new revision, then write it again.' })
  expect(mod.state.session.editing).toBe(`${item.id}:goal`)
  expect(personIn(mod, item).notes).toEqual([])
})

test('a note on an item the browser answered meanwhile is refused with a warning, and the answer stays', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  const inBrowser: Person = { notes: [], answers: [{ kind: 'reject', revision: 0, at: '2026-10-22T11:00:00.000Z' }], lastRead: 0, queuedAt: '2026-10-22T10:00:00.000Z' }
  await mod.fakes.fs.write?.(`${personFolder}/${item.id}.md`, personMarkdown(inBrowser))

  await note(mod, item, 'goal', 'Say it in one line')

  expect(mod.shown.toasts.at(-1)).toEqual({ type: 'warning', message: '"Exhaustive match needs no default" was answered while you wrote the note.' })
  expect(parsePerson(item.id, await fileText(mod, `${personFolder}/${item.id}.md`))).toEqual(inBrowser)
})

test('an item whose sessions all ended opens from the Archive, and an answer nobody is running to hear stays with the item, and the user is told', async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([{ session: 'ended' }])) } })
  await mod.type('/inbox')
  await mod.shown.page.press('scope:all')
  expect(shownId(mod)).toBeUndefined()
  await mod.shown.page.press('view:courses')
  await mod.shown.page.input('answer:courses', 'Yes')

  expect(mod.shown.toasts.at(-1)).toEqual({ type: 'warning', message: 'No running session follows "Do we want courses?"', description: 'Your answer is kept with the item, and reaches its session when it resumes.' })
  expect(statusAt(mod)).toBe('answered')
})

test("the inbox shows this session's items, and widens to the project with its worktrees, then to every project", async () => {
  const another = (id: string, at: string) => ({ ...question([{ session: 'planner' }]), id, project: at })
  const mod = tested({ files: { [`${itemsFolder}/worktree.json`]: JSON.stringify(another('worktree', '/work/worktrees/design')), [`${itemsFolder}/elsewhere.json`]: JSON.stringify(another('elsewhere', '/elsewhere')) } })
  await filed(mod, 'ask_question', { title: 'Do we want courses?', why: 'It decides the schema' })

  await expect(mod.shown.page.press('view:worktree')).rejects.toThrow('view:worktree')
  await mod.shown.page.press('scope:project')
  await mod.shown.page.press('view:worktree')
  expect(shownId(mod)).toBe('worktree')
  await expect(mod.shown.page.press('view:elsewhere')).rejects.toThrow('view:elsewhere')
  await mod.shown.page.press('scope:all')
  await mod.shown.page.press('view:elsewhere')
  expect(shownId(mod)).toBe('elsewhere')
})

test('a stored report reads as the changes it shipped, and a stored screen sketch as a text example', () => {
  const sketch = { kind: 'screen', screen: 'the Inbox page', sketch: 'Nothing waits for you' }
  const content = { kind: 'report', title: 'The inbox ships', goal: 'One inbox', outcome: 'Reached, after one review.', problems: [{ title: 'Buried', ideas: [{ idea: 'Lost in replies.' }], solution: { title: 'One page holds them', ideas: [{ idea: 'It shows.', evidence: ['Reproduced live'], drawing: sketch }] } }] }
  const stored = { ...question([{ session: 'planner' }]), format: 3, kind: 'report', revisions: [{ session: 'planner', at: '2026-10-22T10:00:00.000Z', content }] }

  expect(contentOf(converted(stored, undefined, []).item)).toEqual({ kind: 'report', title: 'The inbox ships', goal: 'One inbox', changes: [{ title: 'One page holds them', drawing: { kind: 'example', language: 'text', code: 'Nothing waits for you' }, evidence: ['Reproduced live'] }] } as Content)
})

test('a long title gives an id cut between words, and a repeated title a numbered one', async () => {
  const mod = tested()
  const title = 'Do we want the inbox to sort by unblocked sessions?'
  const first = await filed(mod, 'ask_question', { title, why: 'It decides the queue order' })
  const second = await filed(mod, 'ask_question', { title, why: 'It decides the queue order' })

  expect(first.id).toBe('do-we-want-the-inbox-to-sort-by-unblocked')
  expect(second.id).toBe('do-we-want-the-inbox-to-sort-by-unblocked-2')
})

test("an item stores only its session's id, and read names the session by its title and color now, never the title stored when it was filed", async () => {
  const filedEarlier = { ...question([{ session: 'renamed', title: 'propose mod', color: 'red' } as Author]), id: 'courses' }
  const mod = testMod(inbox, { projectRoot: project, files: { ...files, [`${itemsFolder}/courses.json`]: JSON.stringify(filedEarlier) }, sessions: [{ id: 'test-session', title: 'php#', color: 'cyan', isRunning: true }, { id: 'renamed', title: 'inbox web view', color: 'green' }] })
  mod.fakes.process.run = async (argv) => ({ exitCode: 0, stdout: argv[0] === 'git' ? gitOutput(argv) : '[]', stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
  await mod.callTool('ask_question', { title: 'Do we want paid courses?', why: 'It decides the schema' })
  const answer = await mod.callTool('read', {})
  const listed = JSON.parse('result' in answer ? String(answer.result) : '[]') as readonly { readonly id: string; readonly origin: string }[]

  expect(await fileText(mod, `${itemsFolder}/do-we-want-paid-courses.md`)).toContain('\norigin: {"session":"test-session"}\n')
  expect(listed.map((each) => [each.id, each.origin])).toEqual([
    ['courses', 'inbox web view'],
    ['do-we-want-paid-courses', 'php#'],
  ])
  expect(senderIn(mod, filedEarlier as unknown as Item, filedEarlier.origin)).toEqual({ title: 'inbox web view', color: 'green', isRunning: false })
})

test('a session with no short title is named by its agent type or project folder and the start of its id, never a cut title', () => {
  const unnamed = sendersOf([{ id: 'test-session', title: '', project: '/work', isRunning: true }, { id: 'prompted-1', title: 'I have high doubts that our honcho memory works at all', project: '/work', isRunning: false }, { id: 'explorer', title: '', project: '/work', agentType: 'Explore', isRunning: false }])

  expect(unnamed).toEqual({ 'test-session': { title: 'work test-ses', isRunning: true }, 'prompted-1': { title: 'work prompted', isRunning: false }, explorer: { title: 'Explore explorer', isRunning: false } })
  expect(senderOf({ session: 'gone-session-id' }, '/work', unnamed)).toEqual({ title: 'work gone-ses' })
})

const fileText = async (mod: Tested, path: string): Promise<string> => String(await mod.fakes.fs.read?.(path))

test('a revise, a withdraw, and a subscribe never change the person file', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await note(mod, item, 'p0', 'Say who writes the default')
  const before = await fileText(mod, `${personFolder}/${item.id}.md`)

  await mod.callTool('revise', { id: item.id, proposal: { ...proposal, goal: 'Enums ship with no boilerplate' } })
  await mod.callTool('subscribe', { id: item.id })
  await mod.callTool('withdraw', { id: item.id, reason: 'The checker work moved to another session' })

  expect(await fileText(mod, `${personFolder}/${item.id}.md`)).toBe(before)
  expect(statusAt(mod)).toBe('withdrawn')
})

test('read gives an agent no notes the person is still writing', async () => {
  const mod = tested()
  const item = await filed(mod, 'propose', proposal)
  await note(mod, item, 'p0', 'A draft the agent never sees')

  const one = await mod.callTool('read', { id: item.id })
  const listed = await mod.callTool('read', {})

  expect(personAt(mod)?.notes.map((each) => each.words)).toEqual(['A draft the agent never sees'])
  expect('result' in one ? String(one.result) : '').not.toContain('A draft the agent never sees')
  expect('result' in listed ? String(listed.result) : '').not.toContain('A draft the agent never sees')
})

test('the first start of this release converts each answer, read mark, queue time, and note into the Markdown person file, empties global notes, and logs it', async () => {
  const stored = { ...question([{ session: 'planner' }]), format: 5, status: 'answered', lastRead: 0, queuedAt: '2026-10-22T10:02:00.000Z', answers: [{ kind: 'answer', words: 'Yes', revision: 0, by: 'person', at: '2026-10-22T10:05:00.000Z' }] }
  const notes = { courses: [{ path: '', revision: 0, target: 'the whole item', words: 'Only paid ones' }] }
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(stored) }, notes })
  await mod.start()

  expect(parsePerson('courses', await fileText(mod, `${personFolder}/courses.md`))).toEqual({ notes: notes.courses, answers: [{ kind: 'answer', words: 'Yes', revision: 0, at: '2026-10-22T10:05:00.000Z' }], lastRead: 0, queuedAt: '2026-10-22T10:02:00.000Z' })
  expect(mod.state.global.notes).toEqual({})
  expect(mod.shown.debug.filter((line) => line.endsWith('converted 1 JSON file to Markdown'))).toHaveLength(1)
  expect(statusAt(mod)).toBe('answered')
})

test('every start converts an item a session on the old release wrote as JSON, removes the JSON file, and keeps the person file it already has', async () => {
  const kept = personMarkdown({ notes: [], answers: [], lastRead: 0, queuedAt: '2026-10-22T10:00:00.000Z' })
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([{ session: 'planner' }])), [`${personFolder}/courses.md`]: kept } })
  await mod.start()

  expect(await fileText(mod, `${personFolder}/courses.md`)).toBe(kept)
  expect(await fileText(mod, `${itemsFolder}/courses.md`)).toStartWith('---\nformat: 7\nkind: "question"\nrevision: 1\n')
  expect(mod.calls.filter(({ call, args }) => call === 'process.run' && (args[0] as readonly string[])[0] === 'rm').map(({ args }) => args[0])).toEqual([['rm', '-f', `${itemsFolder}/courses.json`]])
  expect(mod.shown.debug.filter((line) => line.endsWith('converted 1 JSON file to Markdown'))).toHaveLength(1)
})

test('after /clear and after /resume, memory, the page, and read still hold every open item', async () => {
  const mod = tested({ files: { [`${itemsFolder}/courses.json`]: JSON.stringify(question([{ session: 'planner' }])) } })
  const item = await filed(mod, 'propose', proposal)
  const open = [item.id, 'courses'].sort()

  for (const source of ['clear', 'resume'] as const) {
    await mod.startSession({ source, id: `after-${source}` })
    const listed = await mod.callTool('read', {})
    await mod.shown.page.press('scope:all')

    expect(mod.state.memory.items.map((each) => each.id).sort()).toEqual(open)
    expect((JSON.parse('result' in listed ? String(listed.result) : '[]') as { id: string }[]).map((each) => each.id).sort()).toEqual(open)
    expect(shownId(mod)).toBeDefined()
  }
})
