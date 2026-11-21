import type { Given } from '../../../src/items/answers.js'
import type { Item, Note, Person, PersonFiles, Senders, Summary } from '../../../src/items/item.js'
import type { Changed } from '../../../src/items/store.js'

export type Listed = { readonly items: readonly Summary[]; readonly person: PersonFiles; readonly repositories: Readonly<Record<string, string>>; readonly senders: Senders; readonly build: string }

export type ChangedEvent = Omit<Changed, 'items'> & { readonly items: readonly Summary[]; readonly senders: Senders }

export type Connection = 'connected' | 'reconnecting' | 'moved'

export class NoAnswer extends Error {}

export class Refused extends Error {}

const retryMs = [500, 1000, 2000, 4000]

const steadyRetryMs = 5000

const reconnectingAfterMs = 5000

const movedMs = 60_000

const noAnswer = 'The inbox server did not answer. Once it reconnects, this item shows whether your answer was recorded.'

async function call<Answer>(path: string, init: { readonly method?: string; readonly body?: unknown; readonly keepalive?: boolean } = {}): Promise<Answer> {
  const response = await fetch(path, {
    method: init.method ?? 'GET',
    headers: { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.keepalive === true ? { keepalive: true } : {}),
  }).catch(() => {
    throw new NoAnswer(noAnswer)
  })
  const body = (await response.json().catch(() => ({}))) as { readonly error?: string }
  if (!response.ok) throw new Refused(body.error ?? `The inbox answered ${response.status}.`)
  return body as Answer
}

function waited(failures: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, retryMs[failures] ?? steadyRetryMs))
}

export const api = {
  item: (id: string) => call<Item>(`/api/items/${id}`),
  answer: (id: string, seen: number, given: Given) => call<{ readonly person: Person; readonly isUnheard: boolean }>(`/api/items/${id}/answer`, { method: 'POST', body: { seen, ...given } }),
  setNote: (id: string, path: string, revision: number, words: string) => call<{ readonly person: Person }>(`/api/items/${id}/notes`, { method: 'PUT', body: { path, revision, words } }),
  dropNote: (id: string, note: Note) => call<{ readonly person: Person }>(`/api/items/${id}/notes`, { method: 'DELETE', body: { path: note.path, revision: note.revision } }),
  read: (id: string, seen: number, keepalive = false) => call<{ readonly person: Person }>(`/api/items/${id}/read`, { method: 'POST', body: { seen }, keepalive }),
  async file(id: string, path: string): Promise<string> {
    const response = await fetch(`/api/items/${id}/file?path=${encodeURIComponent(path)}`).catch(() => {
      throw new NoAnswer('The inbox server did not answer, so the file could not be read.')
    })
    if (!response.ok) throw new Refused(((await response.json().catch(() => ({}))) as { readonly error?: string }).error ?? `The inbox answered ${response.status}.`)
    return response.text()
  },
}

async function readEvents(project: string | null, signal: AbortSignal, onEvent: (name: string, data: unknown) => void, onOpen: () => void): Promise<void> {
  const response = await fetch(`/api/events${project === null ? '' : `?project=${encodeURIComponent(project)}`}`, { signal })
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
        if (reopening.signal.aborted) continue
      }
      downSince ??= Date.now()
      const down = Date.now() - downSince
      if (down >= reconnectingAfterMs) handlers.onConnection(down >= movedMs ? 'moved' : 'reconnecting')
      await waited(failures)
      failures += 1
    }
  })()
  return { stop: () => stopping.abort(), resync: () => reopening.abort() }
}
