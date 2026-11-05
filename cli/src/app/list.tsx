import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ago, cardStatusOf, cardTime, current, emptyLine, kindName, personOf, scopeNames, senderOf, threadLine, wording, type Deliveries, type Item, type PersonFiles, type Scope, type Senders } from '../../../src/items/item.js'
import { Sender, Title } from './item.js'

type Shared = { readonly person: PersonFiles; readonly senders: Senders; readonly deliveries: Deliveries; readonly shownId: string | undefined; readonly onView: (id: string) => void }

function ItemCard({ item, isArchived, person, senders, deliveries, shownId, onView }: Shared & { readonly item: Item; readonly isArchived: boolean }): ReactNode {
  const itemPerson = personOf(person, item)
  const status = cardStatusOf(item, itemPerson, senders, deliveries)
  const sender = senderOf(item.origin, item.project, senders)
  const at = cardTime(item, itemPerson, deliveries)
  const thread = threadLine(item)
  const isShown = item.id === shownId
  const card = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (isShown) card.current?.scrollIntoView({ block: 'nearest' })
  }, [isShown])
  return (
    <li>
      <button ref={card} type="button" className="card" data-archived={isArchived} data-status={status?.tone} aria-current={isShown ? 'true' : undefined} onClick={() => onView(item.id)}>
        <span className="card__dot" aria-hidden="true" />
        <span className="card__from" title={sender.title}>
          <Sender {...sender} />
        </span>
        <time className="card__when" dateTime={at}>
          {ago(at, Date.now())}
        </time>
        <span className="card__title">
          <Title title={current(item).title} />
        </span>
        <span className="card__meta">
          <span className="card__kind" data-kind={item.kind}>
            {kindName(item)}
          </span>
          {status === undefined || status.word === 'new' ? null : (
            <span className="card__status" data-tone={status.tone}>
              {status.word}
            </span>
          )}
          {thread === undefined ? null : <span className="card__thread">{thread}</span>}
        </span>
      </button>
    </li>
  )
}

function Cards({ items, isArchived, ...shared }: Shared & { readonly items: readonly Item[]; readonly isArchived: boolean }): ReactNode {
  if (items.length === 0) return null
  return (
    <ul className="cards">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} isArchived={isArchived} {...shared} />
      ))}
    </ul>
  )
}

function Archive({ items, ...shared }: Shared & { readonly items: readonly Item[] }): ReactNode {
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

export function List({ scopes, scope, countIn, onScope, listed, archived, ...shared }: Shared & {
  readonly scopes: readonly Scope[]
  readonly scope: Scope
  readonly countIn: (scope: Scope) => number
  readonly onScope: (scope: Scope) => void
  readonly listed: readonly Item[]
  readonly archived: readonly Item[]
}): ReactNode {
  return (
    <nav className="list" aria-label="Inbox items">
      <div className="scopes" role="group" aria-label="Scope">
        {scopes.map((each) => (
          <button key={each} type="button" className="scopes__scope" aria-pressed={each === scope} onClick={() => onScope(each)}>
            {scopeNames[each]} <span className="list__count">{countIn(each)}</span>
          </button>
        ))}
      </div>
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
