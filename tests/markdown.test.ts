import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HookStream, ProcessRunResult, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'
import { testMod } from '../node_modules/@cmodjs/core/testing.js'
import { answer, setNote } from '../src/items/answers.js'
import { current, type Content, type Item } from '../src/items/item.js'
import { format, itemMarkdown, parseItem, parsePerson, personMarkdown } from '../src/items/markdown.js'
import { createItem, itemPath, personPath, readerOf, readItems, readPerson, revisionPath, storeIn, updateItem, type Disk } from '../src/items/store.js'
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

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'inbox-markdown-'))
}

const origin = { session: 'planner', agent: 'cto' }

const proposal = (goal: string, idea: string): Content => ({
  kind: 'proposal',
  title: 'Exhaustive match needs no default',
  goal,
  problems: [{ title: 'A full match still demands a default', ideas: [{ idea }], solution: { title: 'No default', precedent: 'Rust', ideas: [{ idea: 'The checker proves the match covers every case.', drawing: { kind: 'example', language: 'ts', code: 'match (x) {}' } }] } }],
})

const itemOf = (content: Content, id: string, at = '2026-10-22T10:00:00.000Z'): Item => ({ format, id, kind: content.kind, project: '/work', origin, subscribers: [{ ...origin, since: at }], revisions: [{ ...origin, content, at }], updatedAt: at })

const courses: Content = { kind: 'question', title: 'Do we want courses?', why: 'It decides the billing.' }

const choice: Content = {
  kind: 'options',
  title: 'Pick a sort order',
  goal: 'The list shows what needs you first',
  problem: { title: 'The list sorts by time', ideas: [{ idea: 'An old proposal sits under new reports.' }] },
  options: [
    { title: 'Sort by kind', ideas: [{ idea: 'Proposals first.', drawing: { kind: 'diagram', mermaid: 'graph TD\n  A --> B', drawn: 'A -> B' } }] },
    { title: 'Sort by age', ideas: [{ idea: 'Oldest first.', drawing: { kind: 'table', table: 'person', columns: [{ name: 'queuedAt', type: 'ISO time', change: 'edit', was: 'number', note: 'sorts the list' }] } }] },
  ],
}

const shipped: Content = {
  kind: 'report',
  title: 'Matches ship',
  goal: 'Enums ship without defaults',
  changes: [{ title: 'A full match compiles with no default', drawing: { kind: 'files', files: [{ path: 'src/match.ts', change: 'edit', note: 'learns exhaustiveness', diff: '@@ -1,1 +1,1 @@\n-old\n+new' }] }, evidence: ['Compiled every enum in the suite'] }],
  open: [{ title: 'Nested matches still need one', ideas: [{ idea: 'A match inside a match is not checked yet.' }], solution: { title: 'Check nested matches', ideas: [{ idea: 'The checker recurses.', drawing: { kind: 'api', path: 'src/match.ts', changes: [{ name: 'check', change: 'edit', signature: 'check(node: Node, depth: number): void', note: 'recurses' }], declarations: [{ name: 'check', header: 'check(node: Node): void', line: 3 }] } }] } }],
}

test('an item of every kind, a withdrawn one, and a report that delivers two items each write as Markdown that reads back as the same Item, with its person file', async () => {
  const root = scratch()
  try {
    const store = storeIn(root, disk)
    const withdrawn = { ...itemOf(courses, 'courses'), withdrawal: { kind: 'withdraw' as const, words: 'Moved to billing', revision: 0, by: origin, at: '2026-10-22T11:00:00.000Z' } }
    const items = [itemOf(proposal('Enums ship', 'One idea.'), 'match'), itemOf(choice, 'sort'), withdrawn, { ...itemOf(shipped, 'shipped'), delivers: ['match', 'sort'] }]
    for (const item of items) await disk.write(itemPath(store, item.id), itemMarkdown(item))
    const asked = items[0]
    if (asked === undefined) throw new Error('The proposal is missing.')
    await setNote(store, asked, 'p0', 0, 'Name the precedent')
    const person = await answer(store, asked.id, 0, { kind: 'correct', words: 'Say who writes it' })

    const [read, people] = await Promise.all([readItems(store), readPerson(store)])

    expect([...read.items].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...items].sort((a, b) => a.id.localeCompare(b.id)))
    expect([read.unreadable, people.unreadable]).toEqual([[], []])
    expect(people.person).toEqual({ match: person })
    expect(parsePerson('match', personMarkdown(person))).toEqual(person)
    expect(readFileSync(itemPath(store, 'shipped'), 'utf8')).toContain('\ndelivers: ["match","sort"]\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an item revised twice is items/<id>.md and revisions/<id>/1.md and 2.md, and what changed since an earlier revision reads the same after the round trip', async () => {
  const root = scratch()
  try {
    const store = storeIn(root, disk)
    const filed = await createItem(store, 'Exhaustive match needs no default', (id) => itemOf(proposal('Enums ship without defaults', 'Users write a default the compiler proves unreachable.'), id))
    await updateItem(store, filed.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, { ...origin, content: proposal('Enums ship with no boilerplate', 'Users write a default the compiler proves unreachable.'), at: '2026-10-22T11:00:00.000Z' }] }))
    const before = await updateItem(store, filed.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, { ...origin, content: proposal('Enums ship with no boilerplate', 'Every enum match carries a dead default today.'), at: '2026-10-22T12:00:00.000Z' }] }))

    const [after] = (await readItems(store)).items

    expect(readdirSync(join(root, 'items'))).toEqual([`${filed.id}.md`])
    expect(readdirSync(join(root, 'revisions', filed.id)).sort()).toEqual(['1.md', '2.md'])
    expect(after).toEqual(before)
    for (const index of [0, 1]) expect(after === undefined ? undefined : revisedSince(after.revisions[index]?.content, current(after))).toEqual(revisedSince(before.revisions[index]?.content, current(before)))
    expect(revisedSince(before.revisions[0]?.content, current(before)).changed.size).toBeGreaterThan(0)
    expect(readFileSync(itemPath(store, filed.id), 'utf8')).toStartWith(`---\nformat: ${format}\nkind: "proposal"\nrevision: 3\n`)
    expect(parseItem(filed.id, readFileSync(itemPath(store, filed.id), 'utf8'), [0, 1].map((index) => readFileSync(revisionPath(store, filed.id, index), 'utf8')))).toEqual(before)
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

test('an item file whose delivers is not a list of ids is skipped with the reason', async () => {
  const root = scratch()
  try {
    const store = storeIn(root, disk)
    await disk.write(itemPath(store, 'shipped'), itemMarkdown({ ...itemOf(shipped, 'shipped'), delivers: ['match'] }).replace('delivers: ["match"]', 'delivers: "match"'))

    const { items, skipped } = await readerOf(store).read()

    expect(items).toEqual([])
    expect(skipped).toEqual(['items/shipped.md, which does not read as an inbox item: items/shipped.md\'s front matter has no valid delivers: "match"'])
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
    expect(existsSync(personPath(store, asked.id))).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const run = (result: Partial<ProcessRunResult>): ProcessRunResult => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...result })

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
    return run({ exitCode: 1, stdout: `${refused}\n` })
  })

  const answer = await mod.callTool('ask_question', question)

  expect(answer).toEqual({ deny: `The ask_question tool failed: ${refused}` })
  expect(mod.state.memory.items).toEqual([])
  expect(await mod.fakes.fs.exists?.(`${itemsFolder}/do-we-want-courses.md`)).toBe(false)
  expect(mod.calls.filter(({ call, args }) => call === 'process.run' && (args[0] as readonly string[])[0] === 'rulebook').map(({ args }) => [args[0], (args[1] as { readonly cwd?: string }).cwd])).toEqual([[['rulebook', 'check', '--stdin-file-path=@inbox/do-we-want-courses.md'], '/test/plugins/inbox']])
  expect(checked[0]).toContain('# Do we want courses?\n\nIt decides the schema — and the billing.\n')
})

test('a filing is stored when the rulebook command fails, and the answer says the check did not run and why', async () => {
  const exited = tested(async () => run({ exitCode: 2, stderr: 'rulebook: rulebook.config.ts could not load.\n' }))
  const missing = tested(async () => {
    throw new Error('rulebook: command not found')
  })

  const answers = await Promise.all([exited, missing].map((mod) => mod.callTool('ask_question', question)))

  expect(answers.map((answer) => ('result' in answer ? String(answer.result).split('\n\n').at(-1) : answer))).toEqual([
    'rulebook did not check this item, because rulebook check --stdin-file-path=@inbox/do-we-want-courses.md exited 2: rulebook: rulebook.config.ts could not load.',
    'rulebook did not check this item, because rulebook check --stdin-file-path=@inbox/do-we-want-courses.md did not run: rulebook: command not found',
  ])
  for (const mod of [exited, missing]) expect(mod.state.memory.items.map((item: Item) => item.id)).toEqual(['do-we-want-courses'])
  expect(await exited.fakes.fs.exists?.(`${itemsFolder}/do-we-want-courses.md`)).toBe(true)
})

test('a filing rulebook only warns about is stored, and the agent gets the warning word for word', async () => {
  const warned = 'Question checked with 1 warning.\n\n  5  warning  global/plain-words  "leverage" has a plain word: use.\n     > It decides the schema and the billing.'
  const mod = tested(async () => run({ stdout: `${warned}\n` }))

  const answer = await mod.callTool('ask_question', question)

  expect('result' in answer ? String(answer.result) : answer).toEndWith(`and shows it to the user. This session is subscribed, so the answer arrives here as a prompt. Give the user this link in your reply, which opens it in their Sidebar: [Do we want courses?](file://${itemsFolder}/do-we-want-courses.md)\n\n${warned}`)
  expect(mod.state.memory.items.map((item: Item) => item.id)).toEqual(['do-we-want-courses'])
})

test('an agent files an idea that holds a fenced bash block with a # install line, and it reads back equal', async () => {
  const mod = tested(async () => run({}))
  const idea = 'Install the checker first:\n\n```bash\n# install\nbun add match-checker\n```'
  const filed = proposal('Enums ship without defaults', idea)
  const { kind: _, ...input } = filed

  const answered = await mod.callTool('propose', input)
  const [item] = mod.state.memory.items

  expect('result' in answered).toBe(true)
  expect(item === undefined ? undefined : parseItem(item.id, String(await mod.fakes.fs.read?.(`${itemsFolder}/${item.id}.md`)), [])).toEqual(item)
  expect(item === undefined ? undefined : current(item)).toEqual(filed)
})
