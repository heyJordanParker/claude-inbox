import type { RenderElement } from 'claude-code'
import type { Mod, PageInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Button, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { ItemView } from '../components/item.js'
import { current, queue, withAgents, type Item } from '../inbox.js'
import type { InboxState } from '../state.js'

function Waiting({ mod, items, shown }: { readonly mod: Mod<InboxState>; readonly items: readonly Item[]; readonly shown: Item }): RenderElement {
  const rest = items.filter((item) => item.id !== shown.id)
  if (rest.length === 0) return <Text dimColor>Nothing else waits.</Text>
  return (
    <Box flexDirection="column">
      <Text bold>Waiting</Text>
      {rest.map((item) => (
        <Button plain key={`view:${item.id}`} label={`${item.origin.title} · ${item.kind} · ${current(item).title}`} onPress={() => void (mod.state.memory.viewing = item.id)} />
      ))}
    </Box>
  )
}

function Revising({ items }: { readonly items: readonly Item[] }): RenderElement | null {
  if (items.length === 0) return null
  return (
    <Box flexDirection="column">
      <Text bold>Being revised</Text>
      {items.map((item) => (
        <Text dimColor wrap="wrap">{`${item.origin.title} · ${current(item).title}`}</Text>
      ))}
    </Box>
  )
}

export function inboxPage(onFile: (mod: Mod<InboxState>, project: string, path: string) => void): PageInit<InboxState> {
  return {
    id: 'inbox',
    title: 'Inbox',
    render: (mod) => {
      const waiting = queue(mod.state.memory.items)
      const revising = withAgents(mod.state.memory.items)
      const shown = waiting.find((item) => item.id === mod.state.memory.viewing) ?? waiting[0]
      if (shown === undefined)
        return (
          <Box flexDirection="column" gap={1}>
            <Text dimColor>The inbox is empty.</Text>
            <Revising items={revising} />
          </Box>
        )
      return (
        <Box flexDirection="column" gap={1}>
          <ItemView mod={mod} item={shown} position={waiting.indexOf(shown) + 1} count={waiting.length} onFile={(path) => onFile(mod, shown.project, path)} />
          <Text dimColor>{'─'.repeat(24)}</Text>
          <Waiting mod={mod} items={waiting} shown={shown} />
          <Revising items={revising} />
        </Box>
      )
    },
  }
}
