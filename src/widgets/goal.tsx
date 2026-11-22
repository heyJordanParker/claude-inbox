import { BelowPrompt, type Mod, type WidgetInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Button, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { countsIn, goalsIn, goalTextIn } from '../actions.js'
import type { InboxState } from '../state.js'

function goalLine(mod: Mod<InboxState>): string | undefined {
  const goal = goalTextIn(mod)
  if (goalsIn(mod) === undefined && goal === '') return undefined
  const { met, requirements, waitingOnYou } = countsIn(mod)
  return [`Goal: ${goal === '' ? 'not set' : goal}`, ...(requirements === 0 ? [] : [`${met} of ${requirements} met`]), ...(waitingOnYou === 0 ? [] : [`${waitingOnYou} waits on you`])].join(' · ')
}

export function goalWidget(onOpen: () => Promise<void>): WidgetInit<InboxState> {
  return {
    id: 'goal-summary',
    title: 'Goal and requirements met',
    areas: [BelowPrompt],
    place: { size: 'fill' },
    render: (mod) => {
      const line = goalLine(mod)
      if (line === undefined) return undefined
      return (
        <Button plain key="open-goal" onPress={onOpen}>
          <Text wrap="truncate-end">{line}</Text>
        </Button>
      )
    },
  }
}
