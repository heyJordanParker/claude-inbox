import type { RenderElement } from 'claude-code'
import type { Mod, Page, PageInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Button, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { personIn, scoped, senderIn } from '../actions.js'
import { view } from '../answers.js'
import { chip } from '../components/chip.js'
import { ItemView, sender } from '../components/item.js'
import { ago, archive, cardStatusOf, cardTime, current, emptyLine, kindName, nextAfter, positionLine, queue, scopeNames, scopes, shownOf, wording, type Item } from '../items/item.js'
import type { InboxState } from '../state.js'

function Scopes({ mod }: { readonly mod: Mod<InboxState> }): RenderElement {
  return (
    <Box columnGap={1} flexWrap="wrap" paddingLeft={2}>
      {scopes.map((scope) => (
        <Box key={`scope-area:${scope}`}>
          <Button plain key={`scope:${scope}`} hover={{ inverse: true }} onPress={() => void (mod.state.session.scope = scope)}>
            {chip(`${scopeNames[scope]} ${queue(scoped(mod, scope), mod.state.memory.person, mod.state.memory.senders).length}`, scope === mod.state.session.scope ? 'selected' : 'folded')}
          </Button>
        </Box>
      ))}
    </Box>
  )
}

function ItemCard({ mod, item, isArchived, now }: { readonly mod: Mod<InboxState>; readonly item: Item; readonly isArchived: boolean; readonly now: number }): RenderElement {
  const person = personIn(mod, item)
  const status = cardStatusOf(item, person, mod.state.memory.senders)
  const open = () => void view(mod, item.id, true)
  return (
    <Box key={`card:${item.id}`} flexDirection="column" width="100%" paddingX={1} borderStyle="round" borderColor="inactive" borderDimColor={isArchived} hover={{ borderColor: 'suggestion' }} {...(isArchived ? {} : { backgroundColor: 'subtle' })}>
      <Button plain key={`view:${item.id}`} hover={{ inverse: true }} onPress={open}>
        {chip(kindName(item), isArchived ? 'archived' : 'folded')}
        {status === undefined ? null : <Text> {chip(status.word, status.tone)}</Text>}
        <Text dimColor> from </Text>
        {sender(senderIn(mod, item, item.origin))}
        <Text dimColor>{` · ${ago(cardTime(item, person), now)}`}</Text>
      </Button>
      <Button plain key={`view-title:${item.id}`} hover={{ inverse: true }} onPress={open}>
        <Text bold={!isArchived} dimColor={isArchived} wrap="truncate-end">
          {current(item).title}
        </Text>
      </Button>
    </Box>
  )
}

function Cards({ mod, items, isArchived }: { readonly mod: Mod<InboxState>; readonly items: readonly Item[]; readonly isArchived: boolean }): RenderElement {
  const now = Date.now()
  return (
    <Box flexDirection="column">
      {items.map((item) => (
        <ItemCard mod={mod} item={item} isArchived={isArchived} now={now} />
      ))}
    </Box>
  )
}

function Archive({ mod, items }: { readonly mod: Mod<InboxState>; readonly items: readonly Item[] }): RenderElement | null {
  if (items.length === 0) return null
  const isOpen = mod.state.session.isArchiveOpen
  return (
    <Box flexDirection="column" gap={1}>
      <Box paddingLeft={2}>
        <Button plain key="archive" hover={{ inverse: true }} onPress={() => void (mod.state.session.isArchiveOpen = !isOpen)}>
          <Text dimColor>{`${isOpen ? '▾' : '▸'} ${wording.archive} ${items.length}`}</Text>
        </Button>
      </Box>
      {isOpen ? <Cards mod={mod} items={items} isArchived /> : null}
    </Box>
  )
}

function Empty({ mod }: { readonly mod: Mod<InboxState> }): RenderElement {
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Text bold color="success">{`✓ ${wording.inboxZero}`}</Text>
      <Text wrap="wrap">{emptyLine(mod.state.session.scope)}</Text>
      <Text dimColor wrap="wrap">{wording.emptyHint}</Text>
    </Box>
  )
}

type OpenInBrowser = (mod: Mod<InboxState>, id: string) => Promise<void>

function Shown({ mod, items, columns, onFile, onBrowser, focus }: { readonly mod: Mod<InboxState>; readonly items: readonly Item[]; readonly columns: number; readonly onFile: (mod: Mod<InboxState>, project: string, path: string, diff: string | undefined) => Promise<void>; readonly onBrowser: OpenInBrowser; readonly focus: Page['focus'] }): RenderElement {
  const { person, senders } = mod.state.memory
  const listed = queue(items, person, senders)
  const shown = shownOf(items, person, senders, mod.state.session.viewing)
  const folded = (each: readonly Item[]) => each.filter((item) => item.id !== shown?.id)
  return (
    <Box flexDirection="column" gap={2}>
      {shown === undefined ? (
        <Empty mod={mod} />
      ) : (
        <ItemView mod={mod} item={shown} place={positionLine(listed, shown, personIn(mod, shown), Date.now())} columns={columns} onFile={(path, diff) => onFile(mod, shown.project, path, diff)} onBrowser={() => onBrowser(mod, shown.id)} focus={focus} next={nextAfter(listed, shown)} />
      )}
      <Cards mod={mod} items={folded(listed)} isArchived={false} />
      <Archive mod={mod} items={folded(archive(items, person, senders))} />
    </Box>
  )
}

export function inboxPage(onFile: (mod: Mod<InboxState>, project: string, path: string, diff: string | undefined) => Promise<void>, onBrowser: OpenInBrowser, focus: Page['focus']): PageInit<InboxState> {
  return {
    id: 'inbox',
    title: 'Inbox',
    render: (mod, { columns }) => (
      <Box flexDirection="column" gap={1}>
        <Scopes mod={mod} />
        <Shown mod={mod} items={scoped(mod)} columns={columns} onFile={onFile} onBrowser={onBrowser} focus={focus} />
      </Box>
    ),
  }
}
