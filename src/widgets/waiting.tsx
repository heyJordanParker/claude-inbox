import { AbovePrompt, Dashboard, type WidgetInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Button } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { personIn, scoped } from '../actions.js'
import { queue, unseenOf, type Unseen } from '../items/item.js'
import type { InboxState } from '../state.js'

export function waitingWidget(onOpen: () => Promise<void>): WidgetInit<InboxState> {
  return {
    id: 'waiting',
    title: 'Inbox items waiting',
    areas: [AbovePrompt, Dashboard],
    render: (mod) => {
      const waiting = queue(scoped(mod), mod.state.memory.person)
      if (waiting.length === 0) return undefined
      const counted = (unseen: Unseen) => {
        const count = waiting.filter((item) => unseenOf(item, personIn(mod, item)) === unseen).length
        return count === 0 ? '' : ` · ${count} ${unseen}`
      }
      return <Button plain key="open-inbox" label={`Inbox ${waiting.length}${counted('new')}${counted('changed')}`} onPress={onOpen} />
    },
  }
}
