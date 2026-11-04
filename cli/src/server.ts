import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { answer, dropNote, markRead, Moved, NotOffered, setNote, skip, type Given } from '../../src/items/answers.js'
import { isFollowed, isUnnamed, plural, sendersFor, type Item, type Person, type Senders } from '../../src/items/item.js'
import { convertJsonFiles, itemOf, itemPath, readerOf, rereadMs, type Changed, type Store } from '../../src/items/store.js'
import { remove } from './disk.js'
import script from '../build/script.txt' with { type: 'file' }
import shell from '../build/shell.txt' with { type: 'file' }
import style from '../build/style.txt' with { type: 'file' }

export type Options = {
  readonly store: Store
  readonly port: number
  readonly token: string
  readonly senders: () => Promise<Senders>
  readonly repositoryOf: (project: string) => Promise<string>
}

export type Serving = {
  readonly port: number
  stop(): Promise<void>
}

const host = '127.0.0.1'

const pollMs = 500

const codeMs = 60_000

const csp = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"

const itemRoute = /^\/api\/items\/([a-z0-9-]+)\/(answer|notes|read|skip|file)$/

const assets: Readonly<Record<string, { readonly path: string; readonly type: string }>> = {
  '/app.js': { path: script, type: 'text/javascript;charset=utf-8' },
  '/app.css': { path: style, type: 'text/css;charset=utf-8' },
}

class Refusal extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'content-security-policy': csp } })
}

function buildOf(shellText: string): string {
  const build = /<meta name="inbox-build" content="([0-9a-f]+)" \/>/.exec(shellText)?.[1]
  if (build === undefined) throw new Error('The built shell names no build, so cli/build.ts did not write it.')
  return build
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text).digest()
}

function drawnPaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(drawnPaths)
  if (typeof value !== 'object' || value === null) return []
  const fields = value as Readonly<Record<string, unknown>>
  const named = (fields['kind'] === 'api' || fields['kind'] === 'diff') && typeof fields['path'] === 'string' ? [fields['path']] : []
  const listed = fields['kind'] === 'files' ? drawnFiles(fields['files']) : []
  return [...named, ...listed, ...Object.values(fields).flatMap(drawnPaths)]
}

function drawnFiles(files: unknown): string[] {
  return Array.isArray(files) ? files.flatMap((file: { readonly path?: unknown }) => (typeof file.path === 'string' ? [file.path] : [])) : []
}

async function bodyOf(request: Request): Promise<Readonly<Record<string, unknown>>> {
  const body: unknown = await request.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Refusal(400, 'The request body must be a JSON object.')
  return body as Readonly<Record<string, unknown>>
}

function seenOf(body: Readonly<Record<string, unknown>>): number {
  const { seen } = body
  if (typeof seen !== 'number' || !Number.isInteger(seen) || seen < 0) throw new Refusal(400, '"seen" must be the revision number the person saw.')
  return seen
}

function givenOf(body: Readonly<Record<string, unknown>>): Given {
  const { kind, option, words } = body
  if (typeof kind !== 'string') throw new Refusal(400, '"kind" must be a string.')
  if (option !== undefined && typeof option !== 'string') throw new Refusal(400, '"option" must be a string.')
  if (words !== undefined && typeof words !== 'string') throw new Refusal(400, '"words" must be a string.')
  return { kind: kind as Given['kind'],...(option === undefined ? {} : { option }), ...(words === undefined ? {} : { words }) }
}

export async function serve({ store, port, token, senders: listSenders, repositoryOf }: Options): Promise<Serving> {
  const items = new Map<string, Item>()
  const person = new Map<string, Person>()
  const repositories = new Map<string, Promise<string>>()
  const codes = new Map<string, number>()
  const streams = new Set<ReadableStreamDefaultController<string>>()
  const reader = readerOf(store)
  let lastChanged: string | undefined
  let senders: Senders = {}
  let learning: Promise<void> | undefined

  const broadcast = (changed: Changed): void => {
    const frame = `event: changed\ndata: ${JSON.stringify({ ...changed, senders })}\n\n`
    for (const stream of streams) stream.enqueue(frame)
  }

  const learnSenders = (): Promise<void> => {
    learning ??= listSenders()
      .then((listed) => {
        const fresh = sendersFor([...items.values()], listed)
        if (JSON.stringify(fresh) === JSON.stringify(senders)) return
        senders = fresh
        broadcast({ items: [], person: {}, gone: { items: [], person: [] } })
      })
      .catch((error: unknown) => console.error('inbox serve could not list the sessions, so items keep the session titles read before:', error))
      .finally(() => (learning = undefined))
    return learning
  }

  const reread = async (): Promise<void> => {
    const { skipped, ...changed } = await reader.read()
    for (const id of changed.gone.items) items.delete(id)
    for (const id of changed.gone.person) person.delete(id)
    for (const item of changed.items) items.set(item.id, item)
    for (const [id, each] of Object.entries(changed.person)) person.set(id, each)
    for (const line of skipped) console.error(`inbox serve skipped ${line}`)
    if (changed.items.length > 0 || Object.keys(changed.person).length > 0 || changed.gone.items.length > 0 || changed.gone.person.length > 0) broadcast(changed)
    if (isUnnamed([...items.values()], senders)) void learnSenders()
  }

  const poll = async (): Promise<void> => {
    const text = (await store.disk.exists(store.changed)) ? await store.disk.read(store.changed) : ''
    if (text === lastChanged) return
    await reread()
    lastChanged = text
  }

  const repositoryIn = (project: string): Promise<string> => {
    const known = repositories.get(project)
    if (known !== undefined) return known
    const learned = repositoryOf(project)
    repositories.set(project, learned)
    return learned
  }

  const hasToken = (request: Request): boolean => {
    const given = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1]
    return given !== undefined && timingSafeEqual(digest(given), digest(token))
  }

  const found = async (id: string): Promise<Item> => {
    if (!(await store.disk.exists(itemPath(store, id)))) throw new Refusal(404, `The inbox has no item ${id}.`)
    return itemOf(store, id)
  }

  const trade = async (request: Request): Promise<Response> => {
    const { code } = await bodyOf(request)
    const expiresAt = typeof code === 'string' ? codes.get(code) : undefined
    if (typeof code === 'string') codes.delete(code)
    if (expiresAt === undefined || expiresAt <= Date.now()) throw new Refusal(403, 'This link was already used or has expired. Open the item again from the terminal.')
    return json(200, { token })
  }

  const mint = (): Response => {
    const now = Date.now()
    for (const [code, expiresAt] of codes) if (expiresAt <= now) codes.delete(code)
    const code = randomBytes(16).toString('base64url')
    codes.set(code, now + codeMs)
    return json(200, { code })
  }

  const events = async (request: Request, url: URL, server: Bun.Server<undefined>): Promise<Response> => {
    const asked = url.searchParams.get('project')
    const projects = [...new Set([...[...items.values()].map((item) => item.project), ...(asked === null ? [] : [asked])])]
    const repositories = Object.fromEntries(await Promise.all(projects.map(async (project) => [project, await repositoryIn(project)] as const)))
    const build = buildOf(await Bun.file(shell).text())
    let opened: ReadableStreamDefaultController<string> | undefined
    const body = new ReadableStream<string>({
      start(controller) {
        opened = controller
        controller.enqueue(`event: listed\ndata: ${JSON.stringify({ items: [...items.values()], person: Object.fromEntries(person), repositories, senders, build })}\n\n`)
        streams.add(controller)
      },
      cancel() {
        if (opened !== undefined) streams.delete(opened)
      },
    })
    server.timeout(request, 0)
    return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'content-security-policy': csp } })
  }

  const fileOf = async (item: Item, url: URL): Promise<Response> => {
    const asked = url.searchParams.get('path')
    if (asked === null || !item.revisions.some((revision) => drawnPaths(revision.content).includes(asked))) throw new Refusal(403, `No drawing of ${item.id} names ${asked ?? 'that path'}.`)
    const root = await realpath(item.project)
    const path = await realpath(join(item.project, asked)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') throw new Refusal(404, `${asked} does not exist in ${item.project}.`)
      throw error
    })
    if (!path.startsWith(`${root}${sep}`)) throw new Refusal(403, `${asked} is outside ${item.project}.`)
    return new Response(await readFile(path, 'utf8'), { headers: { 'content-type': 'text/plain;charset=utf-8', 'content-security-policy': csp } })
  }

  const onItem = async (request: Request, url: URL, id: string, action: string): Promise<Response> => {
    const item = await found(id)
    if (action === 'file' && request.method === 'GET') return fileOf(item, url)
    if (action === 'answer' && request.method === 'POST') {
      const body = await bodyOf(request)
      const answered = await answer(store, id, seenOf(body), givenOf(body))
      return json(200, { person: answered, isFollowed: isFollowed(item, senders) })
    }
    if (action === 'notes' && (request.method === 'PUT' || request.method === 'DELETE')) {
      const { path, revision, words } = await bodyOf(request)
      if (typeof path !== 'string' || typeof revision !== 'number' || !Number.isInteger(revision)) throw new Refusal(400, '"path" must be a string and "revision" a revision number.')
      if (request.method === 'DELETE') return json(200, { person: await dropNote(store, item, path, revision) })
      if (typeof words !== 'string') throw new Refusal(400, '"words" must be a string.')
      return json(200, { person: await setNote(store, item, path, revision, words) })
    }
    if (action === 'read' && request.method === 'POST') return json(200, { person: await markRead(store, item, seenOf(await bodyOf(request))) })
    if (action === 'skip' && request.method === 'POST') return json(200, { person: await skip(store, item, seenOf(await bodyOf(request))) })
    throw new Refusal(405, `${request.method} ${url.pathname} is not an inbox route.`)
  }

  const page = (pathname: string): Response => {
    const asset = pathname === '/' || /^\/items\/[^/]+$/.test(pathname) ? { path: shell, type: 'text/html;charset=utf-8' } : assets[pathname]
    if (asset === undefined) throw new Refusal(404, `${pathname} is not part of the inbox.`)
    return new Response(Bun.file(asset.path), { headers: { 'content-type': asset.type, 'cache-control': 'no-cache', 'content-security-policy': csp } })
  }

  const route = async (request: Request, url: URL, server: Bun.Server<undefined>): Promise<Response> => {
    const { pathname } = url
    const isApi = pathname === '/api' || pathname.startsWith('/api/')
    if (!isApi) {
      if (request.method !== 'GET') throw new Refusal(405, `${request.method} ${pathname} is not an inbox route.`)
      return page(pathname)
    }
    if (pathname === '/api/tokens' && request.method === 'POST') return trade(request)
    if (!hasToken(request)) throw new Refusal(401, 'This request needs the inbox token.')
    if (pathname === '/api/codes' && request.method === 'POST') return mint()
    if (pathname === '/api/events' && request.method === 'GET') return events(request, url, server)
    const matched = itemRoute.exec(pathname)
    const [, id, action] = matched ?? []
    if (id !== undefined && action !== undefined) return onItem(request, url, id, action)
    throw new Refusal(404, `${request.method} ${pathname} is not an inbox route.`)
  }

  const { converted, skipped } = await convertJsonFiles(store, {}, remove)
  for (const line of skipped) console.error(`inbox serve left ${line}`)
  if (converted > 0) console.error(`inbox serve converted ${plural(converted, 'JSON file')} to Markdown`)
  await poll()
  const server = Bun.serve({
    hostname: host,
    port,
    development: false,
    reusePort: false,
    async fetch(request, served) {
      const address = `${host}:${served.port}`
      const origin = request.headers.get('origin')
      const url = new URL(request.url)
      if (request.headers.get('host') !== address) return json(403, { error: `This server answers only requests to ${address}.` })
      if (origin !== null && origin !== `http://${address}`) return json(403, { error: `This server answers no page from ${origin}.` })
      if (url.pathname === '/api/tokens' && origin === null) return json(403, { error: 'Trading a code for the token needs the Origin header.' })
      try {
        return await route(request, url, served)
      } catch (error) {
        if (error instanceof Refusal) return json(error.status, { error: error.message })
        if (error instanceof Moved) return json(409, { error: error.message })
        if (error instanceof NotOffered) return json(400, { error: error.message })
        console.error(`inbox serve could not answer ${request.method} ${url.pathname}:`, error)
        return json(500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })
  const polling = setInterval(() => {
    poll().catch((error: unknown) => console.error('inbox serve could not read what changed:', error))
  }, pollMs)
  const rereading = setInterval(() => {
    reread().catch((error: unknown) => console.error('inbox serve could not reread the store:', error))
    void learnSenders()
  }, rereadMs)

  return {
    port: server.port ?? port,
    async stop() {
      clearInterval(polling)
      clearInterval(rereading)
      for (const stream of streams) stream.close()
      streams.clear()
      await server.stop(true)
    },
  }
}
