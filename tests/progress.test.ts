import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineMod, ToolCall, ToolGroup, ToolResult, type Subprocess } from '../node_modules/@cmodjs/core/mod.js'
import { testMod } from '../node_modules/@cmodjs/core/testing.js'
import type { Block } from '../src/goals/progress.js'
import { rereadMs } from '../src/items/store.js'
import { inbox } from '../src/mod.js'

const dataFolder = '/test/home/.local/share/cmod/data/inbox'

const repository = join(import.meta.dir, '..')

const bar: Block = { kind: 'bar', label: 'Tests', done: 121, total: 164 }

const checklist: Block = { kind: 'checklist', label: 'Live check', items: [{ text: 'list loads', done: true }, { text: 'answer sends', done: false }] }

const note: Block = { kind: 'note', text: "Bun's stream stalls on writes over 2 MB." }

const table: Block = { kind: 'table', label: 'Suites', columns: ['Suite', 'Passed', 'Failed'], rows: [['tests/items.test.ts', '58', '0'], ['tests/progress-blocks.test.ts', '7', '0']] }

const steps: Block = { preset: 'steps', steps: ['Build', 'Test', 'Release'], current: 1 }

function serving(): Subprocess {
  async function* written() {
    yield { stream: 'stdout' as const, text: '127.0.0.1:4800\n' }
    return await new Promise<never>(() => undefined)
  }
  return Object.assign(written(), { result: new Promise<never>(() => undefined) })
}

function tested(files: Readonly<Record<string, string>> = {}) {
  const fileTicks: (() => unknown)[] = []
  const mod = testMod(inbox, { projectRoot: '/work', files: { [`${dataFolder}/delivering-since`]: '2026-10-01T00:00:00.000Z\n', ...files }, sessions: [{ id: 'test-session', title: 'php#', isRunning: true }, { id: 's1', title: 'progress run', isRunning: true }] })
  mod.fakes.process.run = async (argv) => {
    const [program, , from, to] = argv
    if (program === 'mv' && from !== undefined && to !== undefined) await mod.fakes.fs.write?.(to, (await mod.fakes.fs.read?.(from)) ?? '')
    return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  }
  mod.fakes.process.spawn = serving
  mod.fakes.clock.every = (ms, tick) => {
    if (ms !== rereadMs) fileTicks.push(tick)
    return { cancel: () => undefined }
  }
  const fileTicked = async (times: number) => {
    for (let count = 0; count < times; count += 1) {
      for (const tick of fileTicks) tick()
      await mod.settle()
    }
  }
  return { mod, fileTicked }
}

const stored = async (mod: ReturnType<typeof tested>['mod'], session: string) => JSON.parse((await mod.fakes.fs.read?.(`${dataFolder}/progress/${session}.json`)) ?? 'null') as unknown

test('the progress tool stores exactly the blocks it gets, and the next call replaces them', async () => {
  const { mod } = tested()

  expect(await mod.callTool('progress', { blocks: [bar, checklist, note, table, steps] })).toEqual({ result: "Set this session's progress." })
  expect(mod.state.memory.progress?.blocks).toEqual([bar, checklist, note, table, steps])
  expect(await stored(mod, 'test-session')).toMatchObject({ session: 'test-session', blocks: [bar, checklist, note, table, steps] })

  await mod.callTool('progress', { blocks: [note] })
  expect(mod.state.memory.progress?.blocks).toEqual([note])
  expect(await stored(mod, 'test-session')).toMatchObject({ blocks: [note] })
  expect(await mod.fakes.fs.exists?.(`${dataFolder}/changed`)).toBe(false)
})

test('a bar whose done is above its total is refused with the reason, and nothing is stored', async () => {
  const { mod } = tested()

  expect(await mod.callTool('progress', { blocks: [note, { kind: 'bar', label: 'Tests', done: 130, total: 120 }] })).toEqual({ deny: 'The progress tool failed: Block 2 is a bar whose done, 130, is above its total, 120.' })
  expect(mod.state.memory.progress).toBeNull()
  expect(await mod.fakes.fs.exists?.(`${dataFolder}/progress/test-session.json`)).toBe(false)
})

test('a block of an unknown kind is refused with the reason, and nothing is stored', async () => {
  const { mod } = tested()
  const answer = await mod.callTool('progress', { blocks: [{ kind: 'chart', label: 'Tests' }] })

  expect('deny' in answer ? answer.deny : answer).toStartWith('The progress tool input is not valid:')
  expect(mod.state.memory.progress).toBeNull()
  expect(await mod.fakes.fs.exists?.(`${dataFolder}/progress/test-session.json`)).toBe(false)
})

const reasonsIn = (refusal: string) => refusal.split('\n').filter((line) => line.startsWith('- '))

test('a bar with a unit, a field no block takes, is refused for the same reasons by the progress tool and by inbox progress', async () => {
  const withUnit = { ...bar, unit: 'tests' }
  const { mod } = tested()
  const answer = await mod.callTool('progress', { blocks: [withUnit] })
  const denied = 'deny' in answer ? String(answer.deny) : ''
  const data = mkdtempSync(join(tmpdir(), 'inbox-progress-test-'))
  try {
    const ran = inboxProgress(data, '--session', 's1', JSON.stringify([withUnit]))

    expect(denied).toStartWith('The progress tool input is not valid:\n')
    expect(reasonsIn(denied)).toContain('- #/blocks/0: Property "unit" does not match additional properties schema.')
    expect(ran.stderr.toString()).toStartWith('inbox progress: The blocks are not valid:\n')
    expect([ran.exitCode, reasonsIn(ran.stderr.toString())]).toEqual([2, reasonsIn(denied)])
    expect(readdirSync(data)).toEqual([])
  } finally {
    rmSync(data, { recursive: true, force: true })
  }
})

test('a progress folder the mod cannot list leaves every inbox tool working', async () => {
  const { mod } = tested({ [`${dataFolder}/progress/other-session.json`]: '{}' })
  const list = mod.fakes.fs.list
  mod.fakes.fs.list = async (path) => {
    if (path === `${dataFolder}/progress`) throw new Error('EACCES: permission denied')
    return (await list?.(path)) ?? []
  }

  expect(await mod.callTool('progress', { blocks: [note] })).toEqual({ result: "Set this session's progress." })
  expect(mod.state.memory.progress?.blocks).toEqual([note])
})

const missingFileTicks = 4

const inboxProgress =(data: string, ...given: string[]) => Bun.spawnSync(['bun', 'cli/src/main.ts', 'progress', '--data', data, ...given], { cwd: repository, env: { ...process.env, CLAUDE_CODE_SESSION_ID: '' } })

test("inbox progress writes only the session's progress file, and that session's mod holds the blocks once its watch of the file fires, and never another session's", async () => {
  const data = mkdtempSync(join(tmpdir(), 'inbox-progress-test-'))
  try {
    const ran = inboxProgress(data, '--session', 'test-session', JSON.stringify([bar, steps]))
    expect([ran.exitCode, ran.stderr.toString()]).toEqual([0, ''])
    const written = readFileSync(join(data, 'progress', 'test-session.json'), 'utf8')
    expect(JSON.parse(written)).toMatchObject({ session: 'test-session', blocks: [bar, steps] })
    expect(readdirSync(data)).toEqual(['progress'])

    const { mod, fileTicked } = tested()
    await mod.start()
    await mod.settle()
    await mod.fakes.fs.write?.(`${dataFolder}/progress/s1.json`, JSON.stringify({ session: 's1', blocks: [note], at: '2026-11-22T10:00:00.000Z' }))
    await mod.fakes.fs.write?.(`${dataFolder}/progress/test-session.json`, written)
    await fileTicked(missingFileTicks)
    expect(mod.state.memory.progress).toEqual(JSON.parse(written))
  } finally {
    rmSync(data, { recursive: true, force: true })
  }
})

test('inbox progress reads the blocks from stdin', () => {
  const data = mkdtempSync(join(tmpdir(), 'inbox-progress-test-'))
  try {
    const ran = Bun.spawnSync(['bun', 'cli/src/main.ts', 'progress', '--data', data, '--session', 's2'], { cwd: repository, stdin: Buffer.from(JSON.stringify([note])) })
    expect(ran.exitCode).toBe(0)
    expect(JSON.parse(readFileSync(join(data, 'progress', 's2.json'), 'utf8'))).toMatchObject({ blocks: [note] })
  } finally {
    rmSync(data, { recursive: true, force: true })
  }
})

test('inbox progress exits 2 with the reason on a bad block, and writes nothing', () => {
  const data = mkdtempSync(join(tmpdir(), 'inbox-progress-test-'))
  try {
    const ran = inboxProgress(data, '--session', 's1', JSON.stringify([{ kind: 'bar', label: 'Tests', done: 130, total: 120 }]))
    expect(ran.exitCode).toBe(2)
    expect(ran.stderr.toString()).toStartWith('inbox progress: Block 1 is a bar whose done, 130, is above its total, 120.\n')
    expect(Bun.spawnSync(['ls', '-A', data]).stdout.toString()).toBe('')
  } finally {
    rmSync(data, { recursive: true, force: true })
  }
})

const toolCall = (tool: string, isExpanded?: boolean) => ({ tool_use_id: 'toolu_1', tool, input: { blocks: [note] }, isRunning: false, isErrored: false, isInterrupted: false, ...(isExpanded === undefined ? {} : { isExpanded }) })

const toolResult = (tool: string, isExpanded?: boolean) => ({ tool_use_id: 'toolu_1', tool, output: "Set this session's progress.", isErrored: false, ...(isExpanded === undefined ? {} : { isExpanded }) })

const unstyled = () => testMod(defineMod({ name: 'unstyled', state: {}, setup: () => undefined }))

test('a progress call and its result draw no rows in the chat', async () => {
  const { mod } = tested()

  expect(await mod.lines(ToolCall, toolCall('mcp__inbox__progress'))).toEqual([])
  expect(await mod.lines(ToolResult, toolResult('mcp__inbox__progress'))).toEqual([])
  expect(await mod.lines(ToolCall, toolCall('mcp__inbox__progress', false))).toEqual([])
})

test('every other tool and an expanded progress call draw as many rows as Claude Code draws for them', async () => {
  const { mod } = tested()
  const rows = async (drawing: Pick<typeof mod, 'lines'>) => [
    (await drawing.lines(ToolCall, toolCall('mcp__inbox__propose'))).length,
    (await drawing.lines(ToolResult, toolResult('mcp__inbox__propose'))).length,
    (await drawing.lines(ToolCall, toolCall('mcp__inbox__progress', true))).length,
    (await drawing.lines(ToolResult, toolResult('mcp__inbox__progress', true))).length,
  ]

  expect(await rows(mod)).toEqual(await rows(unstyled()))
  expect(await rows(mod)).not.toContain(0)
})

test('a group that holds a progress call draws as Claude Code draws it unfolded, and any other group as it was', async () => {
  const { mod } = tested()
  const claudeCode = unstyled()
  const call = (tool: string) => ({ tool_use_id: 'toolu_1', tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false })
  const group = (tools: readonly string[], isExpanded: boolean) => ({ calls: tools.map(call), isActive: false, isExpanded })

  expect(await mod.lines(ToolGroup, group(['Read', 'mcp__inbox__progress'], false))).toEqual(await claudeCode.lines(ToolGroup, group(['Read', 'mcp__inbox__progress'], true)))
  expect(await mod.lines(ToolGroup, group(['Read', 'Grep'], false))).toEqual(await claudeCode.lines(ToolGroup, group(['Read', 'Grep'], false)))
})
