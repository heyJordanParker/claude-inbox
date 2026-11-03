import type { Given } from '../../../src/items/answers.js'
import type { Item, Note, Person, PersonFiles, Senders } from '../../../src/items/item.js'
import type { Changed } from '../../../src/items/store.js'

export type Listed = { readonly items: readonly Item[]; readonly person: PersonFiles; readonly repositories: Readonly<Record<string, string>>; readonly senders: Senders; readonly build: string }

export type ChangedEvent = Changed & { readonly senders: Senders }

export type Connection = 'connected' | 'reconnecting' | 'moved'

export class NoAnswer extends Error {}

export class Refused extends Error {}

export class SignedOut extends Error {}

const tokenKey = 'inbox:token'

const retryMs = [500, 1000, 2000, 4000]

const steadyRetryMs = 5000

const movedMs = 60_000

const noAnswer = 'The inbox server did not answer. Once it reconnects, this item shows whether your answer was recorded.'

const signedOut = 'This tab is not signed in to the inbox. Open the item again from the terminal.'

function stored(): string | null {
  try {
    return localStorage.getItem(tokenKey)
  } catch {
    return null
  }
}

let token = stored()

function remember(given: string): void {
  token = given
  try {
    localStorage.setItem(tokenKey, given)
  } catch {
    return
  }
}

async function call<Answer>(path: string, init: { readonly method?: string; readonly body?: unknown; readonly keepalive?: boolean } = {}): Promise<Answer> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token ?? ''}`, 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.keepalive === true ? { keepalive: true } : {}),
  }).catch(() => {
    throw new NoAnswer(noAnswer)
  })
  const body = (await response.json().catch(() => ({}))) as { readonly error?: string }
  if (response.status === 401) throw new SignedOut(signedOut)
  if (!response.ok) throw new Refused(body.error ?? `The inbox answered ${response.status}.`)
  return body as Answer
}

function codeInLink(): string | null {
  const code = new URLSearchParams(location.hash.slice(1)).get('code')
  if (code !== null) history.replaceState(history.state, '', `${location.pathname}${location.search}`)
  return code
}

function waited(failures: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, retryMs[failures] ?? steadyRetryMs))
}

export async function signIn(onConnection: (connection: Connection) => void): Promise<void> {
  const code = codeInLink()
  if (code === null) {
    if (token === null) throw new SignedOut(signedOut)
    return
  }
  for (let failures = 0; ; failures += 1) {
    const traded = await fetch('/api/tokens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).catch(() => undefined)
    if (traded !== undefined) {
      const answer = (await traded.json().catch(() => ({}))) as { readonly token?: string; readonly error?: string }
      if (!traded.ok || answer.token === undefined) throw new SignedOut(answer.error ?? signedOut)
      remember(answer.token)
      return onConnection('connected')
    }
    onConnection('reconnecting')
    await waited(failures)
  }
}

export const api = {
  answer: (id: string, seen: number, given: Given) => call<{ readonly person: Person; readonly isFollowed: boolean }>(`/api/items/${id}/answer`, { method: 'POST', body: { seen, ...given } }),
  setNote: (id: string, path: string, revision: number, words: string) => call<{ readonly person: Person }>(`/api/items/${id}/notes`, { method: 'PUT', body: { path, revision, words } }),
  dropNote: (id: string, note: Note) => call<{ readonly person: Person }>(`/api/items/${id}/notes`, { method: 'DELETE', body: { path: note.path, revision: note.revision } }),
  read: (id: string, seen: number, keepalive = false) => call<{ readonly person: Person }>(`/api/items/${id}/read`, { method: 'POST', body: { seen }, keepalive }),
  skip: (id: string, seen: number) => call<{ readonly person: Person }>(`/api/items/${id}/skip`, { method: 'POST', body: { seen } }),
  async file(id: string, path: string): Promise<string> {
    const response = await fetch(`/api/items/${id}/file?path=${encodeURIComponent(path)}`, { headers: { authorization: `Bearer ${token ?? ''}` } }).catch(() => {
      throw new NoAnswer('The inbox server did not answer, so the file could not be read.')
    })
    if (!response.ok) throw new Refused(((await response.json().catch(() => ({}))) as { readonly error?: string }).error ?? `The inbox answered ${response.status}.`)
    return response.text()
  },
}

async function readEvents(project: string | null, signal: AbortSignal, onEvent: (name: string, data: unknown) => void, onOpen: () => void): Promise<void> {
  const response = await fetch(`/api/events${project === null ? '' : `?project=${encodeURIComponent(project)}`}`, { headers: { authorization: `Bearer ${token ?? ''}` }, signal })
  if (response.status === 401) throw new SignedOut(signedOut)
  if (!response.ok || response.body === null) throw new Error(`The inbox event stream answered ${response.status}.`)
  onOpen()
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffered += value
    for (let end = buffered.indexOf('\n\n'); end !== -1; end = buffered.indexOf('\n\n')) {
      const lines = buffered.slice(0, end).split('\n')
      buffered = buffered.slice(end + 2)
      const name = lines.find((line) => line.startsWith('event: '))
      const data = lines.find((line) => line.startsWith('data: '))
      if (name !== undefined && data !== undefined) onEvent(name.slice('event: '.length), JSON.parse(data.slice('data: '.length)))
    }
  }
}

export type Following = { readonly stop: () => void; readonly resync: () => void }

export function follow(
  project: string | null,
  handlers: {
    readonly onListed: (listed: Listed) => void
    readonly onChanged: (changed: ChangedEvent) => void
    readonly onConnection: (connection: Connection) => void
    readonly onSignedOut: (message: string) => void
  },
): Following {
  const stopping = new AbortController()
  let reopening = new AbortController()
  const heard = (name: string, data: unknown): void => (name === 'listed' ? handlers.onListed(data as Listed) : handlers.onChanged(data as ChangedEvent))
  void (async () => {
    let failures = 0
    let downSince: number | undefined
    while (!stopping.signal.aborted) {
      reopening = new AbortController()
      try {
        await readEvents(project, AbortSignal.any([stopping.signal, reopening.signal]), heard, () => {
          failures = 0
          downSince = undefined
          handlers.onConnection('connected')
        })
      } catch (error) {
        if (stopping.signal.aborted) return
        if (error instanceof SignedOut) return handlers.onSignedOut(error.message)
        if (reopening.signal.aborted) continue
      }
      downSince ??= Date.now()
      handlers.onConnection(Date.now() - downSince >= movedMs ? 'moved' : 'reconnecting')
      await waited(failures)
      failures += 1
    }
  })()
  return { stop: () => stopping.abort(), resync: () => reopening.abort() }
}
