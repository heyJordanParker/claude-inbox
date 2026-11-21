import { Text } from '../../node_modules/@cmodjs/core/ui/elements.js'

export type Tone = 'label' | 'folded' | 'unseen'

const tones: Readonly<Record<Tone, { readonly color: string; readonly backgroundColor: string }>> = {
  label: { color: 'inverseText', backgroundColor: 'inactive' },
  folded: { color: 'text', backgroundColor: 'subtle' },
  unseen: { color: 'inverseText', backgroundColor: 'warning' },
}

export function chip(label: string, tone: Tone): JSX.Element {
  return (
    <Text bold {...tones[tone]}>
      {` ${label} `}
    </Text>
  )
}
