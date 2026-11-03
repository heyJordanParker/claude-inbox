import type { ReactNode } from 'react'
import { ago, closingOf, closedWord, current, emptyLine, kindName, personOf, revisedAt, scopeNames, senderOf, unseenOf, wording, type Item, type PersonFiles, type Scope, type Senders } from '../../../src/items/item.js'
import { Badge, Sender, Title } from './item.js'

type Rows = { readonly person: PersonFiles; readonly senders: Senders; readonly shownId: string | undefined; readonly onView: (id: string) => void }

function Row({ item, person, senders, shownId, onView }: Rows & { readonly item: Item }): ReactNode {
  const unseen = unseenOf(item, personOf(person, item))
  const closing = closingOf(item, personOf(person, item))
  const sender = senderOf(item.origin, item.project, senders)
  return (
    <li>
      <button type="button" className="row" aria-current={item.id === shownId ? 'true' : undefined} onClick={() => onView(item.id)}>
        <span className="row__meta">
          <span className="chip" data-tone="folded">
            {kindName(item)}
          </span>
          {closing === undefined ? null : (
            <span className="chip" data-tone="label">
              {closedWord(closing)}
            </span>
          )}
          {unseen === undefined || closing !== undefined ? null : <Badge unseen={unseen} />}
          <span className="row__from" title={sender.title}>
            from <Sender {...sender} />
          </span>
          <span className="row__when">{ago(closing?.at ?? revisedAt(item), Date.now())}</span>
        </span>
        <span className="row__title">
          <Title title={current(item).title} />
        </span>
      </button>
    </li>
  )
}

function Listed({ title, items, ...rows }: Rows & { readonly title: string; readonly items: readonly Item[] }): ReactNode {
  if (items.length === 0) return null
  return (
    <section className="list__group" aria-label={title}>
      <h2 className="list__heading">
        {title} <span className="list__count">{items.length}</span>
      </h2>
      <ul className="list__rows">
        {items.map((item) => (
          <Row key={item.id} item={item} {...rows} />
        ))}
      </ul>
    </section>
  )
}

export function List({ scopes, scope, openIn, onScope, waiting, withAgents, closed, ...rows }: Rows & {
  readonly scopes: readonly Scope[]
  readonly scope: Scope
  readonly openIn: (scope: Scope) => number
  readonly onScope: (scope: Scope) => void
  readonly waiting: readonly Item[]
  readonly withAgents: readonly Item[]
  readonly closed: readonly Item[]
}): ReactNode {
  return (
    <nav className="list" aria-label="Inbox items">
      <div className="scopes" role="group" aria-label="Scope">
        {scopes.map((each) => (
          <button key={each} type="button" className="scopes__scope" aria-pressed={each === scope} onClick={() => onScope(each)}>
            {scopeNames[each]} <span className="list__count">{openIn(each)}</span>
          </button>
        ))}
      </div>
      <Listed title={wording.waiting} items={waiting} {...rows} />
      <Listed title={wording.withAgents} items={withAgents} {...rows} />
      <Listed title={wording.closed} items={closed} {...rows} />
    </nav>
  )
}

export function Empty({ scope }: { readonly scope: Scope }): ReactNode {
  return (
    <article className="item" aria-label={emptyLine(scope)}>
      <header className="item__header">
        <h2 className="item__title">{emptyLine(scope)}</h2>
        <p className="part__aside">An agent's next proposal, choice, question, or report shows here as it arrives.</p>
      </header>
    </article>
  )
}
