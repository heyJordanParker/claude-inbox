import { afterEach, expect, jest, setSystemTime, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import { setNote } from '../../src/items/answers.js'
import { format } from '../../src/items/formats.js'
import type { Content, Item, Person, PersonFiles, Senders } from '../../src/items/item.js'
import { parsePerson } from '../../src/items/markdown.js'
import { createItem, itemPath, personPath, storeIn, updateItem, type Changed, type Disk, type Store } from '../../src/items/store.js'
import plugin from '../../.claude-plugin/plugin.json'
import { buildApp, built } from '../build.ts'
import { disk } from '../src/disk.js'
import type { Listed } from '../src/app/api.js'
import type { Serving } from '../src/server.js'

await buildApp()

const { serve } = await import('../src/server.js')

const token = 'test-token-that-only-this-test-knows'

const main = new URL('../src/main.ts', import.meta.url).pathname

const origin = { session: 'planner' }

const proposal: Content = {
  kind: 'proposal',
  title: 'Exhaustive match needs no default',
  goal: 'Enums ship without boilerplate defaults',
  problems: [
    {
      title: 'A full match still demands a default',
      ideas: [{ idea: 'Users write a default the compiler could prove unreachable.' }],
      solution: {
        title: 'No default',
        ideas: [
          { idea: 'The checker learns exhaustiveness.', drawing: { kind: 'files', files: [{ path: 'src/match.ts', change: 'edit', note: 'learns exhaustiveness' }] } },
          { idea: 'A drawing may name a file outside the project.', drawing: { kind: 'files', files: [{ path: '../secret.txt', change: 'edit', note: 'outside' }, { path: 'src/escape.ts', change: 'edit', note: 'a link out' }] } },
        ],
      },
    },
  ],
}

const cleanups: (() => Promise<void> | void)[] = []

afterEach(async () => {
  setSystemTime()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function folder(): string {
  const made = mkdtempSync(join(tmpdir(), 'inbox-server-test-'))
  cleanups.push(() => rmSync(made, { recursive: true, force: true }))
  return made
}

function itemOf(content: Content, project: string, id: string): Item {
  return { format, id, kind: content.kind, project, origin, subscribers: [{ ...origin, since: '2026-10-22T10:00:00.000Z' }], revisions: [{ ...origin, content, at: '2026-10-22T10:00:00.000Z' }], updatedAt: '2026-10-22T10:00:00.000Z' }
}

let titles: Senders = { planner: { title: 'schema planning', color: 'purple' } }

async function started({ senders = async () => titles, served = disk }: { readonly senders?: () => Promise<Senders>; readonly served?: Disk } = {}) {
  const root = folder()
  const project = join(root, 'project')
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, 'src/match.ts'), 'export function check(expr: Expr): Type {}\n')
  writeFileSync(join(project, 'src/other.ts'), 'export const unnamed = true\n')
  writeFileSync(join(root, 'secret.txt'), 'outside the project\n')
  symlinkSync(join(root, 'secret.txt'), join(project, 'src/escape.ts'))
  const store = storeIn(join(root, 'data'), disk)
  const item = await createItem(store, proposal.title, (id) => itemOf(proposal, project, id))
  const serving: Serving = await serve({ store: storeIn(store.folder, served), port: 0, token, senders, repositoryOf: async (each) => `${each}/.git` })
  cleanups.push(() => serving.stop())
  const address = `127.0.0.1:${serving.port}`
  const call = (path: string, init: { readonly method?: string; readonly body?: unknown; readonly headers?: Record<string, string> } = {}) =>
    fetch(`http://${address}${path}`, { method: init.method ?? 'GET', headers: { authorization: `Bearer ${token}`, ...init.headers }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) })
  return { project, store, item, address, call }
}

function personFile(store: Store, id: string): Person {
  return parsePerson(id, readFileSync(personPath(store, id), 'utf8'))
}

async function watched(call: (path: string) => Promise<Response>) {
  const reader = (await call('/api/events')).body?.pipeThrough(new TextDecoderStream()).getReader()
  cleanups.push(() => reader?.cancel())
  let seen = ''
  return async (words: string) => {
    while (!seen.includes(words)) {
      const read = await reader?.read()
      if (read === undefined || read.done) throw new Error(`The event stream closed before it said ${words}. It said: ${seen}`)
      seen += read.value
    }
  }
}

async function firstFrame(response: Response): Promise<[string, Listed]> {
  const reader = (response.body ?? new ReadableStream()).pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  while (!text.includes('\n\n')) {
    const read = await reader.read()
    if (read.done) throw new Error(`The event stream closed before its first frame. It said: ${text}`)
    text += read.value
  }
  await reader.cancel()
  const lines = text.slice(0, text.indexOf('\n\n')).split('\n')
  return [lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? '', JSON.parse(lines.find((line) => line.startsWith('data: '))?.slice('data: '.length) ?? 'null') as Listed]
}

async function firstLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  let text = ''
  while (!text.includes('\n')) {
    const { value, done } = await reader.read()
    if (done) break
    text += new TextDecoder().decode(value)
  }
  reader.releaseLock()
  return text.split('\n')[0] ?? ''
}

async function program(data: string) {
  const child = Bun.spawn([process.execPath, main, 'serve', '--data', data], { stdout: 'pipe', stderr: 'pipe' })
  cleanups.push(async () => {
    child.kill()
    await child.exited
  })
  return { child, address: await firstLine(child.stdout) }
}

test('a request whose Host is not 127.0.0.1:<port> is refused, the shell included, which blocks DNS rebinding', async () => {
  const { address, call } = await started()

  const shell = await call('/', { headers: { host: `evil.example:${address.split(':')[1]}` } })
  const listed = await call('/api/events', { headers: { host: 'localhost' } })

  expect(shell.status).toBe(403)
  expect(listed.status).toBe(403)
  expect(await listed.json()).toEqual({ error: `This server answers only requests to ${address}.` })
})

test('a request from a foreign Origin is refused, and trading a code needs the inbox Origin', async () => {
  const { address, call } = await started()
  const { code } = (await (await call('/api/codes', { method: 'POST' })).json()) as { code: string }

  const foreign = await call('/api/events', { headers: { origin: 'http://evil.example' } })
  const bare = await call('/api/tokens', { method: 'POST', body: { code } })
  const traded = await call('/api/tokens', { method: 'POST', body: { code }, headers: { origin: `http://${address}` } })

  expect(foreign.status).toBe(403)
  expect(bare.status).toBe(403)
  expect(await bare.json()).toEqual({ error: 'Trading a code for the token needs the Origin header.' })
  expect(traded.status).toBe(200)
})

test('every /api request but /api/tokens needs the token, and the server sends no CORS headers', async () => {
  const { call } = await started()

  const missing = await Promise.all(['/api/events', '/api/items/exhaustive-match-needs-no-default/file?path=src/match.ts'].map((path) => call(path, { headers: { authorization: '' } })))
  const minted = await call('/api/codes', { method: 'POST', headers: { authorization: 'Bearer wrong-token' } })
  const allowed = await call('/api/items/exhaustive-match-needs-no-default/file?path=src/match.ts')

  expect(missing.map((response) => response.status)).toEqual([401, 401])
  expect(minted.status).toBe(401)
  expect(allowed.status).toBe(200)
  expect([...allowed.headers.keys()].filter((name) => name.startsWith('access-control-'))).toEqual([])
})

test('a code trades for the token once, and only within 60 seconds of its minting', async () => {
  const { address, call } = await started()
  const trade = (code: string) => call('/api/tokens', { method: 'POST', body: { code }, headers: { origin: `http://${address}`, authorization: '' } })
  const mint = async () => ((await (await call('/api/codes', { method: 'POST' })).json()) as { code: string }).code

  const first = await mint()
  const traded = await trade(first)
  const reused = await trade(first)
  const late = await mint()
  setSystemTime(new Date(Date.now() + 60_001))
  const expired = await trade(late)

  expect(traded.status).toBe(200)
  expect(await traded.json()).toEqual({ token })
  expect(reused.status).toBe(403)
  expect(expired.status).toBe(403)
  expect(await expired.json()).toEqual({ error: 'This link was already used or has expired. Open the item again from the terminal.' })
})

test('one guarded handler serves the built shell at / and /items/:id, its script, and its styles without the token, under the contract CSP', async () => {
  const { call } = await started()
  const csp = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"

  const served = await Promise.all(['/', '/items/exhaustive-match-needs-no-default', '/app.js', '/app.css', '/chunk-unknown.js'].map((path) => call(path, { headers: { authorization: '' } })))
  const bodies = await Promise.all(served.map((response) => response.text()))

  expect(served.map((response) => [response.status, response.headers.get('content-type'), response.headers.get('content-security-policy')])).toEqual([
    [200, 'text/html;charset=utf-8', csp],
    [200, 'text/html;charset=utf-8', csp],
    [200, 'text/javascript;charset=utf-8', csp],
    [200, 'text/css;charset=utf-8', csp],
    [404, 'application/json;charset=utf-8', csp],
  ])
  expect(bodies.slice(0, 4)).toEqual([readFileSync(join(built, 'shell.txt'), 'utf8'), readFileSync(join(built, 'shell.txt'), 'utf8'), readFileSync(join(built, 'script.txt'), 'utf8'), readFileSync(join(built, 'style.txt'), 'utf8')])
  expect(bodies[0]).toContain('<script type="module" src="/app.js"></script>')
})

test("the stream's first frame lists every item, every person file, the repository of each project and of the asked one, and the build its shell names", async () => {
  const { project, store, item, call } = await started()
  const heard = await watched(call)
  await setNote(store, item, '', 0, 'Looks right')
  await heard('Looks right')

  const [name, listed] = await firstFrame(await call('/api/events?project=/elsewhere'))
  const shell = await (await call('/')).text()

  expect(name).toBe('listed')
  expect(listed.items.map((each) => each.id)).toEqual([item.id])
  expect(listed.person[item.id]?.notes.map((note) => note.words)).toEqual(['Looks right'])
  expect(listed.repositories).toEqual({ [project]: `${project}/.git`, '/elsewhere': '/elsewhere/.git' })
  expect(listed.build).toMatch(/^[0-9a-f]{64}$/)
  expect(shell).toContain(`<meta name="inbox-build" content="${listed.build}" />`)
})

test("every frame names each item's sessions by the title cmod lists now, and a rename reaches the tabs on the 30 second reread", async () => {
  jest.useFakeTimers()
  cleanups.push(() => {
    jest.useRealTimers()
    titles = { planner: { title: 'schema planning', color: 'purple' } }
  })
  const { call } = await started()
  const heard = await watched(call)
  await heard('"senders":{"planner":{"title":"schema planning","color":"purple"}}')

  titles = { planner: { title: 'billing planning', color: 'green' } }
  jest.advanceTimersByTime(30_000)
  jest.useRealTimers()

  await heard('event: changed\ndata: {"items":[],"person":{},"gone":{"items":[],"person":[]},"senders":{"planner":{"title":"billing planning","color":"green"}}}')
  await new Promise((resolve) => setTimeout(resolve, 100))
})

test('every frame says whether each session runs, so a session that stops moves its items to the Archive in the tabs on the 30 second reread', async () => {
  jest.useFakeTimers()
  cleanups.push(() => {
    jest.useRealTimers()
    titles = { planner: { title: 'schema planning', color: 'purple' } }
  })
  titles = { planner: { title: 'schema planning', color: 'purple', isRunning: true } }
  const { call } = await started()
  const heard = await watched(call)
  await heard('"senders":{"planner":{"title":"schema planning","color":"purple","isRunning":true}}')

  titles = { planner: { title: 'schema planning', color: 'purple', isRunning: false } }
  jest.advanceTimersByTime(30_000)
  jest.useRealTimers()

  await heard('event: changed\ndata: {"items":[],"person":{},"gone":{"items":[],"person":[]},"senders":{"planner":{"title":"schema planning","color":"purple","isRunning":false}}}')
  await new Promise((resolve) => setTimeout(resolve, 100))
})

test('GET /api/items is no route, since the stream carries the listing', async () => {
  const { call } = await started()

  expect((await call('/api/items')).status).toBe(404)
})

test('an Approve through the API stores the answer core.answer stores, with the notes, and says a running session follows the item', async () => {
  const { store, item, call } = await started()
  await setNote(store, item, '', 0, 'Ship it')

  const approved = await call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 0, kind: 'approve' } })
  const body = (await approved.json()) as { person: Person; isFollowed: boolean }
  const again = await call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 0, kind: 'approve' } })

  expect(approved.status).toBe(200)
  expect(Object.keys(body).sort()).toEqual(['isFollowed', 'person'])
  expect(body.isFollowed).toBe(true)
  expect(personFile(store, item.id)).toEqual(body.person)
  expect(body.person.answers.map(({ kind, revision, corrections }) => ({ kind, revision, corrections }))).toEqual([{ kind: 'approve', revision: 0, corrections: [{ path: '', target: 'the whole item', words: 'Ship it', revision: 0 }] }])
  expect([body.person.notes, body.person.lastRead]).toEqual([[], 0])
  expect(again.status).toBe(409)
  expect(await again.json()).toEqual({ error: `"${proposal.title}" was answered while you read it.` })
})

test('an answer says no running session follows the item when the sessions the tabs read say its subscribers all stopped, and a bad body or stale revision is refused', async () => {
  const { item, call } = await started({ senders: async () => ({ planner: { title: 'schema planning', isRunning: false } }) })
  await (await watched(call))('"isRunning":false')

  const stale = await call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 3, kind: 'approve' } })
  const unknown = await call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 0, kind: 'shrug' } })
  const missing = await call('/api/items/no-such-item/answer', { method: 'POST', body: { seen: 0, kind: 'approve' } })
  const rejected = (await (await call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 0, kind: 'reject', words: 'Not now' } })).json()) as { person: Person; isFollowed: boolean }

  expect(stale.status).toBe(409)
  expect([unknown.status, await unknown.json()]).toEqual([400, { error: `"${proposal.title}" does not offer shrug.` }])
  expect(missing.status).toBe(404)
  expect([rejected.isFollowed, rejected.person.answers[0]?.kind, rejected.person.answers[0]?.words]).toEqual([false, 'reject', 'Not now'])
})

test('two answers posted at once store one answer, and the second is refused as moved', async () => {
  const { store, item, call } = await started()

  const both = await Promise.all([1, 2].map(() => call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 0, kind: 'reject' } })))

  expect(both.map((each) => each.status).sort()).toEqual([200, 409])
  expect(personFile(store, item.id).answers.map((each) => each.kind)).toEqual(['reject'])
})

test('Request changes with no note, and an answer the item does not offer, are refused with 400 and their own message', async () => {
  const { store, item, call } = await started()

  const unnoted = await call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 0, kind: 'correct' } })
  const unoffered = await call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 0, kind: 'answer', words: 'Yes' } })

  expect([unnoted.status, await unnoted.json()]).toEqual([400, { error: 'Write a note before you request changes.' }])
  expect([unoffered.status, await unoffered.json()]).toEqual([400, { error: `"${proposal.title}" does not offer answer.` }])
  expect(statSync(personPath(store, item.id), { throwIfNoEntry: false })).toBeUndefined()
})

test('an answer is recorded and warns of no stopped session when cmod cannot list the sessions, so the tab never shows an error for an answer it recorded', async () => {
  const { store, item, call } = await started({ senders: () => Promise.reject(new Error('cmod history sessions failed')) })

  const approved = await call(`/api/items/${item.id}/answer`, { method: 'POST', body: { seen: 0, kind: 'approve' } })
  const body = (await approved.json()) as { person: Person; isFollowed: boolean }

  expect([approved.status, body.isFollowed]).toEqual([200, true])
  expect(personFile(store, item.id).answers.map((each) => each.kind)).toEqual(['approve'])
})

test('PUT notes stores a note on the revision the person saw, refuses one the item moved past, and DELETE drops a note on an earlier revision, again with no error', async () => {
  const { store, item, call } = await started()

  const set = (await (await call(`/api/items/${item.id}/notes`, { method: 'PUT', body: { path: 'p0', revision: 0, words: 'Name the default case' } })).json()) as { person: Person }
  const emptied = (await (await call(`/api/items/${item.id}/notes`, { method: 'PUT', body: { path: 'p0', revision: 0, words: '' } })).json()) as { person: Person }
  const unnumbered = await call(`/api/items/${item.id}/notes`, { method: 'PUT', body: { path: 'p0', words: 'No revision' } })
  await call(`/api/items/${item.id}/notes`, { method: 'PUT', body: { path: '', revision: 0, words: 'Written on revision 0' } })
  const revised = await updateItem(store, item.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, { ...origin, content: proposal, at: '2026-10-22T11:00:00.000Z' }] }))
  const moved = await call(`/api/items/${item.id}/notes`, { method: 'PUT', body: { path: '', revision: 0, words: 'Written after the revise' } })
  const dropped = await call(`/api/items/${item.id}/notes`, { method: 'DELETE', body: { path: '', revision: 0 } })
  const absent = await call(`/api/items/${item.id}/notes`, { method: 'DELETE', body: { path: '', revision: 0 } })

  expect(set.person.notes).toEqual([{ path: 'p0', revision: 0, target: 'Problem 1: A full match still demands a default', words: 'Name the default case' }])
  expect(emptied.person.notes).toEqual([])
  expect(unnumbered.status).toBe(400)
  expect(revised.revisions.length).toBe(2)
  expect([moved.status, await moved.json()]).toEqual([409, { error: `"${proposal.title}" was revised while you wrote the note. Read the new revision, then write it again.` }])
  expect(dropped.status).toBe(200)
  expect(personFile(store, item.id).notes).toEqual([])
  expect(absent.status).toBe(200)
})

test('read marks the revision the person saw, even after the item moved past it, and never lowers what the person read', async () => {
  const { store, item, call } = await started()
  const read = (seen: number) => call(`/api/items/${item.id}/read`, { method: 'POST', body: { seen } })

  await updateItem(store, item.id, (fresh) => ({ ...fresh, revisions: [...fresh.revisions, { ...origin, content: proposal, at: '2026-10-22T11:00:00.000Z' }] }))
  const older = await read(0)
  const olderLastRead = personFile(store, item.id).lastRead
  await read(1)
  const lowered = await read(0)

  expect([older.status, olderLastRead]).toEqual([200, 0])
  expect([lowered.status, personFile(store, item.id).lastRead]).toEqual([200, 1])
})

test('a tab that opens three streams and reads one revision twice gets one changed event, the first read, since the second changes nothing', async () => {
  const { store, item, call } = await started()
  await setNote(store, item, '', 0, 'Written before the tab opened')
  await new Promise((resolve) => setTimeout(resolve, 700))
  const watching = (await call('/api/events')).body?.pipeThrough(new TextDecoderStream()).getReader()
  let text = ''
  const reading = (async () => {
    for (;;) {
      const read = await watching?.read()
      if (read === undefined || read.done) return
      text += read.value
    }
  })()

  for (const _ of [1, 2, 3]) await firstFrame(await call('/api/events'))
  await (await call(`/api/items/${item.id}/read`, { method: 'POST', body: { seen: 0 } })).text()
  await (await call(`/api/items/${item.id}/read`, { method: 'POST', body: { seen: 0 } })).text()
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await watching?.cancel()
  await reading

  const events = text.split('event: changed\ndata: ').slice(1).map((frame) => JSON.parse(frame.split('\n')[0] ?? 'null') as Changed)
  expect(events.map((each) => each.person[item.id]?.lastRead)).toEqual([0])
})

test('skip marks the seen revision read and moves the item behind the queue, as core.skip does', async () => {
  const { store, item, call } = await started()
  setSystemTime(new Date('2026-11-03T09:00:00.000Z'))

  const skipped = (await (await call(`/api/items/${item.id}/skip`, { method: 'POST', body: { seen: 0 } })).json()) as { person: Person }

  expect([skipped.person.lastRead, skipped.person.queuedAt]).toEqual([0, '2026-11-03T09:00:00.000Z'])
  expect(personFile(store, item.id)).toEqual(skipped.person)
})

test('the file route serves only a path a drawing names, and only inside the item project', async () => {
  const { item, call } = await started()
  const file = (path: string) => call(`/api/items/${item.id}/file?path=${encodeURIComponent(path)}`)

  const named = await file('src/match.ts')
  const unnamed = await file('src/other.ts')
  const outside = await file('../secret.txt')
  const linkedOut = await file('src/escape.ts')

  expect([named.status, await named.text()]).toEqual([200, 'export function check(expr: Expr): Type {}\n'])
  expect(unnamed.status).toBe(403)
  expect(outside.status).toBe(403)
  expect(linkedOut.status).toBe(403)
})

test('the event stream sends one changed event with the person file within a second of a note, and with the item within a second of a filing', async () => {
  const { store, item, project, call } = await started()
  const stream = await call('/api/events')
  const reader = (stream.body ?? new ReadableStream()).getReader()
  let buffered = ''
  const nextEvent = async () => {
    for (;;) {
      const end = buffered.indexOf('\n\n')
      if (end !== -1) {
        const frame = buffered.slice(0, end)
        buffered = buffered.slice(end + 2)
        if (frame.startsWith(':')) continue
        const [event, data] = frame.split('\n')
        return { event, data: JSON.parse(data?.slice('data: '.length) ?? 'null') as Changed }
      }
      const { value } = await reader.read()
      buffered += new TextDecoder().decode(value)
    }
  }

  const onOpen = await nextEvent()
  const noted = Date.now()
  await setNote(store, item, '', 0, 'Looks right')
  const onNote = await nextEvent()
  const noteMs = Date.now() - noted
  const filedAt = Date.now()
  const other = await createItem(store, 'Do we want courses?', (id) => itemOf({ kind: 'question', title: 'Do we want courses?', why: 'It decides the schema' }, project, id))
  const onFiling = await nextEvent()
  const filingMs = Date.now() - filedAt
  await reader.cancel()

  expect(stream.headers.get('content-type')).toBe('text/event-stream')
  expect(onOpen.event).toBe('event: listed')
  expect([onNote.event, onNote.data.items.map((each) => each.id), onNote.data.person[item.id]?.notes.map((note) => note.words)]).toEqual(['event: changed', [item.id], ['Looks right']])
  expect([onFiling.event, onFiling.data.items.map((each) => each.id), onFiling.data.person]).toEqual(['event: changed', [other.id], {}])
  expect(noteMs).toBeLessThan(1000)
  expect(filingMs).toBeLessThan(1000)
})

test('a tab hears the listing first and then each change on one connection, and a resync opens a new stream with a fresh listing', async () => {
  const { store, item, address } = await started()
  const realFetch = globalThis.fetch
  const opened: string[] = []
  globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/events')) opened.push(input)
    return realFetch(typeof input === 'string' && input.startsWith('/') ? `http://${address}${input}` : input, init)
  }, realFetch)
  Object.assign(globalThis, { localStorage: { getItem: () => token, setItem: () => undefined } })
  cleanups.push(() => {
    globalThis.fetch = realFetch
    Reflect.deleteProperty(globalThis, 'localStorage')
  })
  const { follow } = await import('../src/app/api.js')
  const heard: string[] = []
  const following = follow('/elsewhere', {
    onListed: (listed) => heard.push(`listed ${Object.keys(listed.person).length} person files`),
    onChanged: (changed) => heard.push(`changed ${changed.person[item.id]?.notes.map((note) => note.words).join() ?? ''}`),
    onConnection: () => undefined,
    onSignedOut: () => undefined,
  })
  cleanups.push(() => following.stop())
  const until = async (count: number) => {
    for (let waited = 0; heard.length < count && waited < 3000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20))
  }

  await until(1)
  await setNote(store, item, '', 0, 'Written once the stream opened')
  await until(2)
  following.resync()
  await until(3)

  expect(heard).toEqual(['listed 0 person files', 'changed Written once the stream opened', 'listed 1 person files'])
  expect(opened).toEqual(['/api/events?project=%2Felsewhere', '/api/events?project=%2Felsewhere'])
})

test('the event stream names an item file and a person file that were deleted, so a tab drops them', async () => {
  const { store, item, call } = await started()
  await setNote(store, item, '', 0, 'Looks right')
  const heard = await watched(call)
  await heard('Looks right')

  rmSync(personPath(store, item.id))
  rmSync(itemPath(store, item.id))
  writeFileSync(store.changed, `${new Date().toISOString()} ${item.id}\n`)
  await heard(`"gone":{"items":["${item.id}"],"person":["${item.id}"]}`)
})

test('a reread that fails is tried again on the next poll, so the change still reaches the tab', async () => {
  let isFailing = false
  const failingOnce: Disk = {
    ...disk,
    list: async (path) => {
      if (!isFailing) return disk.list(path)
      isFailing = false
      throw new Error('The disk did not answer')
    },
  }
  const { store, item, call } = await started({ served: failingOnce })
  const heard = await watched(call)
  await heard('event: listed')

  isFailing = true
  await setNote(store, item, '', 0, 'Written while a reread failed')

  await heard('Written while a reread failed')
})

test('the server rereads every 30 seconds, so a deleted file reaches the tab although nothing wrote changed', async () => {
  jest.useFakeTimers()
  cleanups.push(() => void jest.useRealTimers())
  const { store, item, call } = await started()
  const heard = await watched(call)
  await heard('event: listed')

  rmSync(itemPath(store, item.id))
  jest.advanceTimersByTime(30_000)
  jest.useRealTimers()

  await heard(`"gone":{"items":["${item.id}"],"person":[]}`)
  await new Promise((resolve) => setTimeout(resolve, 100))
})

test('a tab that closed its event stream never stops the change reaching another open tab', async () => {
  const { store, item, address, call } = await started()
  const closing = new AbortController()
  const closed = await fetch(`http://${address}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: closing.signal })
  const open = await call('/api/events')
  const opened = (open.body ?? new ReadableStream()).pipeThrough(new TextDecoderStream()).getReader()
  expect(closed.status).toBe(200)
  closing.abort()

  await setNote(store, item, '', 0, 'Looks right')
  const received = (async () => {
    let text = ''
    while (!text.includes('event: changed')) {
      const { value, done } = await opened.read()
      if (done) return text
      text += value
    }
    return text
  })()
  const text = await Promise.race([received, new Promise<string>((resolve) => setTimeout(() => resolve('no change within 2 seconds'), 2000))])
  await opened.cancel()

  expect(text).toContain('event: changed')
  expect(text).toContain('Looks right')
})

test('inbox serve writes server.json with mode 0600 before it prints its address, and a restart reuses the port and the token', async () => {
  const data = folder()

  const first = await program(data)
  const saved = JSON.parse(readFileSync(join(data, 'server.json'), 'utf8')) as { port: number; token: string }
  const mode = statSync(join(data, 'server.json')).mode & 0o777
  first.child.kill()
  await first.child.exited
  const second = await program(data)
  const kept = JSON.parse(readFileSync(join(data, 'server.json'), 'utf8')) as { port: number; token: string }

  expect(first.address).toBe(`127.0.0.1:${saved.port}`)
  expect(mode).toBe(0o600)
  expect(saved.token.length).toBeGreaterThanOrEqual(32)
  expect(second.address).toBe(first.address)
  expect(kept).toEqual(saved)
})

test('inbox serve moves to a free port when another app holds the saved one, keeps the token, and reads an unreadable server.json as missing', async () => {
  const data = folder()
  const holder = Bun.serve({ hostname: '127.0.0.1', port: 0, development: false, fetch: () => new Response('another copy') })
  cleanups.push(() => holder.stop(true))
  writeFileSync(join(data, 'server.json'), JSON.stringify({ port: holder.port, token: 'kept-token' }))

  const moved = await program(data)
  const rewritten = JSON.parse(readFileSync(join(data, 'server.json'), 'utf8')) as { port: number; token: string }
  moved.child.kill()
  await moved.child.exited
  writeFileSync(join(data, 'server.json'), '{"port": 4')
  const fresh = await program(data)
  const written = JSON.parse(readFileSync(join(data, 'server.json'), 'utf8')) as { port: number; token: string }

  expect(rewritten.token).toBe('kept-token')
  expect(rewritten.port).not.toBe(holder.port)
  expect(moved.address).toBe(`127.0.0.1:${rewritten.port}`)
  expect(fresh.address).toBe(`127.0.0.1:${written.port}`)
  expect(written.token).not.toBe('kept-token')
})

test('inbox serve that cannot start ends its output with one line naming why, which cmod shows as the reason the program stopped', async () => {
  const data = folder()
  mkdirSync(join(data, 'server.json'))
  const child = Bun.spawn([process.execPath, main, 'serve', '--data', data], { stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])

  expect(exitCode).toBe(1)
  expect(stderr.trim().split('\n').at(-1)).toMatch(/^inbox serve could not start: EISDIR/)
})

test('the browser draws raw HTML in an idea as text, since react-markdown with no plugins does, so a filed <script>, onerror, or onclick never runs', () => {
  const idea = 'An idea with <script>alert(1)</script> inline.\n\n<img src=x onerror="alert(2)">\n\n<div onclick="x()">block</div>'

  const drawn = renderToStaticMarkup(createElement(Markdown, null, idea))

  expect(drawn).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  expect(drawn).toContain('&lt;img src=x onerror=&quot;alert(2)&quot;&gt;')
  expect(drawn).not.toContain('<script')
  expect(drawn).not.toContain('<img')
  expect(drawn).toContain('&lt;div onclick=&quot;x()&quot;&gt;block&lt;/div&gt;')
  expect(drawn).not.toContain('<div onclick')
})

test('inbox --version prints the version in .claude-plugin/plugin.json and exits 0, as cmod checks on every release download', async () => {
  const child = Bun.spawn([process.execPath, main, '--version'], { stdout: 'pipe' })

  expect(await new Response(child.stdout).text()).toBe(`${plugin.version}\n`)
  expect(await child.exited).toBe(0)
})

async function linkedProgram() {
  const bin = folder()
  const build = join(bin, '0.2.0', 'inbox')
  const link = join(bin, 'inbox')
  const compiled = Bun.spawn([process.execPath, 'build', '--compile', main, '--outfile', build], { cwd: bin, stdout: 'ignore', stderr: 'pipe' })
  expect(await compiled.exited).toBe(0)
  symlinkSync(build, link)
  const child = Bun.spawn([link, 'serve', '--data', folder()], { stdout: 'pipe', stderr: 'pipe' })
  cleanups.push(async () => {
    child.kill()
    await child.exited
  })
  const address = await firstLine(child.stdout)
  await Bun.sleep(3000)
  const served = await fetch(`http://${address}/`)
  return { bin, build, link, child, isServing: served.status === 200 && child.exitCode === null }
}

test('the compiled inbox serve keeps serving while the program it was started as stays the same, and exits 0 once cmod link renames a new build of the same version onto it, so cmod starts the new build', async () => {
  const { build, link, child, isServing } = await linkedProgram()
  copyFileSync(build, `${build}.1.tmp`)
  renameSync(`${build}.1.tmp`, build)
  const replacedAt = Date.now()
  const exitCode = await child.exited

  expect(isServing).toBe(true)
  expect(exitCode).toBe(0)
  expect(Date.now() - replacedAt).toBeLessThan(4000)
  expect(await new Response(child.stderr).text()).toContain(`${link} changed, so this copy stops`)
}, 60_000)

test('the compiled inbox serve exits 0 once its link moves to a new version, although the build it runs stays in place', async () => {
  const { bin, build, link, child, isServing } = await linkedProgram()
  const newer = join(bin, '0.3.0', 'inbox')
  mkdirSync(join(bin, '0.3.0'))
  copyFileSync(build, newer)
  symlinkSync(newer, `${link}.1.tmp`)
  renameSync(`${link}.1.tmp`, link)
  const movedAt = Date.now()
  const exitCode = await child.exited

  expect(isServing).toBe(true)
  expect(statSync(build).isFile()).toBe(true)
  expect(exitCode).toBe(0)
  expect(Date.now() - movedAt).toBeLessThan(4000)
}, 60_000)
