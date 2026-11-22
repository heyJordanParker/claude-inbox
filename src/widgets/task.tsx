import { sessions, Working, type WidgetInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Button, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { countsIn } from '../actions.js'
import { tasksIn } from '../gates.js'
import { elapsed } from '../items/item.js'
import type { InboxState } from '../state.js'

export function taskWidget(onOpen: () => Promise<void>): WidgetInit<InboxState> {
  return {
    id: 'active-task',
    title: 'Active task',
    areas: [Working],
    place: { size: 'fill' },
    render: (mod) => {
      const [active] = tasksIn(mod)
        .flatMap(({ goals, task, state }) => (state === 'active' && task.state === 'active' && task.owner === sessions.current.id ? [{ goals, task }] : []))
        .sort((a, b) => b.task.startedAt.localeCompare(a.task.startedAt))
      if (active === undefined) return undefined
      const { task, goals } = active
      const { done, tasks } = countsIn(mod, goals.session)
      const line = [task.title, elapsed(task.startedAt, Date.now()), `${done} of ${tasks}`].join(' · ')
      return (
        <Button plain key="open-tasks" onPress={onOpen}>
          <Text wrap="truncate-end">{line}</Text>
        </Button>
      )
    },
  }
}
