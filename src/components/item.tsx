import type { RenderChildren, RenderElement } from 'claude-code'
import type { Mod, Page } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Button, Input, Markdown, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { Tooltip } from '../../node_modules/@cmodjs/core/ui/components.js'
import { deliveriesIn, personIn, senderIn } from '../actions.js'
import { answer, answerInputKey, dropNote, follow, noteInputKey, setEditing, setNote, setTyped, skip } from '../answers.js'
import { actionsOf, type Action } from '../items/answers.js'
import { kindOf } from '../items/drawings.js'
import { closedLine, closingLines, closingOf, current, earlierNotes, isWithAgent, kindName, noteOn, notePlaceholder, plural, precedentLine, revisionOf, sentCorrections, threadOf, threadStatusOf, unseenOf, wording, type Drawing, type Idea, type Item, type Person, type Sender, type Unseen } from '../items/item.js'
import { childrenOf, drawingPath, evidenceOf, evidencePath, foldedLine, foldKey, folds, headingOf, ideaPath, ideasOf, isDrawingUnchanged, isLeftOpen, isUnfolded, readingOf, rootGroups, summaryOf, titleOf, unseenAt, withRemoved, type Node, type Part, type Reading } from '../items/tree.js'
import type { InboxState } from '../state.js'
import { chip } from './chip.js'
import { DrawingView, drawingSubject, type OpenFile } from './drawing.js'

type Shared = Reading & {
  readonly mod: Mod<InboxState>
  readonly onFile: OpenFile
  readonly focus: Page['focus']
  readonly drawingColumns: number
}

const frameColumns = 10

const noteRoom = 3

function keyOf(item: Item, path: string): string {
  return `${item.id}:${path}`
}

function toggleFold(shared: Shared, path: string, startsFolded = false): void {
  shared.mod.state.session.folds = { ...shared.mod.state.session.folds, [foldKey(shared.item, path)]: !isUnfolded(shared, path, startsFolded) }
}

async function toggleNote(shared: Shared, key: string): Promise<void> {
  const opened = shared.mod.state.session.editing === key ? null : key
  setEditing(shared.mod, opened)
  if (opened !== null) await shared.focus(noteInputKey(opened))
}

function Typed({ text }: { readonly text: string | undefined }): RenderElement | null {
  return text === undefined || text === '' ? null : <Text wrap="wrap">{text}</Text>
}

function NoteReveal({ shared, noteKey, right = 0 }: { readonly shared: Shared; readonly noteKey: string; readonly right?: number }): RenderElement {
  return (
    <Box position="absolute" right={right} top={0} display="none" hover={{ display: 'flex' }}>
      <Button plain key={`note:${noteKey}`} onPress={() => toggleNote(shared, noteKey)}>
        <Text color="suggestion">✎</Text>
      </Button>
    </Box>
  )
}

function Note({ shared, path, label = wording.note }: { readonly shared: Shared; readonly path: string; readonly label?: string }): RenderElement | null {
  const { mod, item, person } = shared
  const key = keyOf(item, path)
  const note = noteOn(item, person, path)
  if (mod.state.session.editing === key) {
    const inputKey = noteInputKey(key)
    return (
      <Box flexDirection="column">
        <Text bold>{label}</Text>
        <Typed text={mod.state.session.typed[inputKey] ?? note?.words} />
        <Input
          key={inputKey}
          placeholder={notePlaceholder(label)}
          submitLabel="save"
          rows={4}
          {...(note === undefined ? {} : { value: note.words })}
          onInput={(words) => setTyped(mod, inputKey, words)}
          onSubmit={async (words) => {
            if (await setNote(mod, item, path, words)) setEditing(mod, null)
          }}
        />
      </Box>
    )
  }
  if (note === undefined) return null
  return (
    <Button plain key={`edit:${key}`} onPress={() => toggleNote(shared, key)}>
      <Text color="suggestion">✎ </Text>
      <Text italic>{note.words}</Text>
    </Button>
  )
}

const sessionColors: Readonly<Record<string, string>> = { red: '#ff6b80', blue: '#5f87ff', green: '#5fd787', yellow: '#ffd75f', purple: '#af87ff', orange: '#ff8700', pink: '#ff87d7', cyan: '#5fd7d7' }

export function sender({ title, color: named }: Sender): RenderElement {
  const color = named === undefined ? undefined : sessionColors[named]
  return (
    <Text bold {...(color === undefined ? {} : { color })}>
      {title}
    </Text>
  )
}

const listLine = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

type Segment = { readonly isList: boolean; readonly lines: string[]; readonly isSpaced: boolean }

function segmentsOf(text: string): Segment[] {
  if (text.includes('```')) return [{ isList: false, lines: [text], isSpaced: false }]
  const segments: Segment[] = []
  let isAfterBlank = false
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      isAfterBlank = true
      continue
    }
    const last = segments.at(-1)
    const isList = listLine.test(line) || (last?.isList === true && !isAfterBlank && /^\s/.test(line))
    if (last !== undefined && last.isList === isList && !isAfterBlank) last.lines.push(line)
    else segments.push({ isList, lines: [line], isSpaced: isAfterBlank && last !== undefined })
    isAfterBlank = false
  }
  return segments
}

type ListItem = { readonly depth: number; readonly marker: string; readonly text: string }

function listItems(lines: readonly string[]): ListItem[] {
  const items: { depth: number; marker: string; lines: string[] }[] = []
  const indents: number[] = []
  for (const line of lines) {
    const match = listLine.exec(line)
    if (match === null) {
      items.at(-1)?.lines.push(line.trim())
      continue
    }
    const [, space = '', marker = '', text = ''] = match
    while (indents.length > 0 && (indents.at(-1) ?? 0) > space.length) indents.pop()
    if (indents.at(-1) !== space.length) indents.push(space.length)
    items.push({ depth: indents.length - 1, marker: /\d/.test(marker) ? marker : '•', lines: [text] })
  }
  return items.map(({ depth, marker, lines: words }) => ({ depth, marker, text: words.join('\n') }))
}

function Prose({ text, partKey }: { readonly text: string; readonly partKey: string }): RenderElement {
  return (
    <Box flexDirection="column">
      {segmentsOf(text.trim()).map((segment, n) => (
        <Box key={`segment:${partKey}:${n}`} flexDirection="column" marginTop={segment.isSpaced ? 1 : 0}>
          {segment.isList ? (
            listItems(segment.lines).map((each, m) => (
              <Box key={`item:${partKey}:${n}:${m}`} paddingLeft={each.depth * 2} columnGap={1}>
                <Text>{each.marker}</Text>
                <Box flexDirection="column" flexShrink={1}>
                  <Markdown key={`text:${partKey}:${n}:${m}`} text={each.text} />
                </Box>
              </Box>
            ))
          ) : (
            <Markdown key={`text:${partKey}:${n}`} text={segment.lines.join('\n')} />
          )}
        </Box>
      ))}
    </Box>
  )
}

function Badge({ unseen }: { readonly unseen: Unseen | 'changed inside' }): RenderElement {
  return chip(unseen, 'unseen')
}

function Mark({ shared, path }: { readonly shared: Shared; readonly path: string }): RenderElement | null {
  const unseen = unseenAt(shared, path)
  return unseen === undefined ? null : <Badge unseen={unseen} />
}

function RemovedPart({ part, space }: { readonly part: Part; readonly space: number }): RenderElement {
  return (
    <Box flexDirection="column" marginTop={space} paddingRight={noteRoom}>
      <Box columnGap={1} flexWrap="wrap">
        {part.kind === 'idea' ? null : chip(part.kind, 'folded')}
        {chip(wording.removed, 'unseen')}
      </Box>
      <Text dimColor strikethrough wrap="wrap">
        {part.words}
      </Text>
    </Box>
  )
}

function removedSpaced(space: number): (part: Part) => RenderElement {
  return (part) => <RemovedPart part={part} space={space} />
}

function Was({ shared, path }: { readonly shared: Shared; readonly path: string }): RenderElement | null {
  const was = shared.revised.was.get(path)
  return was === undefined ? null : (
    <Text dimColor strikethrough wrap="wrap">
      {was}
    </Text>
  )
}

type HeadingProps = {
  readonly shared: Shared
  readonly path: string
  readonly label: string
  readonly title: string
  readonly summary: string
  readonly precedent?: string | undefined
  readonly status?: string | undefined
}

function Heading({ shared, path, label, title, summary, precedent, status }: HeadingProps): RenderElement {
  const { item } = shared
  const key = keyOf(item, path)
  const isOpen = isUnfolded(shared, path)
  const labeled = chip(label, isOpen ? 'label' : 'folded')
  return (
    <Box key={`heading:${key}`} flexDirection="column" paddingRight={noteRoom}>
      <Box columnGap={1} flexWrap="wrap">
        {folds(path) ? (
          <Button plain key={`fold:${key}`} hover={{ inverse: true }} onPress={() => toggleFold(shared, path)}>
            {labeled}
          </Button>
        ) : (
          labeled
        )}
        {status === undefined ? null : chip(status, 'label')}
        <Mark shared={shared} path={path} />
      </Box>
      <Text bold underline wrap="wrap">
        {title}
      </Text>
      {precedent === undefined ? null : (
        <Text dimColor wrap="wrap">
          {precedentLine(precedent)}
        </Text>
      )}
      <Was shared={shared} path={path} />
      {isOpen ? null : (
        <Text dimColor wrap="wrap">
          {foldedLine(shared, path, summary)}
        </Text>
      )}
      <Note shared={shared} path={path} />
      <NoteReveal shared={shared} noteKey={key} />
    </Box>
  )
}

function DrawingPart({ drawing, path, shared }: { readonly drawing: Drawing; readonly path: string; readonly shared: Shared }): RenderElement {
  const { item } = shared
  const key = keyOf(item, path)
  const keyPrefix = `drawing:${key}`
  const isFile = drawing.kind === 'files'
  const isOpen = isUnfolded(shared, path, isFile)
  return (
    <Box flexDirection="column">
      <Box key={`panel:${key}`} flexDirection="column" borderStyle="round" borderColor="inactive" hover={{ borderColor: 'text' }}>
        <Box columnGap={1} backgroundColor="subtle" paddingLeft={1} paddingRight={noteRoom} flexWrap="wrap">
          <Button plain key={`fold:${key}`} onPress={() => toggleFold(shared, path, isFile)}>
            {chip(kindOf(drawing), isOpen ? 'label' : 'folded')}
          </Button>
          <Mark shared={shared} path={path} />
          {[...drawingSubject(drawing, item.project, keyPrefix, shared.onFile), ...(!isOpen && isDrawingUnchanged(shared, path) ? [<Text dimColor>{wording.unchanged}</Text>] : [])].flatMap((part, index) => (index === 0 ? [part] : [<Text dimColor>·</Text>, part]))}
          <NoteReveal shared={shared} noteKey={key} right={1} />
        </Box>
        {isOpen ? (
          <Box flexDirection="column" paddingX={1} paddingY={1}>
            <DrawingView drawing={drawing} columns={shared.drawingColumns} keyPrefix={keyPrefix} onFile={shared.onFile} />
          </Box>
        ) : null}
      </Box>
      <Note shared={shared} path={path} />
    </Box>
  )
}

function Evidence({ node, shared }: { readonly node: Node; readonly shared: Shared }): RenderElement | null {
  const checks = evidenceOf(node)
  if (checks.length === 0) return null
  const { item } = shared
  const path = evidencePath(node.path)
  const key = keyOf(item, path)
  const isOpen = isUnfolded(shared, path)
  return (
    <Box key={`evidence:${key}`} flexDirection="column" paddingRight={noteRoom}>
      <Box columnGap={1} flexWrap="wrap">
        <Button plain key={`fold:${key}`} hover={{ inverse: true }} onPress={() => toggleFold(shared, path)}>
          {chip(wording.evidence, isOpen ? 'label' : 'folded')}
        </Button>
        <Text dimColor>{plural(checks.length, 'check')}</Text>
      </Box>
      {isOpen ? (
        <Box flexDirection="column" marginTop={1}>
          <Prose text={checks.map((check) => `- ${check.trim()}`).join('\n')} partKey={key} />
        </Box>
      ) : null}
      <Note shared={shared} path={path} />
      <NoteReveal shared={shared} noteKey={key} />
    </Box>
  )
}

function IdeaView({ idea, path, shared }: { readonly idea: Idea; readonly path: string; readonly shared: Shared }): RenderElement {
  const key = keyOf(shared.item, path)
  return (
    <Box flexDirection="column">
      <Box key={`idea:${key}`} flexDirection="column" paddingRight={noteRoom}>
        <Mark shared={shared} path={path} />
        <Prose text={idea.idea} partKey={key} />
        <Was shared={shared} path={path} />
        <Note shared={shared} path={path} />
        <NoteReveal shared={shared} noteKey={key} />
      </Box>
      {idea.drawing === undefined ? null : <DrawingPart drawing={idea.drawing} path={drawingPath(path)} shared={shared} />}
    </Box>
  )
}

function Ideas({ ideas, parent, shared }: { readonly ideas: readonly Idea[]; readonly parent: string; readonly shared: Shared }): RenderElement {
  return (
    <Box flexDirection="column" gap={1}>
      {withRemoved(
        shared,
        (index) => ideaPath(parent, index),
        ideas.map((idea, index) => <IdeaView idea={idea} path={ideaPath(parent, index)} shared={shared} />),
        removedSpaced(0),
      )}
    </Box>
  )
}

const partSpace = 2

function NodeView({ node, shared }: { readonly node: Node; readonly shared: Shared }): RenderElement {
  const precedent = node.type === 'solution' ? node.solution.precedent : undefined
  const status = isLeftOpen(node) ? wording.leftOpen : undefined
  const children = childrenOf(node)
  const view = (child: Node) => <NodeView node={child} shared={shared} />
  return (
    <Box flexDirection="column" key={`node:${keyOf(shared.item, node.path)}`} marginTop={partSpace}>
      <Heading shared={shared} path={node.path} label={headingOf(node)} title={titleOf(node)} summary={summaryOf(node)} precedent={precedent} status={status} />
      {isUnfolded(shared, node.path) ? (
        <Box flexDirection="column" marginTop={1}>
          <Box flexDirection="column" gap={1}>
            {ideasOf(node).length === 0 ? null : <Ideas ideas={ideasOf(node)} parent={node.path} shared={shared} />}
            {node.type === 'change' && node.change.drawing !== undefined ? <DrawingPart drawing={node.change.drawing} path={drawingPath(node.path)} shared={shared} /> : null}
            <Evidence node={node} shared={shared} />
          </Box>
          {withRemoved(shared, () => `${node.path}.s`, [], removedSpaced(partSpace))}
          {children.filter((child) => child.type === 'solution').map(view)}
          {withRemoved(shared, (index) => `${node.path}.p${index}`, children.filter((child) => child.type === 'problem').map(view), removedSpaced(partSpace))}
        </Box>
      ) : null}
    </Box>
  )
}

function Section({ label, mark, children }: { readonly label: string; readonly mark?: RenderChildren; readonly children: RenderChildren }): RenderElement {
  return (
    <Box flexDirection="column">
      <Box columnGap={1} flexWrap="wrap">
        {chip(label, 'label')}
        {mark}
      </Box>
      {children}
    </Box>
  )
}

function Labeled({ shared, path, label, text, status }: { readonly shared: Shared; readonly path: string; readonly label: string; readonly text: string; readonly status?: RenderElement }): RenderElement {
  const key = keyOf(shared.item, path)
  return (
    <Box key={`lead:${key}`} flexDirection="column" paddingRight={noteRoom}>
      <Section label={label} mark={[status ?? null, <Mark shared={shared} path={path} />]}>
        <Prose text={text} partKey={key} />
        <Was shared={shared} path={path} />
        <Note shared={shared} path={path} />
      </Section>
      <NoteReveal shared={shared} noteKey={key} />
    </Box>
  )
}

function Lead({ shared }: { readonly shared: Shared }): RenderElement {
  const content = current(shared.item)
  if (content.kind === 'question') return <Labeled shared={shared} path="why" label={wording.whyItMatters} text={content.why} />
  if (content.kind !== 'options') return <Labeled shared={shared} path="goal" label={wording.goal} text={content.goal} />
  return (
    <Box flexDirection="column">
      <Labeled shared={shared} path="goal" label={wording.goal} text={content.goal} />
      <Box flexDirection="column" marginTop={2}>
        <Heading shared={shared} path="problem" label={wording.problem} title={content.problem.title} summary={plural(content.problem.ideas.length, 'idea')} />
        {isUnfolded(shared, 'problem') ? (
          <Box flexDirection="column" marginTop={1}>
            <Ideas ideas={content.problem.ideas} parent="problem" shared={shared} />
          </Box>
        ) : null}
      </Box>
    </Box>
  )
}

function Sent({ item, person }: { readonly item: Item; readonly person: Person }): RenderElement | null {
  if (!isWithAgent(item, person)) return null
  return (
    <Section label={wording.sent}>
      {sentCorrections(item, person).map((correction) => (
        <Text wrap="wrap">
          <Text color="suggestion">✎ </Text>
          <Text italic>{`${correction.target}: ${correction.words}`}</Text>
        </Text>
      ))}
    </Section>
  )
}

function Closing({ mod, item, person }: { readonly mod: Mod<InboxState>; readonly item: Item; readonly person: Person }): RenderElement | null {
  const closing = closingOf(item, person)
  if (closing === undefined) return null
  return (
    <Section label={closedLine(closing, Date.now())}>
      {closingLines(item, closing, mod.state.memory.senders).map((line) => (
        <Text wrap="wrap">{line}</Text>
      ))}
    </Section>
  )
}

function ThreadLink({ mod, from, to }: { readonly mod: Mod<InboxState>; readonly from: Item; readonly to: Item }): RenderElement {
  const status = threadStatusOf(to, personIn(mod, to), mod.state.memory.senders, deliveriesIn(mod))
  return (
    <Box key={`thread-area:${from.id}:${to.id}`}>
      <Button plain key={`thread:${from.id}:${to.id}`} hover={{ inverse: true }} onPress={() => follow(mod, to.id)}>
        <Text dimColor>{`${kindName(to)} · `}</Text>
        <Text color="suggestion" wrap="wrap">
          {current(to).title}
        </Text>
        {status === undefined ? null : <Text dimColor>{` · ${status.word}`}</Text>}
      </Button>
    </Box>
  )
}

function Thread({ mod, item }: { readonly mod: Mod<InboxState>; readonly item: Item }): RenderElement | null {
  const { deliveredBy, delivers } = threadOf(item, mod.state.memory.items, deliveriesIn(mod))
  if (deliveredBy === undefined && delivers.length === 0) return null
  return (
    <Box flexDirection="column" gap={partSpace}>
      {deliveredBy === undefined ? null : (
        <Section label={wording.deliveredBy}>
          <ThreadLink mod={mod} from={item} to={deliveredBy} />
        </Section>
      )}
      {delivers.length === 0 ? null : (
        <Section label={wording.delivers}>
          {delivers.map((each) => (
            <ThreadLink mod={mod} from={item} to={each} />
          ))}
        </Section>
      )}
    </Box>
  )
}

function EarlierNotes({ mod, item, person }: { readonly mod: Mod<InboxState>; readonly item: Item; readonly person: Person }): RenderElement | null {
  const earlier = earlierNotes(item, person)
  if (earlier.length === 0) return null
  return (
    <Section label={wording.earlierNotes}>
      <Text dimColor wrap="wrap">
        {wording.earlierNotesHint}
      </Text>
      {earlier.map((note) => (
        <Button plain key={`drop:${item.id}:${note.revision}:${note.path}`} onPress={() => dropNote(mod, item, note)}>
          <Text color="suggestion">✎ </Text>
          <Text italic>{`${note.target}: ${note.words}`}</Text>
        </Button>
      ))}
    </Section>
  )
}

function actionButton(action: Action, onPress: () => void | Promise<void>): RenderElement {
  return (
    <Button key={action.id} {...(action.hotkey === undefined ? {} : { hotkey: action.hotkey })} onPress={onPress}>
      <Text {...(action.isPrimary ? { color: 'claude' } : {})}>{action.label}</Text>
      {action.hotkey === undefined ? null : <Text dimColor>{`  ${action.hotkey}`}</Text>}
    </Button>
  )
}

function Actions({ shared, next }: { readonly shared: Shared; readonly next: Item | undefined }): RenderElement {
  const { mod, item, person } = shared
  const seen = revisionOf(item)
  const commentKey = keyOf(item, '')
  const answerKey = keyOf(item, 'answer')
  const answerInput = answerInputKey(item.id)
  const actions = actionsOf(item, person, { hasNext: next !== undefined, isCommenting: mod.state.session.editing === commentKey })
  const answering = actions.find(({ does }) => does === 'answer')
  const buttons = actions.map((action) => {
    const { does } = action
    if (does === 'answer') return null
    if (does === 'comment') return actionButton(action, () => toggleNote(shared, commentKey))
    if (does !== 'skip') return actionButton(action, () => answer(mod, item.id, seen, does))
    return next === undefined ? null : <Tooltip text={`${kindName(next)}: ${current(next).title}`}>{actionButton(action, () => skip(mod, item, seen, next.id))}</Tooltip>
  })
  return (
    <Box flexDirection="column" gap={1}>
      {answering === undefined ? null : (
        <Box flexDirection="column" alignItems="flex-start">
          {actionButton(answering, () => {
            setEditing(mod, answerKey)
            return shared.focus(answerInput)
          })}
          <Typed text={mod.state.session.typed[answerInput]} />
          <Input key={answerInput} placeholder={wording.answerPlaceholder} submitLabel="send" rows={4} onInput={(words) => setTyped(mod, answerInput, words)} onSubmit={(words) => answer(mod, item.id, seen, { kind: 'answer', words })} />
        </Box>
      )}
      <Note shared={shared} path="" label={wording.comment} />
      <Box gap={1} flexWrap="wrap">
        {buttons}
      </Box>
    </Box>
  )
}

export function Bar({ children }: { readonly children: RenderChildren }): RenderElement {
  return (
    <Box flexDirection="column" gap={1} backgroundColor="subtle" paddingX={2} paddingY={1}>
      {children}
    </Box>
  )
}

export function Card({ children }: { readonly children: RenderChildren }): RenderElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="inactive" width="100%">
      {children}
    </Box>
  )
}

export function ItemView({ mod, item, place, columns, onFile, onBrowser, focus, next }: { readonly mod: Mod<InboxState>; readonly item: Item; readonly place: string | undefined; readonly columns: number; readonly onFile: OpenFile; readonly onBrowser: () => Promise<void>; readonly focus: Page['focus']; readonly next: Item | undefined }): RenderElement {
  const content = current(item)
  const person = personIn(mod, item)
  const shared: Shared = { ...readingOf(item, person, mod.state.session.folds), mod, onFile, focus, drawingColumns: columns - frameColumns }
  const unseen = unseenOf(item, person)
  const itemKey = keyOf(item, '')
  return (
    <Card>
      <Box key={`card:${itemKey}`} flexDirection="column" gap={1} backgroundColor="subtle" paddingX={2} paddingY={1}>
        <Box columnGap={2}>
          <Text wrap="wrap">
            {chip(kindName(item), 'label')}
            {unseen === undefined ? null : <Text> <Badge unseen={unseen} /></Text>}
            {' from '}
            {sender(senderIn(mod, item, item.origin))}
            {place === undefined ? null : ` · ${place}`}
          </Text>
          <Box flexShrink={0}>
            <Button key="browser" hotkey="o" onPress={() => void onBrowser()}>
              <Text color="suggestion">Open in browser</Text>
              <Text dimColor>{'  o'}</Text>
            </Button>
          </Box>
        </Box>
        <Box flexDirection="column">
          <Text bold wrap="wrap">
            {content.title}
          </Text>
          <Was shared={shared} path="title" />
        </Box>
      </Box>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Box flexDirection="column" gap={partSpace}>
          <Closing mod={mod} item={item} person={person} />
          <Thread mod={mod} item={item} />
          <Sent item={item} person={person} />
          <EarlierNotes mod={mod} item={item} person={person} />
          <Lead shared={shared} />
        </Box>
        {rootGroups(content).flatMap(({ part, nodes }) =>
          withRemoved(
            shared,
            (index) => `${part}${index}`,
            nodes.map((node) => <NodeView node={node} shared={shared} />),
            removedSpaced(partSpace),
          ),
        )}
      </Box>
      <Bar>
        <Actions shared={shared} next={next} />
      </Bar>
    </Card>
  )
}
