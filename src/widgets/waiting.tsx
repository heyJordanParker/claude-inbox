import { AbovePrompt, Dashboard, type WidgetInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Button } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { queue } from '../inbox.js'
import type { InboxState } from '../state.js'

export function waitingWidget(onOpen: () => void): WidgetInit<InboxState> {
  return {
    id: 'waiting',
    title: 'Inbox items waiting',
    areas: [AbovePrompt, Dashboard],
    render: (mod) => {
      const count = queue(mod.state.memory.items).length
      if (count === 0) return undefined
      return <Button plain key="open-inbox" label={`inbox: ${count} waiting`} onPress={onOpen} />
    },
  }
}
