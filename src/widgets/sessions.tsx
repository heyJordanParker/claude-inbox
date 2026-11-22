import { Dashboard, type Mod, type WidgetInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Text, type TextProps } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { countsIn, goalTextIn } from '../actions.js'
import { senderOf } from '../items/item.js'
import type { InboxState } from '../state.js'

const widestTitle = 16

const indent = 2

const gap = 2

type Row = { readonly session: string; readonly title: string; readonly goal: string; readonly met: string; readonly status: string; readonly look: TextProps }

function rowsOf(mod: Mod<InboxState>): Row[] {
  const { goals, senders, goalTexts } = mod.state.memory
  return [...new Set([...Object.keys(goalTexts), ...Object.keys(goals)])]
    .filter((session) => senders[session]?.isRunning === true && (goalTextIn(mod, session) !== '' || goals[session] !== undefined))
    .sort((a, b) => (goals[b]?.updatedAt ?? '').localeCompare(goals[a]?.updatedAt ?? ''))
    .map((session) => {
      const filed = goals[session]
      const { met, requirements, waitingOnYou } = countsIn(mod, session)
      const isDone = requirements > 0 && met === requirements
      return {
        session,
        title: senderOf({ session }, filed?.project ?? '', senders).title,
        goal: goalTextIn(mod, session),
        met: filed === undefined ? '' : `${met} of ${requirements}`,
        status: filed === undefined ? '' : waitingOnYou > 0 ? `${waitingOnYou} waits on you` : isDone ? 'done' : '',
        look: waitingOnYou > 0 ? { color: 'claude' } : { color: 'success' },
      }
    })
}

function widthOf(rows: readonly Row[], cell: (row: Row) => string): number {
  return Math.max(0, ...rows.map((row) => cell(row).length))
}

function Cell({ width, children }: { readonly width: number; readonly children: JSX.Children }): JSX.Element {
  return (
    <Box width={width} minWidth={width} flexShrink={0}>
      {children}
    </Box>
  )
}

export const sessionsWidget: WidgetInit<InboxState> = {
  id: 'sessions',
  title: 'Sessions',
  areas: [Dashboard],
  place: { size: 'fill' },
  render: (mod, { columns }) => {
    const rows = rowsOf(mod)
    if (rows.length === 0) return undefined
    const title = Math.min(widestTitle, widthOf(rows, (row) => row.title))
    const met = widthOf(rows, (row) => row.met)
    const status = widthOf(rows, (row) => row.status)
    const cells = 2 + (met === 0 ? 0 : 1) + (status === 0 ? 0 : 1)
    const goal = Math.max(1, columns - indent - title - met - status - gap * (cells - 1))
    return (
      <Box flexDirection="column">
        <Text bold>Sessions</Text>
        <Box flexDirection="column" paddingLeft={indent}>
          {rows.map((row) => (
            <Box key={`session:${row.session}`} columnGap={gap}>
              <Cell width={title}>
                <Text bold wrap="truncate-end">
                  {row.title}
                </Text>
              </Cell>
              <Cell width={goal}>
                <Text wrap="truncate-end" dimColor={row.goal === ''}>
                  {row.goal === '' ? 'No goal yet' : row.goal}
                </Text>
              </Cell>
              {met === 0 ? null : (
                <Cell width={met}>
                  <Text>{row.met}</Text>
                </Cell>
              )}
              {status === 0 ? null : (
                <Cell width={status}>
                  <Text {...row.look}>{row.status}</Text>
                </Cell>
              )}
            </Box>
          ))}
        </Box>
      </Box>
    )
  },
}
