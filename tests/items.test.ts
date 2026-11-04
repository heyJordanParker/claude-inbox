import { expect, setSystemTime, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { actionsOf, answer, dropNote, markRead, Moved, NotOffered, setNote, skip, viewingAfterAnswer } from '../src/items/answers.js'
import { changeCounts, diagramKindOf, diffOf, drawingLabel, kindOf, statsOf, treeOf } from '../src/items/drawings.js'
import { format } from '../src/items/formats.js'
import { advanced, marksIn, unheard } from '../src/items/heard.js'
import { ago, archive, cardStatusOf, closingLines, closingOf, isArchived, isFollowed, narrowestScope, personOf, positionLine, queue, repositoryOf, scopes, shownOf, statusOf, type CodeDiff, type Content, type Item, type Note, type Person, type Run, type Scope, type Senders } from '../src/items/item.js'
import { parsePerson, personMarkdown } from '../src/items/markdown.js'
import { convertJsonFiles, createItem, itemPath, personPath, readerOf, readItems, readPerson, storeIn, updateItem, type Disk } from '../src/items/store.js'
import { foldKey, folds, isChanged, isUnchanged, opensAt, rootsOf, summaryOf, unrevised, type Revised } from '../src/items/tree.js'

const core = new URL('../src/items/', import.meta.url).pathname

function memoryDisk(): Disk & { readonly reads: string[]; readonly writes: string[]; remove(path: string): void } {
  const files = new Map<string, { readonly text: string; readonly modifiedAt: number }>()
  const reads: string[] = []
  const writes: string[] = []
  let clock = 0
  return {
    reads,
    writes,
    async read(path) {
      reads.push(path)
      const file = files.get(path)
      if (file === undefined) throw new Error(`${path} does not exist`)
      return file.text
    },
    async write(path, text) {
      writes.push(path)
      clock += 1
      files.set(path, { text, modifiedAt: clock })
    },
    remove: (path) => void files.delete(path),
    exists: async (path) => files.has(path) || [...files.keys()].some((each) => each.startsWith(`${path}/`)),
    list: async (folder) => [...files].filter(([path]) => path.slice(0, path.lastIndexOf('/')) === folder).map(([path, file]) => ({ name: path.slice(folder.length + 1), isFile: true, size: file.text.length, modifiedAt: file.modifiedAt })),
  }
}

const origin = { session: 'planner' }

const proposal: Content = {
  kind: 'proposal',
  title: 'Exhaustive match needs no default',
  goal: 'Enums ship without boilerplate defaults',
  problems: [
    {
      title: 'A full match still demands a default',
      ideas: [{ idea: 'Users write a default the compiler could prove unreachable.' }],
      solution: { title: 'No default', ideas: [{ idea: 'A match that covers every case compiles.', drawing: { kind: 'example', language: 'md', code: 'A match covers every case.' } }] },
    },
  ],
}

const question: Content = { kind: 'question', title: 'Do we want courses?', why: 'It decides the schema' }

function itemOf(content: Content, id: string): Item {
  return { format, id, kind: content.kind, project: '/work', origin, subscribers: [{ ...origin, since: '2026-10-22T10:00:00.000Z' }], revisions: [{ ...origin, content, at: '2026-10-22T10:00:00.000Z' }], updatedAt: '2026-10-22T10:00:00.000Z' }
}

const nobody = (item: Item): Person => personOf({}, item)

async function filed(content: Content) {
  const disk = memoryDisk()
  const store = storeIn('/data', disk)
  const item = await createItem(store, content.title, (id) => itemOf(content, id))
  return { disk, store, item }
}

const note = (path: string, words: string, revision = 0): Note => ({ path, revision, target: path === '' ? 'the whole item' : path, words })

const withNotes = (item: Item, notes: readonly Note[]): Person => ({ ...nobody(item), notes })

const rows = (item: Item, person: Person, hasNext = true, isCommenting = false) => actionsOf(item, person, { hasNext, isCommenting }).map(({ id, label, hotkey, isPrimary }) => [id, label, hotkey, isPrimary])

test('both views stay on an item after Request changes, leave it after any other answer, and keep another item they show', () => {
  expect(viewingAfterAnswer({ kind: 'correct' }, 'courses', null)).toBe('courses')
  expect(viewingAfterAnswer({ kind: 'approve' }, 'courses', 'courses')).toBeNull()
  expect(viewingAfterAnswer({ kind: 'reject' }, 'courses', 'pricing')).toBe('pricing')
})

test('an item a view opens, open or closed, widens the scope to the narrowest one, from the current one up, that holds it', () => {
  const here = itemOf(question, 'here')
  const elsewhere = itemOf(question, 'elsewhere')
  const closed = itemOf(question, 'closed')
  const itemsIn = (scope: Scope) => (scope === 'session' ? [here] : scope === 'project' ? [here, closed] : [here, closed, elsewhere])

  expect(narrowestScope(scopes, 'session', 'here', itemsIn)).toBe('session')
  expect(narrowestScope(scopes, 'session', 'elsewhere', itemsIn)).toBe('all')
  expect(narrowestScope(scopes, 'all', 'here', itemsIn)).toBe('all')
  expect(narrowestScope(scopes, 'session', 'closed', itemsIn)).toBe('project')
  expect(narrowestScope(scopes, 'session', 'missing', itemsIn)).toBe('session')
})

test('every closed item is in the Archive newest first, marked with what closed it, and opens with its answer', () => {
  const rejected = itemOf(proposal, 'rejected')
  const withdrawn = { ...itemOf(question, 'withdrawn'), withdrawal: { kind: 'withdraw' as const, words: 'Moved to billing', revision: 0, by: origin, at: '2026-10-22T10:20:00.000Z' } }
  const open = itemOf(question, 'open')
  const person = { rejected: { ...nobody(rejected), answers: [{ kind: 'reject' as const, revision: 0, at: '2026-10-22T10:10:00.000Z', corrections: [{ path: 'p0', revision: 0, target: 'Problem 1', words: 'Wrong problem' }] }] } }
  const linesOf = (item: Item) => {
    const closing = closingOf(item, personOf(person, item))
    return closing === undefined ? [] : closingLines(item, closing, { planner: { title: 'schema planning' } })
  }

  const archived = archive([rejected, withdrawn, open], person, {})

  expect(archived.map((item) => [item.id, cardStatusOf(item, personOf(person, item), {})?.word])).toEqual([
    ['withdrawn', 'withdrawn'],
    ['rejected', 'rejected'],
  ])
  expect(archived.map(linesOf)).toEqual([['schema planning withdrew it: Moved to billing'], ['✎ Problem 1: Wrong problem']])
  expect(queue([rejected, withdrawn, open], person, {}).map((item) => item.id)).toEqual(['open'])
  expect(shownOf([open, rejected], person, {}, 'rejected')?.id).toBe('rejected')
  expect(actionsOf(rejected, personOf(person, rejected), { hasNext: true, isCommenting: false })).toEqual([])
})

const stopped: Senders = { planner: { title: 'schema planning', isRunning: false } }

const running: Senders = { planner: { title: 'schema planning', isRunning: true } }

test('an open item whose sessions all stopped is in the Archive, marked agent closed, and still opens with its answer buttons', () => {
  const item = itemOf(question, 'courses')

  expect(queue([item], {}, stopped)).toEqual([])
  expect(archive([item], {}, stopped)).toEqual([item])
  expect(cardStatusOf(item, nobody(item), stopped)).toEqual({ word: 'agent closed', tone: 'archived' })
  expect(positionLine([], item, nobody(item), Date.parse('2026-10-22T10:05:00.000Z'))).toBe('agent closed · 5m ago')
  expect(rows(item, nobody(item)).map(([id]) => id)).toContain('answer')
})

test('an open item is in the list while any of its sessions runs, so it comes back from the Archive when its session resumes', () => {
  const item = itemOf(question, 'courses')
  const followed = { ...item, subscribers: [...item.subscribers, { session: 'reviewer', since: '2026-10-22T10:01:00.000Z' }] }

  expect(queue([item], {}, running)).toEqual([item])
  expect(archive([item], {}, running)).toEqual([])
  expect(cardStatusOf(item, nobody(item), running)).toEqual({ word: 'new', tone: 'unseen' })
  expect(queue([followed], {}, { ...stopped, reviewer: { title: 'review', isRunning: true } })).toEqual([followed])
})

test('an open item stays in the list while the inbox does not know whether its sessions run', () => {
  const item = itemOf(question, 'courses')

  expect(queue([item], {}, {})).toEqual([item])
  expect(queue([item], {}, { planner: { title: 'schema planning' } })).toEqual([item])
  expect(archive([item], {}, {})).toEqual([])
})

test('an item with requested changes is in the list, not the Archive, marked changes requested', () => {
  const item = itemOf(proposal, 'match')
  const person = { match: { ...nobody(item), lastRead: 0, answers: [{ kind: 'correct' as const, revision: 0, at: '2026-10-22T10:10:00.000Z', corrections: [note('p0', 'Say who writes the default')] }] } }

  expect(queue([item], person, running)).toEqual([item])
  expect(archive([item], person, running)).toEqual([])
  expect(cardStatusOf(item, personOf(person, item), running)).toEqual({ word: 'changes requested', tone: 'requested' })
})

test('the item shown by default is the first in the list that needs the person, past one waiting on requested changes and one in the Archive', () => {
  const requested = itemOf(proposal, 'requested')
  const ended = { ...itemOf(question, 'ended'), origin: { session: 'ended' }, subscribers: [{ session: 'ended', since: '2026-10-22T10:00:00.000Z' }] }
  const fresh = itemOf(question, 'fresh')
  const person = {
    requested: { ...nobody(requested), queuedAt: '2026-10-22T10:00:00.000Z', answers: [{ kind: 'correct' as const, revision: 0, at: '2026-10-22T10:10:00.000Z', corrections: [note('p0', 'Say more')] }] },
    ended: { ...nobody(ended), queuedAt: '2026-10-22T10:01:00.000Z' },
    fresh: { ...nobody(fresh), queuedAt: '2026-10-22T10:02:00.000Z' },
  }
  const senders = { ...running, ended: { title: 'ended', isRunning: false } }

  expect(queue([requested, ended, fresh], person, senders).map((item) => item.id)).toEqual(['requested', 'fresh'])
  expect(shownOf([requested, ended, fresh], person, senders, null)?.id).toBe('fresh')
  expect(shownOf([requested, ended], person, senders, null)?.id).toBe('requested')
  expect(shownOf([ended], person, senders, null)).toBeUndefined()
})

test('no file in src/items imports @cmodjs/core, so a program outside Claude Code runs the same core', () => {
  const files = readdirSync(core)

  expect(files).toContain('store.ts')
  expect(files.filter((name) => readFileSync(`${core}${name}`, 'utf8').includes('@cmodjs/core'))).toEqual([])
})

test('the store files an item under an id from its title, writes which item changed, and reads it back', async () => {
  const { disk, store, item } = await filed(proposal)

  expect(item.id).toBe('exhaustive-match-needs-no-default')
  expect(await disk.read('/data/changed')).toBe(`${item.updatedAt} exhaustive-match-needs-no-default\n`)
  expect((await readItems(store)).items).toEqual([item])
})

test('a reread with the last stamps reads only the item a writer changed', async () => {
  const { disk, store } = await filed(proposal)
  const other = await createItem(store, question.title, (id) => itemOf(question, id))
  const { stamps } = await readItems(store)
  await updateItem(store, other.id, (fresh) => ({ ...fresh, subscribers: [] }))
  disk.reads.length = 0

  const reread = await readItems(store, stamps)

  expect(reread.items.map((each) => each.id)).toEqual(['do-we-want-courses'])
  expect(disk.reads.filter((path) => path.startsWith('/data/items/'))).toEqual(['/data/items/do-we-want-courses.md'])
})

test('an item file that does not read as an item is skipped as unreadable, and the other items still read', async () => {
  const { disk, store, item } = await filed(proposal)
  await disk.write(itemPath(store, 'broken'), '---\nformat: 7\n---\n# Half written\n')

  const read = await readItems(store)

  expect(read.items.map((each) => each.id)).toEqual([item.id])
  expect(read.unreadable).toEqual([{ id: 'broken', reason: "items/broken.md's front matter has no valid kind: undefined" }])
})

test('the conversion to Markdown leaves a JSON file it cannot read, names it, and converts the rest', async () => {
  const disk = memoryDisk()
  const store = storeIn('/data', disk)
  const stored = { ...itemOf(proposal, 'match'), format: 5, status: 'open', lastRead: 0, queuedAt: '2026-10-22T10:05:00.000Z', answers: [] }
  await disk.write('/data/items/match.json', JSON.stringify(stored))
  await disk.write('/data/items/broken.json', JSON.stringify({ id: 'broken', format: 3 }))

  expect(await convertJsonFiles(store, {}, async (path) => disk.remove(path))).toEqual({ converted: 1, skipped: ['items/broken.json, which does not convert: it holds no revisions'] })
  expect(await disk.exists(personPath(store, 'match'))).toBe(true)
  expect([await disk.exists('/data/items/match.json'), await disk.exists(itemPath(store, 'match'))]).toEqual([false, true])
  expect(await disk.read('/data/items/broken.json')).toBe(JSON.stringify({ id: 'broken', format: 3 }))
})

test('a reread names the item and person files deleted since the last read, and a read of every file names them too', async () => {
  const { disk, store, item } = await filed(proposal)
  const other = await createItem(store, question.title, (id) => itemOf(question, id))
  await setNote(store, item, '', 0, 'Ship it')
  const reader = readerOf(store)
  expect((await reader.read()).gone).toEqual({ items: [], person: [] })

  disk.remove(itemPath(store, other.id))
  disk.remove(personPath(store, item.id))
  const reread = await reader.read()
  disk.remove(itemPath(store, item.id))
  const everyFile = await reader.readAll()

  expect(reread.gone).toEqual({ items: [other.id], person: [item.id] })
  expect(everyFile.gone).toEqual({ items: [item.id], person: [] })
})

test('two overlapping reads finish in the order they started, so the later one holds the newer person file', async () => {
  const { disk, store, item } = await filed(proposal)
  const reader = readerOf(store)
  await setNote(store, item, '', 0, 'First')
  let release = () => undefined as void
  const held = new Promise<void>((resolve) => (release = resolve))
  let reached = () => undefined as void
  const isHeld = new Promise<void>((resolve) => (reached = resolve))
  const { read } = disk
  let isHolding = true
  disk.read = async (path) => {
    const text = await read(path)
    if (isHolding && path === personPath(store, item.id)) {
      isHolding = false
      reached()
      await held
    }
    return text
  }
  const finished: string[] = []
  const earlier = reader.read().then((fresh) => (finished.push('earlier'), fresh))
  await isHeld
  await setNote(store, item, '', 0, 'Second')
  const later = reader.read().then((fresh) => (finished.push('later'), fresh))
  await new Promise((resolve) => setTimeout(resolve, 10))
  release()
  const [, last] = await Promise.all([earlier, later])

  expect(finished).toEqual(['earlier', 'later'])
  expect(last.person[item.id]?.notes.map((each) => each.words)).toEqual(['Second'])
})

test('a reread of person files reads only the one a view wrote, and the item changed names in both folders', async () => {
  const { disk, store, item } = await filed(proposal)
  const other = await createItem(store, question.title, (id) => itemOf(question, id))
  await setNote(store, item, 'p0', 0, 'Name it')
  await setNote(store, other, '', 0, 'Ask about pricing')
  const items = await readItems(store)
  const person = await readPerson(store)
  expect(Object.keys(person.person).sort()).toEqual(['do-we-want-courses', 'exhaustive-match-needs-no-default'])

  await setNote(store, other, '', 0, 'Ask about paid courses')
  disk.reads.length = 0
  const reread = await Promise.all([readItems(store, items.stamps), readPerson(store, person.stamps)])

  expect(reread[0].items.map((each) => each.id)).toEqual(['do-we-want-courses'])
  expect(reread[1].person['do-we-want-courses']?.notes.map((each) => each.words)).toEqual(['Ask about paid courses'])
  expect(disk.reads.filter((path) => path.startsWith('/data/person/'))).toEqual(['/data/person/do-we-want-courses.md'])
})

test('a new item never takes the id of a person file whose item file is gone, so it starts with no old answer', async () => {
  const disk = memoryDisk()
  const store = storeIn('/data', disk)
  await disk.write(personPath(store, 'do-we-want-courses'), personMarkdown({ notes: [], answers: [{ kind: 'reject', revision: 0, at: '2026-10-22T10:10:00.000Z' }], lastRead: 0, queuedAt: '2026-10-22T10:00:00.000Z' }))

  const item = await createItem(store, question.title, (id) => itemOf(question, id))

  expect(item.id).toBe('do-we-want-courses-2')
})

test('an update to an id the store does not hold is refused', async () => {
  const { store } = await filed(proposal)

  await expect(updateItem(store, 'gone', (fresh) => fresh)).rejects.toThrow('The inbox has nothing with the id gone.')
})

test('a note save, an answer, a read mark, and Next → never change the item file', async () => {
  const { disk, store, item } = await filed(proposal)
  const before = await disk.read(itemPath(store, item.id))

  await setNote(store, item, 'p0', 0, 'Name it')
  await dropNote(store, item, 'p0', 0)
  await markRead(store, item, 0)
  await skip(store, item, 0)
  await answer(store, item.id, 0, { kind: 'approve' })

  expect(await disk.read(itemPath(store, item.id))).toBe(before)
})

test('an answer carries the notes as corrections and empties them in one write of the person file', async () => {
  const { disk, store, item } = await filed(proposal)
  await setNote(store, item, 'p0', 0, 'Say who writes the default')
  disk.writes.length = 0

  const person = await answer(store, item.id, 0, { kind: 'approve' })

  expect(disk.writes.filter((path) => path === personPath(store, item.id))).toHaveLength(1)
  expect(person.notes).toEqual([])
  expect(person.lastRead).toBe(0)
  expect(person.answers.map(({ kind, corrections, revision }) => ({ kind, corrections, revision }))).toEqual([{ kind: 'approve', corrections: [{ path: 'p0', target: 'Problem 1: A full match still demands a default', words: 'Say who writes the default', revision: 0 }], revision: 0 }])
  expect(parsePerson(item.id, await disk.read(personPath(store, item.id)))).toEqual(person)
  expect(statusOf(item, person)).toBe('answered')
})

test('a request for changes keeps the item open, and one with no note is refused', async () => {
  const { store, item } = await filed(proposal)

  await expect(answer(store, item.id, 0, { kind: 'correct' })).rejects.toThrow(new NotOffered('Write a note before you request changes.'))
  await setNote(store, item, 'p0', 0, 'Name it')
  expect(statusOf(item, await answer(store, item.id, 0, { kind: 'correct' }))).toBe('open')
})

test('an answer the item does not offer is refused, and the person file stays as it was', async () => {
  const asked = await filed(question)
  const picked = await filed({ kind: 'options', title: 'Pick', goal: 'Enums ship', problem: { title: 'Defaults', ideas: [{ idea: 'Dead code.' }] }, options: [{ title: 'Match', ideas: [] }] })
  const reported = await filed({ kind: 'report', title: 'The inbox ships', goal: 'One inbox', changes: [] })

  await expect(answer(asked.store, asked.item.id, 0, { kind: 'approve' })).rejects.toThrow(new NotOffered('"Do we want courses?" does not offer approve.'))
  await expect(answer(picked.store, picked.item.id, 0, { kind: 'option', option: 'Neither' })).rejects.toThrow(NotOffered)
  await expect(answer(reported.store, reported.item.id, 0, { kind: 'reject' })).rejects.toThrow(NotOffered)
  expect(await asked.disk.exists(personPath(asked.store, asked.item.id))).toBe(false)
  expect(statusOf(picked.item, await answer(picked.store, picked.item.id, 0, { kind: 'option', option: 'Match' }))).toBe('answered')
})

test('a blank answer to a question is refused and stores nothing, and an answer is stored trimmed', async () => {
  const { disk, store, item } = await filed(question)

  await expect(answer(store, item.id, 0, { kind: 'answer', words: '  \n' })).rejects.toThrow(new NotOffered('Write an answer before you send it.'))
  await expect(answer(store, item.id, 0, { kind: 'answer' })).rejects.toThrow(NotOffered)
  expect(await disk.exists(personPath(store, item.id))).toBe(false)
  expect((await answer(store, item.id, 0, { kind: 'answer', words: '  Yes, paid ones\n' })).answers.map((each) => each.words)).toEqual(['Yes, paid ones'])
})

test('an answer to a revision another writer replaced, or to a closed item, is refused as moved', async () => {
  const { store, item } = await filed(question)
  await updateItem(store, item.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, { ...origin, content: { ...question, title: 'Do we want paid courses?' }, at: '2026-10-22T11:00:00.000Z' }] }))

  await expect(answer(store, item.id, 0, { kind: 'answer', words: 'Yes' })).rejects.toThrow('"Do we want paid courses?" was revised while you read it. Read the new revision, then answer.')
  await answer(store, item.id, 1, { kind: 'answer', words: 'Yes' })
  await expect(answer(store, item.id, 1, { kind: 'answer', words: 'No' })).rejects.toBeInstanceOf(Moved)
})

test('two answers given at once through one store store one, and the second is refused as moved', async () => {
  const { store, item } = await filed(proposal)

  const both = await Promise.allSettled([answer(store, item.id, 0, { kind: 'approve' }), answer(store, item.id, 0, { kind: 'reject' })])

  expect(both.map((each) => (each.status === 'fulfilled' ? 'stored' : each.reason instanceof Moved ? 'moved' : 'failed'))).toEqual(['stored', 'moved'])
  expect((await readPerson(store)).person[item.id]?.answers.map((each) => each.kind)).toEqual(['approve'])
})

test("an agent's revise read before an Approve and written after it keeps both", async () => {
  const { disk, store, item } = await filed(proposal)
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const slowItemWrites: Disk = { ...disk, write: async (path, text) => (path === itemPath(store, item.id) ? held.then(() => disk.write(path, text)) : disk.write(path, text)) }
  const revising = updateItem(storeIn('/data', slowItemWrites), item.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, { ...origin, content: { ...proposal, goal: 'Enums ship with no boilerplate' }, at: '2026-10-22T11:00:00.000Z' }] }))

  await answer(store, item.id, 0, { kind: 'approve' })
  release()
  const revised = await revising
  const person = (await readPerson(store)).person[item.id]

  expect(revised.revisions).toHaveLength(2)
  expect(person?.answers.map((each) => each.kind)).toEqual(['approve'])
  expect(person === undefined ? 'missing' : statusOf(revised, person)).toBe('answered')
})

test("an item's status is the person's answer or the agent's withdrawal, whichever came first", () => {
  const item = itemOf(proposal, 'p')
  const withdrawn: Item = { ...item, withdrawal: { kind: 'withdraw', words: 'Moved to billing', revision: 0, by: origin, at: '2026-10-22T11:00:00.000Z' } }
  const answeredAt = (at: string): Person => ({ ...nobody(item), answers: [{ kind: 'approve', revision: 0, at }] })
  const corrected: Person = { ...nobody(item), answers: [{ kind: 'correct', corrections: [], revision: 0, at: '2026-10-22T10:30:00.000Z' }] }

  expect(statusOf(item, nobody(item))).toBe('open')
  expect(statusOf(item, corrected)).toBe('open')
  expect(statusOf(withdrawn, nobody(item))).toBe('withdrawn')
  expect(statusOf(withdrawn, answeredAt('2026-10-22T10:59:00.000Z'))).toBe('answered')
  expect(statusOf(withdrawn, answeredAt('2026-10-22T11:01:00.000Z'))).toBe('withdrawn')
})

test('a rejection closes only the revision it answered, so the next revision is open, listed as changed, and keeps the rejection', async () => {
  const { store, item } = await filed(proposal)
  const rejected = await answer(store, item.id, 0, { kind: 'reject' })
  const revised = await updateItem(store, item.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, { ...origin, content: { ...proposal, goal: 'Enums ship with no boilerplate' }, at: '2026-10-22T11:00:00.000Z' }] }))
  const { person } = await readPerson(store)
  const kept = personOf(person, revised)

  expect(cardStatusOf(item, rejected, running)).toEqual({ word: 'rejected', tone: 'archived' })
  expect(statusOf(revised, kept)).toBe('open')
  expect(queue([revised], person, running)).toEqual([revised])
  expect(cardStatusOf(revised, kept, running)).toEqual({ word: 'changed', tone: 'unseen' })
  expect(kept.answers.map(({ kind, revision }) => ({ kind, revision }))).toEqual([{ kind: 'reject', revision: 0 }])
  expect(cardStatusOf(revised, await answer(store, item.id, 1, { kind: 'reject' }), running)).toEqual({ word: 'rejected', tone: 'archived' })
})

test('one read of the senders says both whether an item is archived and whether a running session follows it, and a session not read yet counts as running', () => {
  const item = itemOf(question, 'courses')
  const unsubscribed = { ...item, subscribers: [] }

  expect([isArchived(item, nobody(item), stopped), isFollowed(item, stopped)]).toEqual([true, false])
  expect([isArchived(item, nobody(item), running), isFollowed(item, running)]).toEqual([false, true])
  expect([isArchived(item, nobody(item), {}), isFollowed(item, {})]).toEqual([false, true])
  expect([isArchived(unsubscribed, nobody(unsubscribed), running), isFollowed(unsubscribed, running)]).toEqual([true, false])
})

test('a note names its part, replaces the note on that part and revision, and an empty one drops it', async () => {
  const { store, item } = await filed(proposal)
  const target = 'Problem 1: A full match still demands a default'
  const earlier = { path: 'p0', revision: 0, target, words: 'Written on revision 0' }
  expect((await setNote(store, item, 'p0', 0, 'Written on revision 0')).notes).toEqual([earlier])
  const revised = await updateItem(store, item.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, ...fresh.revisions] }))

  const written = await setNote(store, revised, 'p0', 1, '  Say who writes it  ')
  expect(written.notes).toEqual([earlier, { path: 'p0', revision: 1, target, words: 'Say who writes it' }])
  expect((await setNote(store, revised, 'p0', 1, 'Name the precedent')).notes.map((each) => each.words)).toEqual(['Written on revision 0', 'Name the precedent'])
  expect((await setNote(store, revised, 'p0', 1, '   ')).notes.map((each) => each.words)).toEqual(['Written on revision 0'])
  expect((await dropNote(store, revised, 'p0', 0)).notes).toEqual([])
  expect((await dropNote(store, revised, 'p0', 0)).notes).toEqual([])
  expect((await setNote(store, revised, 'goal', 1, 'Say it in one line')).notes.map((each) => each.target)).toEqual(['Goal'])
  const asked = await filed(question)
  expect((await setNote(asked.store, asked.item, 'why', 0, 'Name who waits')).notes.map((each) => each.target)).toEqual(['Why it matters'])
})

test('a note set or dropped on an item another view answered, or an agent withdrew, is refused as moved and changes nothing', async () => {
  const { store, item } = await filed(proposal)
  await setNote(store, item, 'p0', 0, 'Written before the answer')
  const answered = await answer(store, item.id, 0, { kind: 'reject' })
  const withdrawn = await filed(question)
  await updateItem(withdrawn.store, withdrawn.item.id, (fresh) => ({ ...fresh, withdrawal: { kind: 'withdraw', words: 'Moved to billing', revision: 0, by: origin, at: '2026-10-22T11:00:00.000Z' } }))

  await expect(setNote(store, item, 'goal', 0, 'Too late')).rejects.toThrow(new Moved('"Exhaustive match needs no default" was answered while you wrote the note.'))
  await expect(dropNote(store, item, 'p0', 0)).rejects.toThrow(Moved)
  await expect(setNote(withdrawn.store, withdrawn.item, 'why', 0, 'Too late')).rejects.toThrow(new Moved('"Do we want courses?" was withdrawn while you wrote the note.'))
  expect((await readPerson(store)).person[item.id]).toEqual(answered)
})

test('a note written on a revision the item moved past is refused as moved, and the person file stays as it was', async () => {
  const { disk, store, item } = await filed(proposal)
  await updateItem(store, item.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, { ...origin, content: { ...proposal, goal: 'Enums ship with no boilerplate' }, at: '2026-10-22T11:00:00.000Z' }] }))

  await expect(setNote(store, item, 'goal', 0, 'Say it in one line')).rejects.toThrow(new Moved('"Exhaustive match needs no default" was revised while you wrote the note. Read the new revision, then write it again.'))
  expect(await disk.exists(personPath(store, item.id))).toBe(false)
})

test('reading an item marks the revision the person saw, a second read writes nothing, and Next → also puts it behind the rest of the queue', async () => {
  const { disk, store, item } = await filed(proposal)

  expect((await markRead(store, item, 0)).lastRead).toBe(0)
  disk.writes.length = 0
  expect((await markRead(store, item, 0)).lastRead).toBe(0)
  expect(disk.writes).toEqual([])
  try {
    setSystemTime(new Date('2026-10-23T09:00:00.000Z'))
    expect(await skip(store, item, 0)).toEqual(expect.objectContaining({ lastRead: 0, queuedAt: '2026-10-23T09:00:00.000Z' }))
  } finally {
    setSystemTime()
  }
})

test('each conversion writes a person file for an old item that has none, writes the item as Markdown at the current format, and adds an answer an old build wrote after an earlier conversion', async () => {
  const disk = memoryDisk()
  const store = storeIn('/data', disk)
  const remove = async (path: string) => disk.remove(path)
  const first = { kind: 'approve', revision: 0, by: 'person', at: '2026-10-22T10:10:00.000Z' }
  const stored = { ...itemOf(proposal, 'match'), format: 5, status: 'answered', lastRead: 0, queuedAt: '2026-10-22T10:05:00.000Z', answers: [first] }
  await disk.write('/data/items/match.json', JSON.stringify(stored))
  const notes = { match: [note('', 'Ship it')] }

  expect(await convertJsonFiles(store, notes, remove)).toEqual({ converted: 1, skipped: [] })
  expect(parsePerson('match', await disk.read(personPath(store, 'match')))).toEqual({ notes: [note('', 'Ship it')], answers: [{ kind: 'approve', revision: 0, at: '2026-10-22T10:10:00.000Z' }], lastRead: 0, queuedAt: '2026-10-22T10:05:00.000Z' })
  const [rewritten] = (await readItems(store)).items
  expect([rewritten?.format, rewritten?.updatedAt]).toEqual([format, stored.updatedAt])
  expect(await disk.exists('/data/items/match.json')).toBe(false)
  expect((await disk.read(store.changed)).endsWith(' match\n')).toBe(true)
  expect(await convertJsonFiles(store, notes, remove)).toEqual({ converted: 0, skipped: [] })

  const later = { kind: 'reject', words: 'Not now', revision: 0, by: 'person', at: '2026-10-22T11:00:00.000Z' }
  await disk.write('/data/items/match.json', JSON.stringify({ ...stored, answers: [first, later] }))
  expect(await convertJsonFiles(store, notes, remove)).toEqual({ converted: 1, skipped: [] })
  expect(parsePerson('match', await disk.read(personPath(store, 'match'))).answers.map((each) => each.at)).toEqual([first.at, later.at])

  const [item] = (await readItems(store)).items
  const person = (await readPerson(store)).person['match']
  expect(item === undefined || person === undefined ? 'missing' : statusOf(item, person)).toBe('answered')
})

test('the footer offers each kind its answers, counts the notes, and shows Comment and Next → only when the view can use them', () => {
  const options: Content = { kind: 'options', title: 'Pick', goal: 'Enums ship', problem: { title: 'Defaults', ideas: [{ idea: 'Dead code.' }] }, options: Array.from({ length: 10 }, (_, index) => ({ title: `Option ${index + 1}`, ideas: [] })) }
  const report: Content = { kind: 'report', title: 'The inbox ships', goal: 'One inbox', changes: [] }
  const comment = ['comment', 'Comment', 'm', false]
  const next = ['next', 'Next →', 'n', false]
  const offered = itemOf(proposal, 'p')

  expect(rows(offered, nobody(offered))).toEqual([['approve', 'Approve', 'a', true], ['reject', 'Reject', 'x', false], comment, next])
  expect(rows(offered, nobody(offered), false, true)).toEqual([['approve', 'Approve', 'a', true], ['reject', 'Reject', 'x', false]])
  expect(rows(offered, withNotes(offered, [note('p0', 'Name it'), note('', 'Ship it')]))).toEqual([['request', 'Request changes (2)', 'r', true], ['approve', 'Approve with 2 notes', 'a', false], ['reject', 'Reject with 2 notes', 'x', false], next])
  expect(rows(offered, withNotes(offered, [note('', 'Written on revision 1', 1)]))).toContainEqual(comment)
  expect(rows(itemOf(report, 'r'), nobody(itemOf(report, 'r')))).toEqual([['done', 'Done', 'd', true], comment, next])
  expect(rows(itemOf(question, 'q'), nobody(itemOf(question, 'q')))).toEqual([['answer', 'Answer', 'a', true], ['reject', 'Reject', 'x', false], comment, next])

  const picks = actionsOf(itemOf(options, 'o'), nobody(itemOf(options, 'o')), { hasNext: true, isCommenting: false })
  expect(picks.slice(0, 2).map(({ id, label, hotkey, does }) => [id, label, hotkey, does])).toEqual([
    ['option0', 'Pick option 1', '1', { kind: 'option', option: 'Option 1' }],
    ['option1', 'Pick option 2', '2', { kind: 'option', option: 'Option 2' }],
  ])
  expect(picks[9]?.hotkey).toBeUndefined()
  expect(picks.slice(10).map(({ id }) => id)).toEqual(['reject', 'comment', 'next'])
})

test('a part folds by where it sits, and after a revision only the changed parts open', () => {
  const revised: Revised = { changed: new Set(['p1', 'p1.i0']), removed: new Map(), was: new Map() }

  expect(foldKey(itemOf(proposal, 'match'), 'p0.s')).toBe('match:0:p0.s')
  expect(['p0', 'p0.s', 'p0.s.i0.d', 'problem', 'c0.e'].map(folds)).toEqual([true, false, true, true, true])
  expect(['p0', 'p0.p1', 'c0.e'].map((path) => opensAt(unrevised, path))).toEqual([true, false, false])
  expect([isChanged(revised, 'p1'), isUnchanged(revised, 'p0'), isUnchanged(unrevised, 'p0')]).toEqual([true, true, false])
  expect(['p0', 'p1', 'p1.i0.d', 'p1.i1.d'].map((path) => opensAt(revised, path))).toEqual([false, true, true, false])
})

test("a folded Problem's summary names its Solution and counts the ideas and drawings under it", () => {
  const [problem] = rootsOf(proposal)

  expect(problem === undefined ? '' : summaryOf(problem)).toBe('Solution 1 · No default · 2 ideas, 1 drawing')
})

test('a Diff or Data drawing is unified diff text, and its counts and stats are the same for every view', () => {
  const diff: CodeDiff = { kind: 'diff', path: 'src/match.ts', old: '  return guess(expr)', new: '  return infer(expr)', startLine: 2, before: ['export function check(expr: Expr): Type {'], after: ['}'] }
  const hunk = ['@@ -1,3 +1,3 @@', ' export function check(expr: Expr): Type {', '-  return guess(expr)', '+  return infer(expr)', ' }'].join('\n')

  expect(diffOf(diff)).toBe(hunk)
  expect(diffOf({ kind: 'table', table: 'matches', columns: [{ name: 'id', type: 'bigint' }, { name: 'cases', type: 'jsonb', change: 'edit', was: 'text', note: 'one per case' }] })).toBe(
    ['@@ -1,4 +1,4 @@', ' type Fields = {', '   id: bigint', '-  cases: text', '+  cases: jsonb  // one per case', ' }'].join('\n'),
  )
  expect(statsOf([hunk, '+a\n-b\n+c'])).toEqual({ added: 3, removed: 2 })
  expect(changeCounts(['add', 'remove', undefined, 'add'])).toEqual([
    { change: 'add', count: 2 },
    { change: 'remove', count: 1 },
  ])
  expect([kindOf(diff), drawingLabel(diff)]).toEqual(['Diff', 'Diff: src/match.ts:2'])
  expect([diagramKindOf({ kind: 'diagram', mermaid: 'sequenceDiagram\n  A->>B: hi', drawn: '' }), diagramKindOf({ kind: 'diagram', mermaid: 'pie', drawn: '' })]).toEqual(['sequence', 'diagram'])
})

test('a files drawing draws the show-me tree: a + or - marker before the glyphs, a * on an edited file, and each note after <- in one column', () => {
  const rows = treeOf({
    kind: 'files',
    files: [
      { path: 'src/components/chip.tsx', change: 'add', note: 'one chip for labels and badges' },
      { path: 'src/components/item.tsx', change: 'edit', note: 'the card, labels, and folds' },
      { path: 'src/pages/inbox.tsx', change: 'edit', note: 'closed cards and scope chips' },
      { path: 'src/old.ts', change: 'remove', note: 'nothing reads it' },
      { path: 'skills/proposals/SKILL.md', change: 'edit', note: '' },
    ],
  })

  expect(rows.map((row) => `${row.mark} ${row.line}`)).toEqual([
    '  src/',
    '  ├── components/',
    '+ │   ├── chip.tsx    <- one chip for labels and badges',
    '  │   └── item.tsx*   <- the card, labels, and folds',
    '  ├── pages/',
    '  │   └── inbox.tsx*  <- closed cards and scope chips',
    '- └── old.ts          <- nothing reads it',
    '  skills/proposals/',
    '  └── SKILL.md*',
  ])
  expect(rows.filter((row) => row.path !== undefined).map((row) => row.path)).toEqual(['src/components/chip.tsx', 'src/components/item.tsx', 'src/pages/inbox.tsx', 'src/old.ts', 'skills/proposals/SKILL.md'])
})

test('an api drawing draws the file with its declarations under it, a changed one as its old line marked - and its new line marked +', () => {
  const rows = treeOf({
    kind: 'api',
    path: 'src/components/drawing.tsx',
    declarations: [
      { name: 'OpenFile', header: 'export type OpenFile = (path: string, diff?: string) => Promise<void>', line: 12 },
      { name: 'DrawingView', header: 'export function DrawingView({ drawing, keyPrefix }): RenderElement {', line: 192 },
    ],
    changes: [
      { name: 'DrawingView', change: 'edit', signature: 'DrawingView({ drawing, keyPrefix, onFile }): RenderElement', note: 'opens the file a drawing names' },
      { name: 'kindOf', change: 'add', signature: 'kindOf(drawing: Drawing): string', note: 'names each drawing kind' },
    ],
  })

  expect(rows.map((row) => `${row.mark} ${row.line}`)).toEqual([
    '  src/components/drawing.tsx*',
    '  ├── type OpenFile = (path: string, diff?: string) => Promise<void>',
    '- ├── DrawingView({ drawing, keyPrefix }): RenderElement',
    '+ ├── DrawingView({ drawing, keyPrefix, onFile }): RenderElement  <- opens the file a drawing names',
    '+ └── kindOf(drawing: Drawing): string                            <- names each drawing kind',
  ])
})

test('two answers stored in one millisecond are both unheard, and the mark counts each one it hears at that time', () => {
  const item = itemOf(question, 'courses')
  const at = '2026-11-01T00:00:00.000Z'
  const person: Person = { ...nobody(item), answers: [{ kind: 'correct', corrections: [], revision: 0, at }, { kind: 'answer', words: 'Yes', revision: 0, at }] }
  const start = '2026-10-01T00:00:00.000Z'
  const [first, second] = unheard(item, person, origin.session, marksIn({}, 'courses', start), {})
  const once = first === undefined ? {} : advanced({}, 'courses', first, start)
  const twice = second === undefined ? once : advanced(once, 'courses', second, start)

  expect([first, second].map((each) => each?.text.endsWith('answer 2: "Yes"'))).toEqual([false, true])
  expect(unheard(item, person, origin.session, marksIn(once, 'courses', start), {}).map((each) => each.text)).toEqual(['Inbox: the user answered "Do we want courses?" (courses), answer 2: "Yes"'])
  expect(unheard(item, person, origin.session, marksIn(twice, 'courses', start), {})).toEqual([])
  expect(unheard(item, person, 'bystander', marksIn({}, 'courses', start), {})).toEqual([])
})

test('a project counts as the repository git names for it, or as itself when git names none or cannot run, which is logged', async () => {
  const asked: (readonly string[])[] = []
  const logs: string[] = []
  const log = (line: string) => void logs.push(line)
  const git = (exitCode: number, stdout: string): Run => async (argv) => {
    asked.push(argv)
    return { exitCode, stdout }
  }

  expect(await repositoryOf(git(0, '/work/.git\n'), '/work/worktrees/design', log)).toBe('/work/.git')
  expect(await repositoryOf(git(128, ''), '/scratch', log)).toBe('/scratch')
  expect(asked[0]).toEqual(['git', '-C', '/work/worktrees/design', 'rev-parse', '--path-format=absolute', '--git-common-dir'])
  expect(logs).toEqual([])
  expect(await repositoryOf(() => Promise.reject(new Error('git is not installed')), '/scratch', log)).toBe('/scratch')
  expect(logs).toEqual(['git could not name the repository of /scratch, so its items count as their own project: git is not installed'])
})

test('an item says how long ago it changed in minutes, then hours, then days', () => {
  const now = Date.parse('2026-10-22T10:00:00.000Z')

  expect(['2026-10-22T09:15:00.000Z', '2026-10-22T07:00:00.000Z', '2026-10-19T10:00:00.000Z'].map((at) => ago(at, now))).toEqual(['45m ago', '3h ago', '3d ago'])
})
