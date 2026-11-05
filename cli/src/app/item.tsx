import { useEffect, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react'
import Markdown from 'react-markdown'
import { actionsOf, type Action, type Given } from '../../../src/items/answers.js'
import { kindOf } from '../../../src/items/drawings.js'
import { closedLine, closingLines, closingOf, current, earlierNotes, isWithAgent, kindName, noteOn, notePlaceholder, plural, precedentLine, senderOf, sentCorrections, unseenOf, wording, type CardStatus, type Drawing, type Idea, type Item, type Note, type Person, type Senders, type Thread } from '../../../src/items/item.js'
import { childrenOf, drawingPath, evidenceOf, evidencePath, foldedLine, foldKey, folds, headingOf, ideaPath, ideasOf, isDrawingUnchanged, isLeftOpen, isUnfolded, readingOf, rootGroups, summaryOf, titleOf, unseenAt, withRemoved, type Folds, type Node, type Part, type Reading } from '../../../src/items/tree.js'
import { DrawingSubject, DrawingView, type OpenFile } from './drawing.js'

export type ItemActions = {
  readonly answer: (given: Given) => Promise<boolean>
  readonly skip: () => Promise<void>
  readonly setNote: (path: string, words: string) => Promise<boolean>
  readonly dropNote: (note: Note) => void
  readonly toggleFold: (key: string, isOpen: boolean) => void
}

type Shared = Reading & {
  readonly editing: string | null
  readonly setEditing: (key: string | null) => void
  readonly actions: ItemActions
  readonly onFile: OpenFile
}

function keyOf(item: Item, path: string): string {
  return `${item.id}:${path}`
}

function toggleFold(shared: Shared, path: string, isFoldedAtFirst = false): void {
  shared.actions.toggleFold(foldKey(shared.item, path), !isUnfolded(shared, path, isFoldedAtFirst))
}

function Prose({ text }: { readonly text: string }): ReactNode {
  return (
    <div className="prose">
      <Markdown>{text.trim()}</Markdown>
    </div>
  )
}

type PartKind = 'goal' | 'problem' | 'solution' | 'option' | 'change'

function Chip({ tone, kind, part, children }: { readonly tone: 'label' | 'folded' | 'unseen' | 'removed'; readonly kind?: Item['kind']; readonly part?: PartKind | undefined; readonly children: ReactNode }): ReactNode {
  return (
    <span className="chip" data-tone={tone} data-kind={kind} data-part={part}>
      {children}
    </span>
  )
}

function partOf(node: Node): PartKind {
  if (node.type !== 'solution') return node.type
  return node.label === 'Option' ? 'option' : 'solution'
}

function Badge({ unseen }: { readonly unseen: 'new' | 'changed' | 'changed inside' }): ReactNode {
  return <Chip tone="unseen">{unseen}</Chip>
}

export function Title({ title }: { readonly title: string }): ReactNode {
  return title.split(/(\S+-\S+)/).map((part, index) =>
    index % 2 === 0 ? (
      part
    ) : (
      <span key={index} className="title__word">
        {part}
      </span>
    ),
  )
}

export function Sender({ title, color }: ReturnType<typeof senderOf>): ReactNode {
  return (
    <strong className="sender" data-color={color}>
      {title}
    </strong>
  )
}

function Mark({ shared, path }: { readonly shared: Shared; readonly path: string }): ReactNode {
  const unseen = unseenAt(shared, path)
  return unseen === undefined ? null : <Badge unseen={unseen} />
}

function Was({ shared, path }: { readonly shared: Shared; readonly path: string }): ReactNode {
  const was = shared.revised.was.get(path)
  return was === undefined ? null : <del className="was">{was}</del>
}

function removedPart(part: Part, path: string): ReactElement {
  return (
    <div key={`removed:${path}`} className="part" data-removed>
      <span className="part__marks">
        {part.kind === 'idea' ? null : <Chip tone="folded">{part.kind}</Chip>}
        <Chip tone="removed">{wording.removed}</Chip>
      </span>
      <del className="was">{part.words}</del>
    </div>
  )
}

type WordsFormProps = {
  readonly id: string
  readonly label: string
  readonly hotkey?: string
  readonly words: string
  readonly placeholder: string
  readonly submit: string
  readonly hint: string
  readonly onSend: (words: string) => Promise<boolean>
  readonly onCancel?: () => void
  readonly autoFocus?: boolean
  readonly ref?: Ref<HTMLTextAreaElement>
}

function WordsForm({ id, label, hotkey, words, placeholder, submit, hint, onSend, onCancel, autoFocus = false, ref }: WordsFormProps): ReactNode {
  const [text, setText] = useState(words)
  const [isSending, setIsSending] = useState(false)
  const sending = useRef(false)
  const send = async () => {
    if (sending.current) return
    sending.current = true
    setIsSending(true)
    const isSent = await onSend(text)
    sending.current = false
    setIsSending(false)
    if (isSent) setText('')
  }
  return (
    <form
      className="note-editor"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      <label className="note-editor__label" htmlFor={id}>
        {label}
        {hotkey === undefined ? null : <kbd className="button__key">{hotkey}</kbd>}
      </label>
      <textarea
        id={id}
        ref={ref}
        className="note-editor__words"
        rows={4}
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            void send()
          }
          if (event.key !== 'Escape') return
          if (onCancel === undefined) event.currentTarget.blur()
          else onCancel()
        }}
      />
      <span className="note-editor__actions">
        <button type="submit" className="button" data-primary disabled={isSending}>
          {submit}
        </button>
        {onCancel === undefined ? null : (
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <span className="note-editor__hint">{hint}</span>
      </span>
    </form>
  )
}

function NoteOn({ shared, path, label = wording.note }: { readonly shared: Shared; readonly path: string; readonly label?: string }): ReactNode {
  const key = keyOf(shared.item, path)
  const note = noteOn(shared.item, shared.person, path)
  if (shared.editing === key)
    return (
      <WordsForm
        id={`note:${key}`}
        label={label}
        words={note?.words ?? ''}
        placeholder={notePlaceholder(label)}
        submit="Save"
        hint="⌘↵ saves · Esc cancels"
        onSend={async (words) => {
          const isSaved = await shared.actions.setNote(path, words)
          if (isSaved) shared.setEditing(null)
          return isSaved
        }}
        onCancel={() => shared.setEditing(null)}
        autoFocus
      />
    )
  if (note === undefined) return null
  return (
    <button type="button" className="note" onClick={() => shared.setEditing(key)}>
      <span className="note__mark">✎</span> <em>{note.words}</em>
    </button>
  )
}

function NoteButton({ shared, path }: { readonly shared: Shared; readonly path: string }): ReactNode {
  const key = keyOf(shared.item, path)
  if (shared.editing === key || noteOn(shared.item, shared.person, path) !== undefined) return null
  return (
    <button type="button" className="note-button" aria-label="Write a note here" onClick={() => shared.setEditing(key)}>
      ✎
    </button>
  )
}

type HeadingProps = { readonly shared: Shared; readonly path: string; readonly part: PartKind; readonly label: string; readonly title: string; readonly summary: string; readonly precedent?: string | undefined; readonly status?: string | undefined }

function Heading({ shared, path, part, label, title, summary, precedent, status }: HeadingProps): ReactNode {
  const isOpen = isUnfolded(shared, path)
  const labeled = (
    <Chip tone={isOpen ? 'label' : 'folded'} part={part}>
      {label}
    </Chip>
  )
  return (
    <div className="part">
      <span className="part__marks">
        {folds(path) ? (
          <button type="button" className="fold" aria-expanded={isOpen} onClick={() => toggleFold(shared, path)}>
            {labeled}
          </button>
        ) : (
          labeled
        )}
        {status === undefined ? null : <Chip tone="label">{status}</Chip>}
        <Mark shared={shared} path={path} />
      </span>
      <NoteButton shared={shared} path={path} />
      <h3 className="part__title">{title}</h3>
      {precedent === undefined ? null : <p className="part__aside">{precedentLine(precedent)}</p>}
      <Was shared={shared} path={path} />
      {isOpen ? null : <p className="part__aside">{foldedLine(shared, path, summary)}</p>}
      <NoteOn shared={shared} path={path} />
    </div>
  )
}

function DrawingPart({ drawing, path, shared }: { readonly drawing: Drawing; readonly path: string; readonly shared: Shared }): ReactNode {
  const isFile = drawing.kind === 'files'
  const isOpen = isUnfolded(shared, path, isFile)
  return (
    <div className="drawing-part">
      <section className="drawing" data-open={isOpen}>
        <header className="drawing__header">
          <button type="button" className="fold" aria-expanded={isOpen} onClick={() => toggleFold(shared, path, isFile)}>
            <Chip tone={isOpen ? 'label' : 'folded'}>{kindOf(drawing)}</Chip>
          </button>
          <Mark shared={shared} path={path} />
          <DrawingSubject drawing={drawing} project={shared.item.project} onFile={shared.onFile} />
          {!isOpen && isDrawingUnchanged(shared, path) ? <span className="drawing__note">{wording.unchanged}</span> : null}
          <NoteButton shared={shared} path={path} />
        </header>
        {isOpen ? (
          <div className="drawing__body">
            <DrawingView drawing={drawing} onFile={shared.onFile} />
          </div>
        ) : null}
      </section>
      <NoteOn shared={shared} path={path} />
    </div>
  )
}

function Evidence({ node, shared }: { readonly node: Node; readonly shared: Shared }): ReactNode {
  const checks = evidenceOf(node)
  if (checks.length === 0) return null
  const path = evidencePath(node.path)
  const isOpen = isUnfolded(shared, path)
  return (
    <div className="part">
      <span className="part__marks">
        <button type="button" className="fold" aria-expanded={isOpen} onClick={() => toggleFold(shared, path)}>
          <Chip tone={isOpen ? 'label' : 'folded'}>{wording.evidence}</Chip>
        </button>
        <span className="part__aside">{plural(checks.length, 'check')}</span>
      </span>
      <NoteButton shared={shared} path={path} />
      {isOpen ? <Prose text={checks.map((check) => `- ${check.trim()}`).join('\n')} /> : null}
      <NoteOn shared={shared} path={path} />
    </div>
  )
}

function IdeaView({ idea, path, shared }: { readonly idea: Idea; readonly path: string; readonly shared: Shared }): ReactNode {
  return (
    <div className="idea">
      <div className="part">
        <span className="part__marks">
          <Mark shared={shared} path={path} />
        </span>
        <NoteButton shared={shared} path={path} />
        <Prose text={idea.idea} />
        <Was shared={shared} path={path} />
        <NoteOn shared={shared} path={path} />
      </div>
      {idea.drawing === undefined ? null : <DrawingPart drawing={idea.drawing} path={drawingPath(path)} shared={shared} />}
    </div>
  )
}

function Ideas({ ideas, parent, shared }: { readonly ideas: readonly Idea[]; readonly parent: string; readonly shared: Shared }): ReactNode {
  return (
    <div className="ideas">
      {withRemoved(
        shared,
        (index) => ideaPath(parent, index),
        ideas.map((idea, index) => <IdeaView key={ideaPath(parent, index)} idea={idea} path={ideaPath(parent, index)} shared={shared} />),
        removedPart,
      )}
    </div>
  )
}

function NodeView({ node, shared }: { readonly node: Node; readonly shared: Shared }): ReactNode {
  const precedent = node.type === 'solution' ? node.solution.precedent : undefined
  const status = isLeftOpen(node) ? wording.leftOpen : undefined
  const children = childrenOf(node)
  return (
    <section className="node" data-type={node.type}>
      <Heading shared={shared} path={node.path} part={partOf(node)} label={headingOf(node)} title={titleOf(node)} summary={summaryOf(node)} precedent={precedent} status={status} />
      {isUnfolded(shared, node.path) ? (
        <div className="node__body">
          {ideasOf(node).length === 0 ? null : <Ideas ideas={ideasOf(node)} parent={node.path} shared={shared} />}
          {node.type === 'change' && node.change.drawing !== undefined ? <DrawingPart drawing={node.change.drawing} path={drawingPath(node.path)} shared={shared} /> : null}
          <Evidence node={node} shared={shared} />
          {withRemoved(shared, () => `${node.path}.s`, [], removedPart)}
          {children
            .filter((child) => child.type === 'solution')
            .map((child) => (
              <NodeView key={child.path} node={child} shared={shared} />
            ))}
          {withRemoved(
            shared,
            (index) => `${node.path}.p${index}`,
            children.filter((child) => child.type === 'problem').map((child) => <NodeView key={child.path} node={child} shared={shared} />),
            removedPart,
          )}
        </div>
      ) : null}
    </section>
  )
}

function Section({ label, part, mark, children }: { readonly label: string; readonly part?: PartKind; readonly mark?: ReactNode; readonly children: ReactNode }): ReactNode {
  return (
    <section className="section">
      <span className="part__marks">
        <Chip tone="label" part={part}>
          {label}
        </Chip>
        {mark}
      </span>
      {children}
    </section>
  )
}

function Labeled({ shared, path, label, text }: { readonly shared: Shared; readonly path: string; readonly label: string; readonly text: string }): ReactNode {
  return (
    <div className="part lead">
      <NoteButton shared={shared} path={path} />
      <Section label={label} part="goal" mark={<Mark shared={shared} path={path} />}>
        <Prose text={text} />
        <Was shared={shared} path={path} />
        <NoteOn shared={shared} path={path} />
      </Section>
    </div>
  )
}

function Lead({ shared }: { readonly shared: Shared }): ReactNode {
  const content = current(shared.item)
  if (content.kind === 'question') return <Labeled shared={shared} path="why" label={wording.whyItMatters} text={content.why} />
  if (content.kind !== 'options') return <Labeled shared={shared} path="goal" label={wording.goal} text={content.goal} />
  return (
    <>
      <Labeled shared={shared} path="goal" label={wording.goal} text={content.goal} />
      <section className="node">
        <Heading shared={shared} path="problem" part="problem" label={wording.problem} title={content.problem.title} summary={plural(content.problem.ideas.length, 'idea')} />
        {isUnfolded(shared, 'problem') ? (
          <div className="node__body">
            <Ideas ideas={content.problem.ideas} parent="problem" shared={shared} />
          </div>
        ) : null}
      </section>
    </>
  )
}

function Sent({ item, person }: { readonly item: Item; readonly person: Person }): ReactNode {
  if (!isWithAgent(item, person)) return null
  return (
    <Section label={wording.sent}>
      <ul className="notes">
        {sentCorrections(item, person).map((correction) => (
          <li key={`${correction.revision}:${correction.path}`} className="note" data-static>
            <span className="note__mark">✎</span> <em>{`${correction.target}: ${correction.words}`}</em>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Closing({ item, person, senders }: { readonly item: Item; readonly person: Person; readonly senders: Senders }): ReactNode {
  const closing = closingOf(item, person)
  if (closing === undefined) return null
  return (
    <Section label={closedLine(closing, Date.now())}>
      {closingLines(item, closing, senders).map((line) => (
        <p key={line} className="prose">
          {line}
        </p>
      ))}
    </Section>
  )
}

type Linked = { readonly statusOf: (item: Item) => CardStatus | undefined; readonly onView: (id: string) => void }

function ThreadLinks({ items, statusOf, onView }: Linked & { readonly items: readonly Item[] }): ReactNode {
  return (
    <ul className="thread">
      {items.map((each) => {
        const status = statusOf(each)
        return (
          <li key={each.id}>
            <a className="thread__link" href={`/items/${encodeURIComponent(each.id)}${location.search}`} onClick={(event) => {
              event.preventDefault()
              onView(each.id)
            }}>
              <span className="thread__kind" data-kind={each.kind}>
                {kindName(each)}
              </span>
              <span className="thread__title">
                <Title title={current(each).title} />
              </span>
              {status === undefined ? null : <span className="thread__status">{status.word}</span>}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

function ThreadParts({ thread, ...linked }: Linked & { readonly thread: Thread }): ReactNode {
  return (
    <>
      {thread.deliveredBy === undefined ? null : (
        <Section label={wording.deliveredBy}>
          <ThreadLinks items={[thread.deliveredBy]} {...linked} />
        </Section>
      )}
      {thread.delivers.length === 0 ? null : (
        <Section label={wording.delivers}>
          <ThreadLinks items={thread.delivers} {...linked} />
        </Section>
      )}
    </>
  )
}

function EarlierNotes({ shared }: { readonly shared: Shared }): ReactNode {
  const earlier = earlierNotes(shared.item, shared.person)
  if (earlier.length === 0) return null
  return (
    <Section label={wording.earlierNotes}>
      <p className="part__aside">{wording.earlierNotesHint}</p>
      <ul className="notes">
        {earlier.map((note) => (
          <li key={`${note.revision}:${note.path}`}>
            <button type="button" className="note" aria-label={`Drop the note on ${note.target}`} onClick={() => shared.actions.dropNote(note)}>
              <span className="note__mark">✎</span> <em>{`${note.target}: ${note.words}`}</em>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function Actions({ shared, next }: { readonly shared: Shared; readonly next: Item | undefined }): ReactNode {
  const { item } = shared
  const commentKey = keyOf(item, '')
  const actions = actionsOf(item, shared.person, { hasNext: next !== undefined, isCommenting: shared.editing === commentKey })
  const answering = actions.find(({ does }) => does === 'answer')
  const answerBox = useRef<HTMLTextAreaElement>(null)
  const [isSending, setIsSending] = useState(false)
  const sending = useRef(false)
  const press = (action: Action) => {
    const { does } = action
    if (does === 'answer') return answerBox.current?.focus()
    if (does === 'comment') return shared.setEditing(commentKey)
    if (sending.current) return
    sending.current = true
    setIsSending(true)
    void (does === 'skip' ? shared.actions.skip() : shared.actions.answer(does)).finally(() => {
      sending.current = false
      setIsSending(false)
    })
  }
  const latest = useRef({ actions, press })
  latest.current = { actions, press }
  useEffect(() => {
    const pressed = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      const action = latest.current.actions.find((each) => each.hotkey === event.key)
      if (action === undefined) return
      event.preventDefault()
      latest.current.press(action)
    }
    document.addEventListener('keydown', pressed)
    return () => document.removeEventListener('keydown', pressed)
  }, [])
  if (actions.length === 0) return null
  return (
    <footer className="actions">
      {answering === undefined ? null : (
        <WordsForm
          id={`answer:${item.id}`}
          ref={answerBox}
          label={answering.label}
          {...(answering.hotkey === undefined ? {} : { hotkey: answering.hotkey })}
          words=""
          placeholder={wording.answerPlaceholder}
          submit="Send"
          hint="⌘↵ sends"
          onSend={(words) => shared.actions.answer({ kind: 'answer', words })}
        />
      )}
      <NoteOn shared={shared} path="" label={wording.comment} />
      <div className="actions__buttons">
        {actions.filter(({ does }) => does !== 'answer').map((action) => (
          <button key={action.id} type="button" className="button" data-primary={action.isPrimary} disabled={isSending && action.does !== 'comment'} title={action.id === 'next' && next !== undefined ? `${kindName(next)}: ${current(next).title}` : undefined} onClick={() => press(action)}>
            {action.label}
            {action.hotkey === undefined ? null : <kbd className="button__key">{action.hotkey}</kbd>}
          </button>
        ))}
      </div>
    </footer>
  )
}

export function ItemView({ item, person, senders, thread, statusOf, onView, place, next, folds: openFolds, editing, setEditing, actions, onFile }: Linked & { readonly item: Item; readonly person: Person; readonly senders: Senders; readonly thread: Thread; readonly place: string | undefined; readonly next: Item | undefined; readonly folds: Folds; readonly editing: string | null; readonly setEditing: (key: string | null) => void; readonly actions: ItemActions; readonly onFile: OpenFile }): ReactNode {
  const content = current(item)
  const shared: Shared = { ...readingOf(item, person, openFolds), editing, setEditing, actions, onFile }
  const unseen = unseenOf(item, person)
  return (
    <article className="item" aria-label={content.title}>
      <header className="item__header">
        <p className="item__meta">
          <Chip tone="label" kind={item.kind}>
            {kindName(item)}
          </Chip>
          {unseen === undefined ? null : <Badge unseen={unseen} />}
          <span>from</span>
          <Sender {...senderOf(item.origin, item.project, senders)} />
          {place === undefined ? null : <span>· {place}</span>}
        </p>
        <h2 className="item__title">
          <Title title={content.title} />
        </h2>
        <Was shared={shared} path="title" />
      </header>
      <div className="item__body">
        <Closing item={item} person={person} senders={senders} />
        <ThreadParts thread={thread} statusOf={statusOf} onView={onView} />
        <Sent item={item} person={person} />
        <EarlierNotes shared={shared} />
        <Lead shared={shared} />
        {rootGroups(content).flatMap(({ part, nodes }) =>
          withRemoved(
            shared,
            (index) => `${part}${index}`,
            nodes.map((node) => <NodeView key={node.path} node={node} shared={shared} />),
            removedPart,
          ),
        )}
      </div>
      <Actions shared={shared} next={next} />
    </article>
  )
}
