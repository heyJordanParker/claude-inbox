import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { viewingAfterAnswer, type Given } from '../../../src/items/answers.js'
import { unfollowedWarning } from '../../../src/items/heard.js'
import { archive, isInScope, narrowestScope, nextAfter, personOf, positionLine, queue, revisionOf, scopes, shownOf, unseenOf, type Item, type Note, type Person, type PersonFiles, type Scope, type Senders } from '../../../src/items/item.js'
import type { Folds } from '../../../src/items/tree.js'
import { api, follow, NoAnswer, Refused, signIn, type ChangedEvent, type Connection, type Following } from './api.js'
import { FileView, type ShownFile } from './drawing.js'
import { ItemView, type ItemActions } from './item.js'
import { Empty, List } from './list.js'
import './styles.css'

type Data = { readonly items: readonly Item[]; readonly person: PersonFiles; readonly repositories: Readonly<Record<string, string>>; readonly senders: Senders }

type Notice = { readonly id: number; readonly tone: 'warning' | 'error'; readonly message: string; readonly description?: string }

const foldsKey = 'inbox:folds'

const noticeMs = 8000

const here = new URLSearchParams(location.search)

const session = here.get('session')

const project = here.get('project')

const offered: readonly Scope[] = session === null ? ['all'] : scopes

const build = document.querySelector<HTMLMetaElement>('meta[name="inbox-build"]')?.content

function viewedInPath(): string | null {
  return /^\/items\/([^/]+)$/.exec(location.pathname)?.[1] ?? null
}

function storedFolds(): Folds {
  try {
    return JSON.parse(localStorage.getItem(foldsKey) ?? '{}') as Folds
  } catch {
    return {}
  }
}

function applied(data: Data, changed: ChangedEvent): Data {
  const items = new Map(data.items.map((item) => [item.id, item]))
  for (const item of changed.items) items.set(item.id, item)
  for (const id of changed.gone.items) items.delete(id)
  const person = Object.entries({ ...data.person, ...changed.person }).filter(([id]) => !changed.gone.person.includes(id))
  return { ...data, items: [...items.values()], person: Object.fromEntries(person), senders: changed.senders }
}

function App(): ReactNode {
  const [data, setData] = useState<Data | undefined>(undefined)
  const [signedOut, setSignedOut] = useState<string | undefined>(undefined)
  const [connection, setConnection] = useState<Connection>('connected')
  const [viewing, setViewing] = useState<string | null>(viewedInPath)
  const [scope, setScope] = useState<Scope>(offered[0] ?? 'all')
  const [file, setFile] = useState<ShownFile | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [folds, setFolds] = useState<Folds>(storedFolds)
  const [notices, setNotices] = useState<readonly Notice[]>([])
  const latest = useRef<Data | undefined>(undefined)
  latest.current = data
  const streamed = useRef(new Map<string, number>())

  const notify = useCallback((notice: Omit<Notice, 'id'>) => {
    const id = Date.now() + Math.random()
    setNotices((shown) => [...shown, { ...notice, id }])
    setTimeout(() => setNotices((shown) => shown.filter((each) => each.id !== id)), noticeMs)
  }, [])

  useEffect(() => {
    let following: Following | undefined
    let isStopped = false
    const heard = (ids: readonly string[]) => {
      for (const id of ids) streamed.current.set(id, (streamed.current.get(id) ?? 0) + 1)
    }
    signIn(setConnection)
      .then(() => {
        if (isStopped) return
        following = follow(project, {
          onListed: (listed) => {
            if (listed.build !== build) return location.reload()
            heard(Object.keys(listed.person))
            setData(listed)
          },
          onChanged: (changed) => {
            heard([...Object.keys(changed.person), ...changed.gone.person])
            setData((known) => (known === undefined ? known : applied(known, changed)))
            const known = latest.current?.repositories ?? {}
            if (changed.items.some((item) => known[item.project] === undefined)) following?.resync()
          },
          onConnection: setConnection,
          onSignedOut: setSignedOut,
        })
      })
      .catch((error: unknown) => setSignedOut(error instanceof Error ? error.message : String(error)))
    return () => {
      isStopped = true
      following?.stop()
    }
  }, [])


  const person = data?.person ?? {}
  const senders = data?.senders ?? {}
  const repositories = data?.repositories ?? {}
  const place = { session: session ?? '', repository: (project === null ? undefined : repositories[project]) ?? project ?? '' }
  const scopedTo = (each: Scope) => (data?.items ?? []).filter((item) => isInScope(item, each, place, repositories))
  const widest = viewing === null ? scope : narrowestScope(offered, scope, viewing, scopedTo)
  const items = scopedTo(widest)
  const listed = queue(items, person, senders)
  const shown = shownOf(items, person, senders, viewing)
  const next = shown === undefined ? undefined : nextAfter(listed, shown)
  const latestShown = useRef<Item | undefined>(undefined)
  latestShown.current = shown
  const itemPane = useRef<HTMLElement>(null)
  const shownBefore = useRef<string | undefined>(undefined)
  const shownId = shown?.id

  useEffect(() => {
    if (shownId === undefined) return
    if (shownBefore.current !== undefined && shownBefore.current !== shownId) itemPane.current?.scrollIntoView({ block: 'start' })
    shownBefore.current = shownId
  }, [shownId])

  useEffect(() => {
    document.title = listed.length === 0 ? 'Inbox' : `(${listed.length}) Inbox`
  }, [listed.length])

  useEffect(() => {
    if (shown === undefined || viewedInPath() === shown.id) return
    history.replaceState(history.state, '', `/items/${shown.id}${location.search}`)
  }, [shown])

  const replied = useCallback((id: string) => {
    const sent = streamed.current.get(id)
    return (fresh: Person) => {
      if (streamed.current.get(id) !== sent) return
      setData((known) => (known === undefined ? known : { ...known, person: { ...known.person, [id]: fresh } }))
    }
  }, [])

  const markRead = useCallback(
    (item: Item, keepalive = false) => {
      const known = latest.current
      if (known === undefined || unseenOf(item, personOf(known.person, item)) === undefined) return
      const remember = replied(item.id)
      api
        .read(item.id, revisionOf(item), keepalive)
        .then(({ person: fresh }) => remember(fresh))
        .catch((error: unknown) => {
          if (!(error instanceof Refused)) notify({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
        })
    },
    [notify, replied],
  )

  useEffect(() => {
    const moved = () => {
      const left = latestShown.current
      const id = viewedInPath()
      setViewing(id)
      setEditing(null)
      setFile(null)
      if (left !== undefined && left.id !== id && document.visibilityState === 'visible') markRead(left)
    }
    addEventListener('popstate', moved)
    return () => removeEventListener('popstate', moved)
  }, [markRead])

  useEffect(() => {
    const hidden = () => {
      const left = latestShown.current
      if (document.visibilityState === 'hidden' && left !== undefined) markRead(left, true)
    }
    document.addEventListener('visibilitychange', hidden)
    addEventListener('pagehide', hidden)
    return () => {
      document.removeEventListener('visibilitychange', hidden)
      removeEventListener('pagehide', hidden)
    }
  }, [markRead])

  const view = (id: string, isRead = true) => {
    const left = shown
    setViewing(id)
    setEditing(null)
    setFile(null)
    history.pushState(null, '', `/items/${id}${location.search}`)
    if (isRead && left !== undefined && left.id !== id && document.visibilityState === 'visible') markRead(left)
  }

  const failed = (error: unknown): false => {
    if (error instanceof Refused) notify({ tone: 'warning', message: error.message })
    else notify({ tone: 'error', message: error instanceof Error ? error.message : String(error), ...(error instanceof NoAnswer ? {} : { description: 'Reload the page if it keeps happening.' }) })
    return false
  }

  const actionsFor = (item: Item): ItemActions => ({
    answer: (given: Given) => {
      const remember = replied(item.id)
      return api
        .answer(item.id, revisionOf(item), given)
        .then(({ person: fresh, isFollowed }) => {
          remember(fresh)
          setEditing(null)
          setViewing((now) => viewingAfterAnswer(given, item.id, now))
          if (!isFollowed) notify({ tone: 'warning', ...unfollowedWarning(item) })
          return true
        })
        .catch(failed)
    },
    skip: async () => {
      if (next === undefined) return
      const remember = replied(item.id)
      await api
        .skip(item.id, revisionOf(item))
        .then(({ person: fresh }) => {
          remember(fresh)
          view(next.id, false)
        })
        .catch(failed)
    },
    setNote: (path: string, words: string) => {
      const remember = replied(item.id)
      return api
        .setNote(item.id, path, revisionOf(item), words)
        .then(({ person: fresh }) => {
          remember(fresh)
          return true
        })
        .catch(failed)
    },
    dropNote: (note: Note) => {
      const remember = replied(item.id)
      api
        .dropNote(item.id, note)
        .then(({ person: fresh }) => remember(fresh))
        .catch(failed)
    },
    toggleFold: (key: string, isOpenNow: boolean) =>
      setFolds((known) => {
        const fresh = { ...known, [key]: isOpenNow }
        try {
          localStorage.setItem(foldsKey, JSON.stringify(fresh))
        } catch {
          return fresh
        }
        return fresh
      }),
  })

  const banner = signedOut ?? (connection === 'reconnecting' ? 'Reconnecting to the inbox…' : connection === 'moved' ? 'The inbox moved. Open it again from the terminal.' : undefined)

  return (
    <div className="app">
      {banner === undefined ? null : (
        <p className="app__banner banner" role="status" data-tone={signedOut === undefined && connection === 'reconnecting' ? 'warning' : 'error'}>
          {banner}
        </p>
      )}
      <div className="app__list">
        <List
          scopes={offered}
          scope={widest}
          countIn={(each) => queue(scopedTo(each), person, senders).length}
          onScope={(each) => {
            setScope(each)
            setViewing(null)
          }}
          listed={listed}
          archived={archive(items, person, senders)}
          person={person}
          senders={senders}
          shownId={shown?.id}
          onView={(id) => view(id)}
        />
      </div>
      <main ref={itemPane} className="app__item">
        {data === undefined ? (
          <p className="part__aside">{signedOut === undefined ? 'Reading the inbox…' : ''}</p>
        ) : file !== null ? (
          <FileView file={file} read={api.file} onClose={() => setFile(null)} />
        ) : shown === undefined ? (
          <Empty scope={widest} />
        ) : (
          <ItemView
            key={shown.id}
            item={shown}
            person={personOf(person, shown)}
            senders={data.senders}
            place={positionLine(listed, shown, personOf(person, shown), Date.now())}
            next={next}
            folds={folds}
            editing={editing}
            setEditing={setEditing}
            actions={actionsFor(shown)}
            onFile={(path, diff) => setFile({ id: shown.id, project: shown.project, path, diff })}
          />
        )}
      </main>
      <ol className="app__notices notices" aria-live="polite">
        {notices.map((notice) => (
          <li key={notice.id} className="notice" data-tone={notice.tone}>
            <p className="notice__text">{notice.message}</p>
            {notice.description === undefined ? null : <p className="notice__description">{notice.description}</p>}
          </li>
        ))}
      </ol>
    </div>
  )
}

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root element.')
createRoot(root).render(<App />)
