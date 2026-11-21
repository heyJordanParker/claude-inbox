import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ago, cardStatusOf, cardTime, current, emptyLine, isUnread, kindName, kinds, kindTabNames, ofKind, personOf, plural, scopeNames, senderOf, threadLine, wording, type Deliveries, type Kind, type PersonFiles, type Scope, type Senders, type Summary } from '../../../src/items/item.js'
import { Sender, Title } from './item.js'

export type Selection = {
  readonly chosen: readonly Summary[]
  readonly toggle: (id: string) => void
  readonly selectAll: () => void
  readonly clear: () => void
  readonly done: () => void
  readonly markRead: () => void
}

type Shared = { readonly person: PersonFiles; readonly senders: Senders; readonly deliveries: Deliveries; readonly shownId: string | undefined; readonly onView: (id: string) => void; readonly onDone: (item: Summary) => void; readonly selection: Selection }

function ItemCard({ item, isArchived, person, senders, deliveries, shownId, onView, onDone, selection }: Shared & { readonly item: Summary; readonly isArchived: boolean }): ReactNode {
  const itemPerson = personOf(person, item)
  const status = cardStatusOf(item, itemPerson, senders, deliveries)
  const sender = senderOf(item.origin, item.project, senders)
  const at = cardTime(item, itemPerson, deliveries)
  const thread = threadLine(item)
  const isShown = item.id === shownId
  const isChosen = selection.chosen.some((each) => each.id === item.id)
  const title = current(item).title
  const card = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (isShown) card.current?.scrollIntoView({ block: 'nearest' })
  }, [isShown])
  return (
    <li className="row" data-selected={isChosen}>
      {isArchived ? <span /> : <input type="checkbox" className="row__select" aria-label={`Select ${title}`} checked={isChosen} onChange={() => selection.toggle(item.id)} />}
      <button ref={card} type="button" className="card" data-archived={isArchived} data-unread={!isArchived && isUnread(item, itemPerson)} data-status={status?.tone} aria-current={isShown ? 'true' : undefined} onClick={() => onView(item.id)}>
        <span className="card__dot" aria-hidden="true" />
        <span className="card__from" title={sender.title}>
          <span className="card__kind" data-kind={item.kind}>
            {kindName(item)}
          </span>
          <Sender {...sender} />
        </span>
        <time className="card__when" dateTime={at}>
          {ago(at, Date.now())}
        </time>
        <span className="card__title">
          <Title title={title} />
        </span>
        {status === undefined && thread === undefined ? null : (
          <span className="card__meta">
            {status === undefined ? null : (
              <span className="card__status" data-tone={status.tone}>
                {status.word}
              </span>
            )}
            {thread === undefined ? null : <span className="card__thread">{thread}</span>}
          </span>
        )}
      </button>
      {isArchived || item.kind !== 'report' ? null : (
        <button type="button" className="row__done button" onClick={() => onDone(item)}>
          {wording.done}
        </button>
      )}
    </li>
  )
}

function Cards({ items, isArchived, ...shared }: Shared & { readonly items: readonly Summary[]; readonly isArchived: boolean }): ReactNode {
  if (items.length === 0) return null
  return (
    <ul className="cards">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} isArchived={isArchived} {...shared} />
      ))}
    </ul>
  )
}

function Archive({ items, ...shared }: Shared & { readonly items: readonly Summary[] }): ReactNode {
  const isShownInside = items.some((item) => item.id === shared.shownId)
  const [isOpen, setOpen] = useState(isShownInside)
  useEffect(() => {
    if (isShownInside) setOpen(true)
  }, [isShownInside])
  if (items.length === 0) return null
  return (
    <section className="archive" aria-label={wording.archive}>
      <button type="button" className="archive__toggle" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>
        <svg className="archive__icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="20" height="5" x="2" y="3" rx="1" />
          <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
          <path d="M10 12h4" />
        </svg>
        {wording.archive} <span className="list__count">{items.length}</span>
        <svg className="archive__chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {isOpen ? <Cards items={items} isArchived {...shared} /> : null}
    </section>
  )
}

function Segments<Key extends string>({ label, options, selected, onSelect }: { readonly label: string; readonly options: readonly { readonly key: Key; readonly name: string; readonly count: number }[]; readonly selected: Key; readonly onSelect: (key: Key) => void }): ReactNode {
  return (
    <div className="segments" role="group" aria-label={label}>
      {options.map(({ key, name, count }) => (
        <button key={key} type="button" className="segments__segment" aria-pressed={key === selected} onClick={() => onSelect(key)}>
          {name} <span className="list__count">{count}</span>
        </button>
      ))}
    </div>
  )
}

function SelectionBar({ selection, listed }: { readonly selection: Selection; readonly listed: readonly Summary[] }): ReactNode {
  const { chosen } = selection
  const reports = chosen.filter((item) => item.kind === 'report').length
  const isAll = chosen.length > 0 && chosen.length === listed.length
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (chosen.length === 0 || event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) && !(event.target instanceof HTMLInputElement && event.target.type === 'checkbox'))) return
      if (event.key === 'e' && reports > 0) selection.done()
      else if (event.key === 'i') selection.markRead()
      else return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('keydown', pressed, { capture: true })
    return () => document.removeEventListener('keydown', pressed, { capture: true })
  }, [chosen, reports, selection])
  if (listed.length === 0) return null
  return (
    <div className="selection">
      <label className="selection__all">
        <input type="checkbox" checked={isAll} ref={(box) => void (box === null ? undefined : (box.indeterminate = chosen.length > 0 && !isAll))} onChange={() => (chosen.length > 0 ? selection.clear() : selection.selectAll())} />
        {chosen.length === 0 ? wording.selectAll : `${chosen.length} ${wording.selected}`}
      </label>
      {chosen.length === 0 ? null : (
        <div className="selection__actions">
          {reports === 0 ? null : (
            <button type="button" className="button" data-primary="true" onClick={selection.done}>
              {wording.done} {plural(reports, 'report')}
              <kbd className="button__key">e</kbd>
            </button>
          )}
          <button type="button" className="button" onClick={selection.markRead}>
            {wording.markRead}
            <kbd className="button__key">i</kbd>
          </button>
        </div>
      )}
    </div>
  )
}

export function List({ scopes, scope, countIn, onScope, kind, everyListed, onKind, listed, archived, ...shared }: Shared & {
  readonly scopes: readonly Scope[]
  readonly scope: Scope
  readonly countIn: (scope: Scope) => number
  readonly onScope: (scope: Scope) => void
  readonly kind: Kind | null
  readonly everyListed: readonly Summary[]
  readonly onKind: (kind: Kind | null) => void
  readonly listed: readonly Summary[]
  readonly archived: readonly Summary[]
}): ReactNode {
  const kindOptions = [{ key: 'all' as const, name: wording.all, count: everyListed.length }, ...kinds.filter((each) => each === kind || everyListed.some((item) => item.kind === each)).map((each) => ({ key: each, name: kindTabNames[each], count: ofKind(everyListed, each).length }))]
  return (
    <nav className="list" aria-label="Inbox items">
      <Segments label="Scope" options={scopes.map((each) => ({ key: each, name: scopeNames[each], count: countIn(each) }))} selected={scope} onSelect={onScope} />
      <Segments label="Kind" options={kindOptions} selected={kind ?? 'all'} onSelect={(key) => onKind(key === 'all' ? null : key)} />
      <SelectionBar selection={shared.selection} listed={listed} />
      <Cards items={listed} isArchived={false} {...shared} />
      <Archive items={archived} {...shared} />
    </nav>
  )
}

export function Empty({ scope }: { readonly scope: Scope }): ReactNode {
  return (
    <article className="empty" aria-label={wording.inboxZero}>
      <span className="empty__badge" aria-hidden="true">
        <svg className="empty__icon" viewBox="0 0 24 24">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <h2 className="empty__title">{wording.inboxZero}</h2>
      <p className="empty__line">{emptyLine(scope)}</p>
      <p className="part__aside">{wording.emptyHint}</p>
    </article>
  )
}
