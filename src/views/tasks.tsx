import { sessions, type Mod, type View, type ViewInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Progress } from '../../node_modules/@cmodjs/core/ui/components.js'
import { Box, Button, Input, Text, type TextProps } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { countsIn, goalsIn } from '../actions.js'
import { Fold } from '../components/fold.js'
import { ProgressBlocks } from '../components/progress.js'
import { shownState, waitingOn, type Goals, type ShownState, type Task } from '../goals/goal.js'
import { current, elapsed, senderOf, type Item } from '../items/item.js'
import { act, correct, isUnfolded, reopen, submitField, toggleField, toggleUnfolded } from '../requirements.js'
import type { InboxState } from '../state.js'

type OpenItem = (mod: Mod<InboxState>, id: string) => unknown

type Focus = View['focus']

const wordColumns = 8

const indent = 2

const words: Readonly<Record<ShownState, string>> = { active: 'Active', 'waiting on you': 'Waiting', 'waiting after': 'Waiting', planned: 'Planned', done: 'Done', dropped: 'Dropped' }

const looks: Readonly<Record<ShownState, TextProps>> = { active: { bold: true }, 'waiting on you': { bold: true, color: 'claude' }, 'waiting after': { dimColor: true }, planned: { dimColor: true }, done: { color: 'success' }, dropped: { dimColor: true } }

function detailOf(goals: Goals, task: Task, state: ShownState, item: Item | undefined): string | undefined {
  if (item !== undefined) return `on you: ${current(item).title}`
  if (state === 'waiting after') return `after: ${goals.tasks.find((each) => each.id === task.after)?.title ?? task.after}`
  return undefined
}

function Aside({ mod, task, state, item, now, onOpen }: { readonly mod: Mod<InboxState>; readonly task: Task; readonly state: ShownState; readonly item: Item | undefined; readonly now: number; readonly onOpen: OpenItem }): JSX.Element | null {
  if (item !== undefined) return <Button key={`open:${task.id}`} label="Open" onPress={() => void onOpen(mod, item.id)} />
  if (state === 'waiting after') return null
  if (task.state === 'active') return <Text dimColor>{elapsed(task.startedAt, now)}</Text>
  if (task.state === 'done') return <Fold mod={mod} foldKey={`evidence:${task.id}`} label="✓ evidence" />
  if (task.state === 'dropped') return <Fold mod={mod} foldKey={`reason:${task.id}`} label="reason" />
  return null
}

function Corrections({ mod, task, focus }: { readonly mod: Mod<InboxState>; readonly task: Task; readonly focus: Focus }): JSX.Element {
  const field = `tasks:correct:${task.id}`
  return (
    <Box flexDirection="column">
      {task.corrections.map((each) => (
        <Text dimColor wrap="wrap">{`"${each.words}"`}</Text>
      ))}
      <Box>
        <Button key={`${field}:open`} label="Correct…" onPress={() => toggleField(mod, field, focus)} />
      </Box>
      {mod.state.session.openField === field ? (
        <Input key={field} placeholder="What to change, in your words" submitLabel="send" rows={3} onSubmit={(words) => submitField(mod, () => correct(mod, { task: task.id }, words))} />
      ) : null}
    </Box>
  )
}

function Unfolded({ mod, task }: { readonly mod: Mod<InboxState>; readonly task: Task }): JSX.Element | null {
  if (task.state === 'dropped') {
    return isUnfolded(mod, `reason:${task.id}`) ? (
      <Text dimColor wrap="wrap">
        {task.reason}
      </Text>
    ) : null
  }
  if (task.state !== 'done' || !isUnfolded(mod, `evidence:${task.id}`)) return null
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        {task.evidence.map((each) => (
          <Text wrap="wrap">{`• ${each}`}</Text>
        ))}
      </Box>
      <Box>
        <Button key={`reopen:${task.id}`} label="Reopen" onPress={() => void act(mod, () => reopen(mod, task.id))} />
      </Box>
    </Box>
  )
}

function TaskRow({ mod, goals, task, now, onOpen, focus }: { readonly mod: Mod<InboxState>; readonly goals: Goals; readonly task: Task; readonly now: number; readonly onOpen: OpenItem; readonly focus: Focus }): JSX.Element {
  const { items, person } = mod.state.memory
  const state = shownState(task, goals, items, person)
  const item = waitingOn(task, items, person)
  const detail = detailOf(goals, task, state, item)
  const foldKey = `task:${task.id}`
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" columnGap={2}>
        <Box columnGap={1} flexShrink={1}>
          <Box width={wordColumns} minWidth={wordColumns} flexShrink={0}>
            <Text {...looks[state]}>{words[state]}</Text>
          </Box>
          <Box key={`${foldKey}-area`} flexShrink={1}>
            <Button plain key={foldKey} hover={{ inverse: true }} onPress={() => toggleUnfolded(mod, foldKey)}>
              <Text wrap="wrap" dimColor={state === 'done' || state === 'dropped'}>
                {task.title}
              </Text>
            </Button>
          </Box>
        </Box>
        <Box flexShrink={0}>
          <Aside mod={mod} task={task} state={state} item={item} now={now} onOpen={onOpen} />
        </Box>
      </Box>
      <Box flexDirection="column" paddingLeft={wordColumns + 1}>
        {detail === undefined ? null : (
          <Text dimColor wrap="wrap">
            {detail}
          </Text>
        )}
        <Unfolded mod={mod} task={task} />
        {isUnfolded(mod, foldKey) ? <Corrections mod={mod} task={task} focus={focus} /> : null}
      </Box>
    </Box>
  )
}

function Header({ mod, goals, columns, now }: { readonly mod: Mod<InboxState>; readonly goals: Goals | undefined; readonly columns: number; readonly now: number }): JSX.Element {
  const { title } = senderOf({ session: sessions.current.id }, sessions.current.project, mod.state.memory.senders)
  const { done, tasks } = countsIn(mod)
  const [first] = (goals?.tasks ?? []).flatMap((task) => (task.state === 'planned' || task.startedAt === undefined ? [] : [task.startedAt])).sort()
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between" columnGap={2}>
        <Box flexShrink={1}>
          <Text bold wrap="truncate-end">{`Tasks · ${title}`}</Text>
        </Box>
        {tasks === 0 ? null : <Text dimColor>{[`${done} of ${tasks} done`, ...(first === undefined ? [] : [elapsed(first, now)])].join(' · ')}</Text>}
      </Box>
      {tasks === 0 ? null : <Progress value={(done / tasks) * 100} width={columns} />}
    </Box>
  )
}

export function tasksView(onOpen: OpenItem, focus: Focus): ViewInit<InboxState> {
  return {
    id: 'tasks',
    title: 'Tasks',
    render: (mod, { columns }) => {
      const goals = goalsIn(mod)
      const blocks = mod.state.memory.progress?.blocks ?? []
      const now = Date.now()
      return (
        <Box flexDirection="column" gap={1}>
          <Header mod={mod} goals={goals} columns={columns} now={now} />
          {goals === undefined || goals.tasks.length === 0 ? (
            <Text dimColor wrap="wrap">
              No tasks yet. They show here as Claude plans the work.
            </Text>
          ) : (
            <Box flexDirection="column">
              {goals.tasks.map((task) => (
                <TaskRow mod={mod} goals={goals} task={task} now={now} onOpen={onOpen} focus={focus} />
              ))}
            </Box>
          )}
          {blocks.length === 0 ? null : (
            <Box flexDirection="column">
              <Text bold>Progress</Text>
              <Box paddingLeft={indent}>
                <ProgressBlocks blocks={blocks} columns={columns - indent} />
              </Box>
            </Box>
          )}
        </Box>
      )
    },
  }
}
