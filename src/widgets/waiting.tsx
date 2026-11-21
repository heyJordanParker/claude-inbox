import { AbovePrompt, Dashboard, type WidgetInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Button } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { deliveriesIn, personIn, scoped } from '../actions.js'
import { isUnread, queue, wording } from '../items/item.js'
import type { InboxState } from '../state.js'

export function waitingWidget(onOpen: () => Promise<void>): WidgetInit<InboxState> {
  return {
    id: 'waiting',
    title: 'Inbox count',
    areas: [AbovePrompt, Dashboard],
    render: (mod) => {
      const listed = queue(scoped(mod), mod.state.memory.person, mod.state.memory.senders, deliveriesIn(mod))
      if (listed.length === 0) return undefined
      const unread = listed.filter((item) => isUnread(item, personIn(mod, item))).length
      return <Button plain key="open-inbox" label={`${wording.inbox} ${listed.length}${unread === 0 ? '' : ` · ${unread} ${wording.unread}`}`} onPress={onOpen} />
    },
  }
}
