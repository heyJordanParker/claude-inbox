import { expect, test } from 'bun:test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HookStream, ProcessRunResult, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'
import { testMod } from '../node_modules/@cmodjs/core/testing.js'
import { answer } from '../src/items/answers.js'
import { converted, format } from '../src/items/formats.js'
import { current, type Content, type Item, type Kind } from '../src/items/item.js'
import { itemMarkdown, parseItem, parsePerson, personMarkdown, revisionMarkdown } from '../src/items/markdown.js'
import { convertJsonFiles, createItem, itemPath, personPath, readerOf, readItems, readPerson, revisionPath, storeIn, type Disk } from '../src/items/store.js'
import { revisedSince } from '../src/items/tree.js'
import { inbox } from '../src/mod.js'

const disk: Disk = {
  read: async (path) => readFileSync(path, 'utf8'),
  write: async (path, text) => {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  },
  exists: async (path) => existsSync(path),
  list: async (folder) =>
    readdirSync(folder, { withFileTypes: true }).map((entry) => {
      const { size, mtimeMs } = statSync(join(folder, entry.name))
      return { name: entry.name, isFile: entry.isFile(), size, modifiedAt: mtimeMs }
    }),
}

const remove = async (path: string) => rmSync(path, { force: true })

const fixture = new URL('fixtures/inbox', import.meta.url).pathname

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'inbox-markdown-'))
}

function jsonOf(folder: string, id: string): Record<string, unknown> | undefined {
  const path = join(folder, `${id}.json`)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>) : undefined
}

test('every JSON item of each older format in the fixture folder converts with its person file to Markdown that reads back as the same Item and Person, for every kind', async () => {
  const root = scratch()
  try {
    cpSync(fixture, root, { recursive: true })
    const ids = readdirSync(join(root, 'items')).map((name) => name.slice(0, -'.json'.length))
    const expected = new Map(ids.map((id) => [id, converted(jsonOf(join(root, 'items'), id) ?? {}, jsonOf(join(root, 'person'), id), [])]))
    const store = storeIn(root, disk)

    const { converted: count, skipped } = await convertJsonFiles(store, {}, remove)
    const [{ items, unreadable }, { person, unreadable: unreadablePeople }] = await Promise.all([readItems(store), readPerson(store)])

    expect(ids).toHaveLength(7)
    expect([count, skipped, unreadable, unreadablePeople]).toEqual([7, [], [], []])
    expect(readdirSync(join(root, 'items')).filter((name) => name.endsWith('.json'))).toEqual([])
    expect(readdirSync(join(root, 'person')).filter((name) => name.endsWith('.json'))).toEqual([])
    for (const [id, each] of expected) {
      expect(items.find((item) => item.id === id)).toEqual(each.item)
      expect(person[id]).toEqual(each.person)
    }
    for (const item of items) expect(parseItem(item.id, itemMarkdown(item), item.revisions.slice(0, -1).map((_, index) => readFileSync(revisionPath(store, item.id, index), 'utf8')))).toEqual(item)
    for (const [id, each] of Object.entries(person)) expect(parsePerson(id, personMarkdown(each))).toEqual(each)
    expect(new Set(items.map((item) => item.kind))).toEqual(new Set<Kind>(['proposal', 'options', 'question', 'report']))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const origin = { session: 'planner', agent: 'cto' }

const revisionOf = (content: Content, at: string) => ({ ...origin, title: 'schema planning', content, at })

const proposal = (goal: string, idea: string): Content => ({
  kind: 'proposal',
  title: 'Exhaustive match needs no default',
  goal,
  problems: [{ title: 'A full match still demands a default', ideas: [{ idea }], solution: { title: 'No default', precedent: 'Rust', ideas: [{ idea: 'The checker proves the match covers every case.', drawing: { kind: 'example', language: 'ts', code: 'match (x) {}' } }] } }],
})

test('an item stored as JSON with three revisions converts to items/<id>.md and revisions/<id>/1.md and 2.md, and what changed since an earlier revision reads the same', async () => {
  const root = scratch()
  try {
    const revisions = [
      revisionOf(proposal('Enums ship without defaults', 'Users write a default the compiler proves unreachable.'), '2026-10-22T10:00:00.000Z'),
      revisionOf(proposal('Enums ship with no boilerplate', 'Users write a default the compiler proves unreachable.'), '2026-10-22T11:00:00.000Z'),
      revisionOf(proposal('Enums ship with no boilerplate', 'Every enum match carries a dead default today.'), '2026-10-22T12:00:00.000Z'),
    ]
    const stored = { format, id: 'match', kind: 'proposal', project: '/work', origin, subscribers: [{ ...origin, since: '2026-10-22T10:00:00.000Z' }], revisions, updatedAt: '2026-10-22T12:00:00.000Z' }
    const store = storeIn(root, disk)
    await disk.write(join(root, 'items', 'match.json'), JSON.stringify(stored))
    const before = converted(stored, undefined, []).item

    expect(await convertJsonFiles(store, {}, remove)).toEqual({ converted: 1, skipped: [] })
    const [after] = (await readItems(store)).items

    expect(readdirSync(join(root, 'items'))).toEqual(['match.md'])
    expect(readdirSync(join(root, 'revisions', 'match')).sort()).toEqual(['1.md', '2.md'])
    expect(after).toEqual(before)
    for (const index of [0, 1]) expect(after === undefined ? undefined : revisedSince(after.revisions[index]?.content, current(after))).toEqual(revisedSince(before.revisions[index]?.content, current(before)))
    expect(revisedSince(before.revisions[0]?.content, current(before)).changed.size).toBeGreaterThan(0)
    expect(readFileSync(itemPath(store, 'match'), 'utf8')).toStartWith('---\nformat: 7\nkind: "proposal"\nrevision: 3\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an answer the JSON person file holds survives when an earlier conversion already wrote the person file without it', async () => {
  const root = scratch()
  try {
    const first = { kind: 'correct', corrections: [{ path: '', target: 'Agents have no task list', words: 'asdf' }], revision: 0, at: '2026-10-22T17:52:03.987Z' }
    const later = { kind: 'correct', corrections: [{ path: '', revision: 1, target: 'the whole item', words: 'Split the Board into goal and tasks pages' }], revision: 1, at: '2026-11-03T23:16:27.372Z' }
    const stored = { format, id: 'board', kind: 'proposal', project: '/work', origin, subscribers: [{ ...origin, since: '2026-10-22T10:00:00.000Z' }], revisions: [revisionOf(proposal('Enums ship', 'One idea.'), '2026-10-22T10:00:00.000Z'), revisionOf(proposal('Enums ship', 'Two ideas.'), '2026-10-30T09:31:19.524Z')], updatedAt: '2026-10-30T09:31:19.524Z' }
    const json = { notes: [], answers: [first, later], lastRead: 1, queuedAt: '2026-10-22T17:51:26.197Z' }
    const { item, person } = converted(stored, json, [])
    const store = storeIn(root, disk)
    await disk.write(join(root, 'items', 'board.json'), JSON.stringify(stored))
    await disk.write(join(root, 'person', 'board.json'), JSON.stringify(json))
    await disk.write(join(root, 'revisions', 'board', '1.md'), revisionMarkdown(item, 0))
    await disk.write(itemPath(store, 'board'), itemMarkdown(item))
    await disk.write(personPath(store, 'board'), personMarkdown({ ...json, answers: person?.answers.slice(0, 1) ?? [] }))

    expect(await convertJsonFiles(store, {}, remove)).toEqual({ converted: 1, skipped: [] })

    expect((await readPerson(store)).person['board']?.answers.map((answer) => answer.corrections?.[0]?.words)).toEqual(['asdf', 'Split the Board into goal and tasks pages'])
    expect(readdirSync(join(root, 'person'))).toEqual(['board.md'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const itemOf = (content: Content, id: string, at = '2026-10-22T10:00:00.000Z'): Item => ({ format, id, kind: content.kind, project: '/work', origin, subscribers: [{ ...origin, since: at }], revisions: [{ ...origin, content, at }], updatedAt: at })

const courses: Content = { kind: 'question', title: 'Do we want courses?', why: 'It decides the billing.' }

test('a JSON item whose idea holds a ~~~ fenced bash block with a # install line stays as JSON with its reason logged, and the two JSON items beside it convert', async () => {
  const root = scratch()
  try {
    const store = storeIn(root, disk)
    const fenced = 'Install the checker first:\n\n~~~bash\n# install\nbun add match-checker\n~~~'
    await disk.write(join(root, 'items', 'first.json'), JSON.stringify(itemOf(proposal('Enums ship', 'One idea.'), 'first')))
    await disk.write(join(root, 'items', 'fenced.json'), JSON.stringify(itemOf(proposal('Enums ship', fenced), 'fenced')))
    await disk.write(join(root, 'items', 'last.json'), JSON.stringify(itemOf(proposal('Enums ship', 'Another idea.'), 'last')))

    const result = await convertJsonFiles(store, {}, remove)

    expect(result).toEqual({ converted: 2, skipped: [`items/fenced.json, which does not convert: An idea cannot hold a line that starts with "~~~", which fences a drawing in the stored Markdown. Fence code with \`\`\`: ${JSON.stringify(fenced)}`] })
    expect(readdirSync(join(root, 'items')).sort()).toEqual(['fenced.json', 'first.md', 'last.md'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an item file with a plain YAML scalar such as kind: proposal reads as that item, and an item file that does not parse is logged with the parser’s reason', async () => {
  const root = scratch()
  try {
    const store = storeIn(root, disk)
    const item = itemOf(proposal('Enums ship', 'One idea.'), 'match')
    await disk.write(itemPath(store, 'match'), itemMarkdown(item).replace('kind: "proposal"', 'kind: proposal').replace('project: "/work"', "project: '/work'"))
    await disk.write(itemPath(store, 'broken'), '---\nformat: 7\nkind: proposal\nrevision: 1\n---\n# Half written\n')

    const { items, skipped } = await readerOf(store).read()

    expect(items).toEqual([item])
    expect(skipped).toEqual(["items/broken.md, which does not read as an inbox item: items/broken.md's front matter has no valid by: undefined"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("an answer pressed while an agent's filing waits on a slow rulebook check is written before the check finishes", async () => {
  const root = scratch()
  try {
    const store = storeIn(root, disk)
    const asked = await createItem(store, 'Do we want courses?', (id) => itemOf(courses, id))
    const order: string[] = []
    let reached = () => undefined as void
    const isChecking = new Promise<void>((resolve) => (reached = resolve))
    const filing = createItem(store, 'Exhaustive match needs no default', (id) => itemOf(proposal('Enums ship', 'One idea.'), id), async () => {
      reached()
      await new Promise((resolve) => setTimeout(resolve, 200))
      order.push('checked')
    })

    await isChecking
    await answer(store, asked.id, 0, { kind: 'answer', words: 'Yes, paid ones' })
    order.push('answered')
    await filing

    expect(order).toEqual(['answered', 'checked'])
    expect((await readPerson(store)).person[asked.id]?.answers.map((each) => each.words)).toEqual(['Yes, paid ones'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a person JSON file whose item converted under a new id merges into that item, never into the Markdown item that holds the old id', async () => {
  const root = scratch()
  try {
    const store = storeIn(root, disk)
    const native = await createItem(store, 'Do we want courses?', (id) => itemOf(courses, id))
    await disk.write(join(root, 'items', `${native.id}.json`), JSON.stringify(itemOf({ ...courses, why: 'It decides the schema.' }, native.id, '2026-10-21T09:00:00.000Z')))
    expect(await convertJsonFiles(store, {}, remove)).toEqual({ converted: 1, skipped: [] })
    await disk.write(join(root, 'person', `${native.id}.json`), JSON.stringify({ notes: [], answers: [{ kind: 'answer', words: 'Yes, paid ones', revision: 0, at: '2026-11-04T10:00:00.000Z' }], lastRead: 0, queuedAt: '2026-10-21T09:00:00.000Z' }))

    expect(await convertJsonFiles(store, {}, remove)).toEqual({ converted: 1, skipped: [] })
    expect(await convertJsonFiles(store, {}, remove)).toEqual({ converted: 0, skipped: [] })
    const [{ items }, { person }] = await Promise.all([readItems(store), readPerson(store)])

    expect(person[native.id]).toBeUndefined()
    expect(person[`${native.id}-2`]?.answers.map((each) => each.words)).toEqual(['Yes, paid ones'])
    expect(Object.fromEntries(items.map((each) => [each.id, current(each)]))).toEqual({ [native.id]: courses, [`${native.id}-2`]: { ...courses, why: 'It decides the schema.' } })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a JSON item whose long id a Markdown item holds converts to one copy, and a later start converts nothing', async () => {
  const root = scratch()
  try {
    const store = storeIn(root, disk)
    const id = 'a-mod-s-program-can-run-whenever-you-re-logged-in-2'
    await disk.write(itemPath(store, id), itemMarkdown(itemOf(courses, id)))
    await disk.write(join(root, 'items', `${id}.json`), JSON.stringify(itemOf({ ...courses, why: 'It decides the schema.' }, id, '2026-10-21T09:00:00.000Z')))

    expect(await convertJsonFiles(store, {}, remove)).toEqual({ converted: 1, skipped: [] })
    expect(await convertJsonFiles(store, {}, remove)).toEqual({ converted: 0, skipped: [] })
    expect((await readItems(store)).items.map((each) => each.id).sort()).toEqual([id, `${id}-2`])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const run =(result: Partial<ProcessRunResult>): ProcessRunResult => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...result })

function tested(rulebook: (stdin: string | undefined) => Promise<ProcessRunResult>) {
  const mod = testMod(inbox, { projectRoot: '/work' })
  mod.fakes.process.run = async (argv, init) => (argv[0] === 'rulebook' ? rulebook(init?.stdin) : run({}))
  mod.fakes.process.spawn = () => {
    async function* written(): AsyncGenerator<ProcessSpawnChunk, ProcessSpawnResult> {
      yield { stream: 'stdout', text: '127.0.0.1:4800\n' }
      return await new Promise<ProcessSpawnResult>(() => undefined)
    }
    return Object.assign(written(), { result: new Promise<ProcessSpawnResult>(() => undefined) }) as HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  }
  return mod
}

const question = { title: 'Do we want courses?', why: 'It decides the schema — and the billing.' }

const itemsFolder = '/test/home/.local/share/cmod/data/inbox/items'

const refused = 'Question refused. Fix every error, then send it again.\n\n  5  error  global/block-em-dashes  An em dash joins two ideas in one sentence. Split it into two sentences.\n     > It decides the schema — and the billing.'

test('a filing whose Markdown rulebook refuses is not stored, and the agent gets the refusal word for word', async () => {
  const checked: (string | undefined)[] = []
  const mod = tested(async (stdin) => {
    checked.push(stdin)
    return run({ stdout: JSON.stringify({ refuse: refused, failures: [], findings: [] }) })
  })

  const answer = await mod.callTool('ask_question', question)

  expect(answer).toEqual({ deny: `The ask_question tool failed: ${refused}` })
  expect(mod.state.memory.items).toEqual([])
  expect(await mod.fakes.fs.exists?.(`${itemsFolder}/do-we-want-courses.md`)).toBe(false)
  expect(mod.calls.filter(({ call, args }) => call === 'process.run' && (args[0] as readonly string[])[0] === 'rulebook').map(({ args }) => [args[0], (args[1] as { readonly cwd?: string }).cwd])).toEqual([[['rulebook', 'text', '@inbox/do-we-want-courses.md'], '/test/plugins/inbox']])
  expect(checked[0]).toContain('# Do we want courses?\n\nIt decides the schema — and the billing.\n')
})

test('a filing is stored when the rulebook command fails, and the answer says the check did not run and why', async () => {
  const exited = tested(async () => run({ exitCode: 2, stderr: 'rulebook: rulebook text checks a message by its @-name: @reply.' }))
  const missing = tested(async () => {
    throw new Error('rulebook: command not found')
  })
  const noJson = tested(async () => run({ stdout: 'Checked.' }))

  const answers = await Promise.all([exited, missing, noJson].map((mod) => mod.callTool('ask_question', question)))

  expect(answers.map((answer) => ('result' in answer ? String(answer.result).split('\n\n').at(-1) : answer))).toEqual([
    'rulebook did not check this item, because rulebook text @inbox/do-we-want-courses.md exited 2: rulebook: rulebook text checks a message by its @-name: @reply.',
    'rulebook did not check this item, because rulebook text @inbox/do-we-want-courses.md did not run: rulebook: command not found',
    'rulebook did not check this item, because rulebook text @inbox/do-we-want-courses.md answered no JSON: Checked.',
  ])
  for (const mod of [exited, missing, noJson]) expect(mod.state.memory.items.map((item: Item) => item.id)).toEqual(['do-we-want-courses'])
  expect(await exited.fakes.fs.exists?.(`${itemsFolder}/do-we-want-courses.md`)).toBe(true)
})

test('an agent files an idea that holds a fenced bash block with a # install line, and it reads back equal', async () => {
  const mod = tested(async () => run({ stdout: JSON.stringify({ failures: [], findings: [] }) }))
  const idea = 'Install the checker first:\n\n```bash\n# install\nbun add match-checker\n```'
  const filed = proposal('Enums ship without defaults', idea)
  const { kind: _, ...input } = filed

  const answered = await mod.callTool('propose', input)
  const [item] = mod.state.memory.items

  expect('result' in answered).toBe(true)
  expect(item === undefined ? undefined : parseItem(item.id, String(await mod.fakes.fs.read?.(`${itemsFolder}/${item.id}.md`)), [])).toEqual(item)
  expect(item === undefined ? undefined : current(item)).toEqual(filed)
})
