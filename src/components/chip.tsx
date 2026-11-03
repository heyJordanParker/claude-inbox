import type { RenderElement } from 'claude-code'
import { Text } from '../../node_modules/@cmodjs/core/ui/elements.js'

export type Tone = 'selected' | 'label' | 'folded' | 'unseen'

const tones: Readonly<Record<Tone, { readonly color: string; readonly backgroundColor: string }>> = {
  selected: { color: 'inverseText', backgroundColor: 'text' },
  label: { color: 'inverseText', backgroundColor: 'inactive' },
  folded: { color: 'text', backgroundColor: 'subtle' },
  unseen: { color: 'inverseText', backgroundColor: 'warning' },
}

export function chip(label: string, tone: Tone): RenderElement {
  return (
    <Text bold {...tones[tone]}>
      {` ${label} `}
    </Text>
  )
}
