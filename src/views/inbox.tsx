import type { Mod, View, ViewInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Button, Select, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { Tabs } from '../../node_modules/@cmodjs/core/ui/components.js'
import { answer, back, clearSelected, doneSelected, filterKind, filterScope, readSelected, selectAll, selectedIn, toggleSelected, view } from '../answers.js'
import { deliveriesIn, listedIn, personIn, scoped, senderIn, shownIn } from '../actions.js'
import { ItemView, sender } from '../components/item.js'
import { ago, archive, cardStatusOf, cardTime, current, emptyLine, isUnread, kindName, kinds, kindTabNames, needsAnswer, nextAfter, ofKind, plural, positionLine, queue, revisionOf, scopeNames, scopes, threadLine, wording, type Item, type Kind, type Scope } from '../items/item.js'
import type { InboxState } from '../state.js'

const checkColumns = 4

function check(isChecked: boolean): string {
  return isChecked ? '[x]' : '[ ]'
}

function ScopeMenu({ mod }: { readonly mod: Mod<InboxState> }): JSX.Element {
  const { person, senders } = mod.state.memory
  const count = (scope: Scope) => queue(scoped(mod, scope), person, senders, deliveriesIn(mod)).length
  return <Select key="scope" options={scopes.map((scope) => ({ value: scope, label: `${scopeNames[scope]} ${count(scope)}` }))} value={mod.state.session.scope} onSelect={(value) => filterScope(mod, value as Scope)} />
}

function KindTabs({ mod }: { readonly mod: Mod<InboxState> }): JSX.Element {
  const { person, senders } = mod.state.memory
  const all = queue(scoped(mod), person, senders, deliveriesIn(mod))
  const { kind } = mod.state.session
  const shown = kinds.filter((each) => each === kind || all.some((item) => item.kind === each))
  const tabs = [{ key: 'all', label: `${wording.all} ${all.length}` }, ...shown.map((each) => ({ key: each, label: `${kindTabNames[each]} ${ofKind(all, each).length}` }))]
  return <Tabs tabs={tabs} selected={kind ?? 'all'} onSelect={(key) => filterKind(mod, key === 'all' ? null : (key as Kind))} />
}

function SelectAll({ mod, listed }: { readonly mod: Mod<InboxState>; readonly listed: readonly Item[] }): JSX.Element | null {
  if (listed.length === 0) return null
  return (
    <Box key="select-all-area">
      <Button plain key="select-all" hover={{ inverse: true }} onPress={() => selectAll(mod, true)}>
        <Text dimColor>{`${check(false)} ${wording.selectAll}`}</Text>
      </Button>
    </Box>
  )
}

function Selection({ mod, chosen }: { readonly mod: Mod<InboxState>; readonly chosen: readonly Item[] }): JSX.Element {
  const reports = chosen.filter((item) => item.kind === 'report').length
  return (
    <Box columnGap={3} flexWrap="wrap">
      <Box key="select-none-area">
        <Button plain key="select-none" hover={{ inverse: true }} onPress={() => clearSelected(mod)}>
          <Text bold>{`${check(true)} ${chosen.length} ${wording.selected}`}</Text>
        </Button>
      </Box>
      {reports === 0 ? null : (
        <Button key="done-selected" hotkey="e" onPress={() => doneSelected(mod)}>
          <Text color="claude">{`${wording.done} ${plural(reports, 'report')}`}</Text>
          <Text dimColor>{'  e'}</Text>
        </Button>
      )}
      <Button key="read-selected" hotkey="i" onPress={() => readSelected(mod)}>
        <Text>{wording.markRead}</Text>
        <Text dimColor>{'  i'}</Text>
      </Button>
    </Box>
  )
}

type OpenInBrowser = (mod: Mod<InboxState>, id: string | null) => Promise<void>

function BrowserButton({ mod, id, onBrowser }: { readonly mod: Mod<InboxState>; readonly id: string | null; readonly onBrowser: OpenInBrowser }): JSX.Element {
  return (
    <Button key="browser" hotkey="o" onPress={() => void onBrowser(mod, id)}>
      <Text color="suggestion">Open in browser</Text>
      <Text dimColor>{'  o'}</Text>
    </Button>
  )
}

function Header({ mod, listed, onBrowser }: { readonly mod: Mod<InboxState>; readonly listed: readonly Item[]; readonly onBrowser: OpenInBrowser }): JSX.Element {
  const chosen = selectedIn(mod)
  return (
    <Box flexDirection="column" gap={1} paddingX={1}>
      {chosen.length > 0 ? (
        <Selection mod={mod} chosen={chosen} />
      ) : (
        <Box justifyContent="space-between" columnGap={2} flexWrap="wrap">
          <Box columnGap={2} flexWrap="wrap">
            <ScopeMenu mod={mod} />
            <SelectAll mod={mod} listed={listed} />
          </Box>
          <BrowserButton mod={mod} id={null} onBrowser={onBrowser} />
        </Box>
      )}
      <KindTabs mod={mod} />
    </Box>
  )
}

function Row({ mod, item, isArchived, now }: { readonly mod: Mod<InboxState>; readonly item: Item; readonly isArchived: boolean; readonly now: number }): JSX.Element {
  const person = personIn(mod, item)
  const deliveries = deliveriesIn(mod)
  const status = cardStatusOf(item, person, mod.state.memory.senders, deliveries)
  const thread = threadLine(item)
  const isNew = !isArchived && isUnread(item, person)
  const isSelected = mod.state.session.selected.includes(item.id)
  const open = () => void view(mod, item.id, true)
  const meta = [status?.word, thread].filter((part) => part !== undefined)
  const isDoneable = !isArchived && item.kind === 'report'
  return (
    <Box key={`row:${item.id}`} flexDirection="column" paddingX={1} hover={{ backgroundColor: 'subtle' }} {...(isSelected ? { backgroundColor: 'subtle' } : {})}>
      <Box justifyContent="space-between" columnGap={1}>
        <Box columnGap={1} flexShrink={1}>
          {isArchived ? (
            <Text>{' '.repeat(checkColumns - 1)}</Text>
          ) : (
            <Button plain key={`select:${item.id}`} hover={{ bold: true }} onPress={() => toggleSelected(mod, item.id)}>
              <Text dimColor={!isSelected}>{check(isSelected)}</Text>
            </Button>
          )}
          <Button plain key={`view:${item.id}`} onPress={open}>
            <Text color="suggestion">{isNew ? '● ' : '  '}</Text>
            <Text bold={needsAnswer(item) && !isArchived} {...(needsAnswer(item) && !isArchived ? { color: 'claude' } : { dimColor: true })}>
              {kindName(item)}
            </Text>
            <Text dimColor> · </Text>
            {sender(senderIn(mod, item, item.origin))}
            {meta.length === 0 ? null : <Text dimColor>{` · ${meta.join(' · ')}`}</Text>}
          </Button>
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>{ago(cardTime(item, person, deliveries), now)}</Text>
        </Box>
        {isDoneable ? (
          <Box position="absolute" right={0} top={0} display="none" hover={{ display: 'flex' }} backgroundColor="subtle" paddingLeft={1}>
            <Button plain key={`done:${item.id}`} hover={{ inverse: true }} onPress={() => answer(mod, item.id, revisionOf(item), { kind: 'acknowledge' })}>
              <Text color="claude">{wording.done}</Text>
            </Button>
          </Box>
        ) : null}
      </Box>
      <Box paddingLeft={checkColumns + 2}>
        <Button plain key={`view-title:${item.id}`} onPress={open}>
          <Text bold={isNew} dimColor={isArchived} wrap="wrap">
            {current(item).title}
          </Text>
        </Button>
      </Box>
    </Box>
  )
}

function Rows({ mod, items, isArchived }: { readonly mod: Mod<InboxState>; readonly items: readonly Item[]; readonly isArchived: boolean }): JSX.Element {
  const now = Date.now()
  return (
    <Box flexDirection="column" gap={1}>
      {items.map((item) => (
        <Row mod={mod} item={item} isArchived={isArchived} now={now} />
      ))}
    </Box>
  )
}

function Archive({ mod, items }: { readonly mod: Mod<InboxState>; readonly items: readonly Item[] }): JSX.Element | null {
  if (items.length === 0) return null
  const isOpen = mod.state.session.isArchiveOpen
  return (
    <Box flexDirection="column" gap={1}>
      <Box key="archive-area" paddingLeft={1}>
        <Button plain key="archive" hover={{ inverse: true }} onPress={() => void (mod.state.session.isArchiveOpen = !isOpen)}>
          <Text dimColor>{`${isOpen ? '▾' : '▸'} ${wording.archive} ${items.length}`}</Text>
        </Button>
      </Box>
      {isOpen ? <Rows mod={mod} items={items} isArchived /> : null}
    </Box>
  )
}

function Empty({ mod }: { readonly mod: Mod<InboxState> }): JSX.Element {
  return (
    <Box flexDirection="column" alignItems="center" paddingY={1}>
      <Text bold color="success">{`✓ ${wording.inboxZero}`}</Text>
      <Text wrap="wrap">{emptyLine(mod.state.session.scope)}</Text>
      <Text dimColor wrap="wrap">{wording.emptyHint}</Text>
    </Box>
  )
}

function ListView({ mod, onBrowser }: { readonly mod: Mod<InboxState>; readonly onBrowser: OpenInBrowser }): JSX.Element {
  const { person, senders } = mod.state.memory
  const listed = listedIn(mod)
  const archived = ofKind(archive(scoped(mod), person, senders, deliveriesIn(mod)), mod.state.session.kind)
  return (
    <Box flexDirection="column" gap={1}>
      <Header mod={mod} listed={listed} onBrowser={onBrowser} />
      {listed.length === 0 ? <Empty mod={mod} /> : <Rows mod={mod} items={listed} isArchived={false} />}
      <Archive mod={mod} items={archived} />
    </Box>
  )
}

type OpenFile = (mod: Mod<InboxState>, project: string, path: string, diff: string | undefined) => Promise<void>

function ItemPage({ mod, shown, columns, onFile, onBrowser, focus }: { readonly mod: Mod<InboxState>; readonly shown: Item; readonly columns: number; readonly onFile: OpenFile; readonly onBrowser: OpenInBrowser; readonly focus: View['focus'] }): JSX.Element {
  const listed = listedIn(mod)
  return (
    <Box flexDirection="column" gap={1}>
      <Box justifyContent="space-between" columnGap={2} paddingX={1}>
        <Button key="back" hotkey="u" onPress={() => back(mod)}>
          <Text>{`← ${wording.inbox}`}</Text>
          <Text dimColor>{'  u'}</Text>
        </Button>
        <BrowserButton mod={mod} id={shown.id} onBrowser={onBrowser} />
      </Box>
      <ItemView mod={mod} item={shown} place={positionLine(listed, shown, personIn(mod, shown), deliveriesIn(mod), Date.now())} columns={columns} onFile={(path, diff) => onFile(mod, shown.project, path, diff)} focus={focus} next={nextAfter(listed, shown)} />
    </Box>
  )
}

export function inboxView(onFile: OpenFile, onBrowser: OpenInBrowser, focus: View['focus']): ViewInit<InboxState> {
  return {
    id: 'inbox',
    title: wording.inbox,
    render: (mod, { columns }) => {
      const shown = shownIn(mod)
      return shown === undefined ? <ListView mod={mod} onBrowser={onBrowser} /> : <ItemPage mod={mod} shown={shown} columns={columns} onFile={onFile} onBrowser={onBrowser} focus={focus} />
    },
  }
}
