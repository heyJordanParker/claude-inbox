import type { RenderElement } from 'claude-code'
import type { Mod, PageInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Button, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { personIn, scoped, senderIn } from '../actions.js'
import { view } from '../answers.js'
import { chip } from '../components/chip.js'
import { Badge, Bar, Card, ItemView, Section, sender } from '../components/item.js'
import { ago, closedItems, closedWord, closingOf, current, emptyLine, isOpen, kindName, nextAfter, positionLine, queue, revisedAt, scopeNames, scopes, shownOf, unseenOf, withAgents, wording, type Item } from '../items/item.js'
import type { InboxState } from '../state.js'

function Scopes({ mod }: { readonly mod: Mod<InboxState> }): RenderElement {
  return (
    <Box columnGap={1} flexWrap="wrap" paddingLeft={2}>
      {scopes.map((scope) => (
        <Box key={`scope-area:${scope}`}>
          <Button plain key={`scope:${scope}`} hover={{ inverse: true }} onPress={() => void (mod.state.session.scope = scope)}>
            {chip(`${scopeNames[scope]} ${scoped(mod, scope).filter((item) => isOpen(item, personIn(mod, item))).length}`, scope === mod.state.session.scope ? 'selected' : 'folded')}
          </Button>
        </Box>
      ))}
    </Box>
  )
}

function Row({ mod, item, now }: { readonly mod: Mod<InboxState>; readonly item: Item; readonly now: number }): RenderElement {
  const person = personIn(mod, item)
  const unseen = unseenOf(item, person)
  const closing = closingOf(item, person)
  const open = () => void view(mod, item.id, true)
  return (
    <Card>
      <Box key={`row:${item.id}`} flexDirection="column" backgroundColor="subtle" paddingX={2}>
        <Button plain key={`view:${item.id}`} hover={{ inverse: true }} onPress={open}>
          {chip(kindName(item), 'folded')}
          {closing === undefined ? null : chip(closedWord(closing), 'label')}
          {unseen === undefined || closing !== undefined ? null : <Badge unseen={unseen} />}
          <Text dimColor> from </Text>
          {sender(senderIn(mod, item, item.origin))}
          <Text dimColor>{` · ${ago(closing?.at ?? revisedAt(item), now)}`}</Text>
        </Button>
        <Button plain key={`view-title:${item.id}`} hover={{ inverse: true }} onPress={open}>
          <Text bold wrap="truncate-end">
            {current(item).title}
          </Text>
        </Button>
      </Box>
    </Card>
  )
}

function Listed({ mod, title, items, shown }: { readonly mod: Mod<InboxState>; readonly title: string; readonly items: readonly Item[]; readonly shown: Item | undefined }): RenderElement | null {
  const rest = items.filter((item) => item.id !== shown?.id)
  if (rest.length === 0) return null
  const now = Date.now()
  return (
    <Box flexDirection="column" gap={1}>
      <Box paddingLeft={2}>{chip(`${title} ${rest.length}`, 'label')}</Box>
      <Box flexDirection="column">
        {rest.map((item) => (
          <Row mod={mod} item={item} now={now} />
        ))}
      </Box>
    </Box>
  )
}

function Empty({ mod }: { readonly mod: Mod<InboxState> }): RenderElement {
  return (
    <Card>
      <Bar>
        <Text bold>{emptyLine(mod.state.session.scope)}</Text>
      </Bar>
    </Card>
  )
}

type OpenInBrowser = (mod: Mod<InboxState>, id: string) => Promise<void>

function Shown({ mod, items, columns, onFile, onBrowser }: { readonly mod: Mod<InboxState>; readonly items: readonly Item[]; readonly columns: number; readonly onFile: (mod: Mod<InboxState>, project: string, path: string, diff: string | undefined) => Promise<void>; readonly onBrowser: OpenInBrowser }): RenderElement {
  const { person } = mod.state.memory
  const waiting = queue(items, person)
  const shown = shownOf(items, person, mod.state.session.viewing)
  return (
    <Box flexDirection="column" gap={2}>
      {shown === undefined ? (
        <Empty mod={mod} />
      ) : (
        <ItemView mod={mod} item={shown} place={positionLine(waiting, shown, personIn(mod, shown), Date.now())} columns={columns} onFile={(path, diff) => onFile(mod, shown.project, path, diff)} onBrowser={() => onBrowser(mod, shown.id)} next={nextAfter(waiting, shown)} />
      )}
      <Listed mod={mod} title={wording.waiting} items={waiting} shown={shown} />
      <Listed mod={mod} title={wording.withAgents} items={withAgents(items, person)} shown={shown} />
      <Listed mod={mod} title={wording.closed} items={closedItems(items, person).map(({ item }) => item)} shown={shown} />
    </Box>
  )
}

export function inboxPage(onFile: (mod: Mod<InboxState>, project: string, path: string, diff: string | undefined) => Promise<void>, onBrowser: OpenInBrowser): PageInit<InboxState> {
  return {
    id: 'inbox',
    title: 'Inbox',
    render: (mod, { columns }) => (
      <Box flexDirection="column" gap={1}>
        <Scopes mod={mod} />
        <Shown mod={mod} items={scoped(mod)} columns={columns} onFile={onFile} onBrowser={onBrowser} />
      </Box>
    ),
  }
}
