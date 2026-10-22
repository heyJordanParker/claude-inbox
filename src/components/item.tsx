import type { RenderElement } from 'claude-code'
import type { Mod } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Button, Input, Markdown, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { answer, later } from '../answers.js'
import { current, type Item } from '../inbox.js'
import type { InboxState } from '../state.js'
import { changedPaths, changesInside, childrenOf, rootsOf, titlePath, type Node } from '../tree.js'
import { DrawingView, drawingLabel } from './drawing.js'

type Shared = {
  readonly mod: Mod<InboxState>
  readonly item: Item
  readonly changed: ReadonlySet<string>
  readonly onFile: (path: string) => void
}

function keyOf(item: Item, path: string): string {
  return `${item.id}:${path}`
}

function toggle(mod: Mod<InboxState>, key: string): void {
  const { opened } = mod.state.memory
  mod.state.memory.opened = opened.includes(key) ? opened.filter((each) => each !== key) : [...opened, key]
}

function headline(node: Node): { readonly label: string; readonly summary: string } {
  if (node.type === 'problem') return { label: `Problem: ${node.problem.title}`, summary: node.problem.summary }
  if (node.type === 'solution') return { label: `${node.label}: ${node.solution.title}${node.solution.precedent === undefined ? '' : ` (${node.solution.precedent})`}`, summary: node.solution.summary }
  return { label: drawingLabel(node.drawing), summary: '' }
}

function Correction({ mod, item, path }: { readonly mod: Mod<InboxState>; readonly item: Item; readonly path: string }): RenderElement {
  const key = keyOf(item, path)
  if (mod.state.memory.correcting !== key)
    return <Button plain dimColor key={`correct:${key}`} label="Correct this" onPress={() => void (mod.state.memory.correcting = key)} />
  const target = titlePath(current(item), path)
  return (
    <Input
      key={`words:${key}`}
      label={`Correct ${target}`}
      placeholder="your words"
      submitLabel="send"
      autoFocus
      onSubmit={(words) => void answer(mod, item.id, { kind: 'correct', words, target })}
    />
  )
}

function NodeView({ node, shared }: { readonly node: Node; readonly shared: Shared }): RenderElement {
  const { mod, item, changed, onFile } = shared
  const key = keyOf(item, node.path)
  const isOpen = mod.state.memory.opened.includes(key)
  const { label, summary } = headline(node)
  const mark = changed.has(node.path) ? '  · changed' : changesInside(changed, node.path) ? '  · changed inside' : ''
  const header = `${isOpen ? '▾' : '▸'} ${label}${summary === '' ? '' : ` — ${summary}`}${mark}`
  return (
    <Box flexDirection="column" key={`node:${key}`}>
      <Button plain key={`toggle:${key}`} label={header} onPress={() => toggle(mod, key)} />
      {isOpen ? (
        <Box flexDirection="column" marginLeft={2} gap={1}>
          {node.type === 'problem' ? <Text wrap="wrap">{`Blocks: ${node.problem.impact}`}</Text> : null}
          {node.type === 'solution' ? <Markdown text={node.solution.idea} /> : null}
          {node.type === 'solution' ? (
            <Box flexDirection="column">
              <Text bold>Capabilities</Text>
              {node.solution.capabilities.map((capability) => (
                <Text wrap="wrap">{`• ${capability}`}</Text>
              ))}
            </Box>
          ) : null}
          {node.type === 'drawing' ? <DrawingView drawing={node.drawing} keyPrefix={`drawing:${key}`} onFile={onFile} /> : null}
          {childrenOf(node).map((child) => (
            <NodeView node={child} shared={shared} />
          ))}
          <Correction mod={mod} item={item} path={node.path} />
        </Box>
      ) : null}
    </Box>
  )
}

function Actions({ mod, item }: { readonly mod: Mod<InboxState>; readonly item: Item }): RenderElement {
  const content = current(item)
  const whole = keyOf(item, '')
  const asking = mod.state.memory.correcting === whole
  const later_ = <Button key="later" hotkey="l" label="Later" onPress={() => void later(mod, item.id)} />
  const withdraw = <Button key="withdraw" hotkey="w" label="Withdraw" onPress={() => void answer(mod, item.id, { kind: 'withdraw' })} />
  const open = (kind: 'correct' | 'answer') => <Button key={kind} hotkey={kind === 'correct' ? 'c' : 'a'} label={kind === 'correct' ? 'Correct…' : 'Answer…'} onPress={() => void (mod.state.memory.correcting = whole)} />
  const buttons =
    content.kind === 'question'
      ? [open('answer'), later_, withdraw]
      : content.kind === 'proposal'
        ? [<Button key="approve" hotkey="a" label="Approve" onPress={() => void answer(mod, item.id, { kind: 'approve' })} />, open('correct'), later_, withdraw]
        : [
            ...content.options.map((option, index) => (
              <Button key={`option${index}`} hotkey={index < 9 ? `${index + 1}` : undefined} label={`Option ${index + 1}`} onPress={() => void answer(mod, item.id, { kind: 'option', option: option.title })} />
            )),
            open('correct'),
            later_,
            withdraw,
          ]
  return (
    <Box flexDirection="column" gap={1}>
      {asking ? (
        <Input
          key="words"
          label={content.kind === 'question' ? 'Answer' : 'Correct'}
          placeholder="your words"
          submitLabel="send"
          autoFocus
          onSubmit={(words) => void answer(mod, item.id, content.kind === 'question' ? { kind: 'answer', words } : { kind: 'correct', words })}
        />
      ) : null}
      <Box gap={1} flexWrap="wrap">
        {buttons}
      </Box>
    </Box>
  )
}

export function ItemView({ mod, item, position, count, onFile }: { readonly mod: Mod<InboxState>; readonly item: Item; readonly position: number; readonly count: number; readonly onFile: (path: string) => void }): RenderElement {
  const content = current(item)
  const read = item.lastRead < 0 ? undefined : item.revisions[item.lastRead]?.content
  const changed = item.lastRead === item.revisions.length - 1 ? new Set<string>() : changedPaths(read, content)
  const shared: Shared = { mod, item, changed, onFile }
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold wrap="wrap">{content.title}</Text>
        <Text dimColor>{`${item.origin.title} · ${item.kind} · ${position} of ${count}${changed.size > 0 ? ' · changed since you read it' : ''}`}</Text>
      </Box>
      {content.kind === 'question' ? <Text wrap="wrap">{content.why}</Text> : <Text wrap="wrap">{`Goal: ${content.goal}${changed.has('goal') ? '  · changed' : ''}`}</Text>}
      {content.kind === 'options' ? (
        <Box flexDirection="column">
          <Text bold wrap="wrap">{`Problem: ${content.problem.title}${changed.has('problem') ? '  · changed' : ''}`}</Text>
          <Text wrap="wrap">{content.problem.summary}</Text>
          <Text dimColor wrap="wrap">{`Blocks: ${content.problem.impact}`}</Text>
        </Box>
      ) : null}
      {rootsOf(content).length > 0 ? (
        <Box flexDirection="column">
          {rootsOf(content).map((node) => (
            <NodeView node={node} shared={shared} />
          ))}
        </Box>
      ) : null}
      <Text dimColor wrap="wrap">{`Subscribed: ${item.subscribers.map((each) => each.title).join(', ') || 'nobody'}`}</Text>
      <Actions mod={mod} item={item} />
    </Box>
  )
}
