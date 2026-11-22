import type { Mod } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Button, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { isUnfolded, toggleUnfolded } from '../requirements.js'
import type { InboxState } from '../state.js'

export function Fold({ mod, foldKey, label }: { readonly mod: Mod<InboxState>; readonly foldKey: string; readonly label: string }): JSX.Element {
  const isOpen = isUnfolded(mod, foldKey)
  return (
    <Box key={`${foldKey}-area`}>
      <Button plain key={foldKey} hover={{ inverse: true }} onPress={() => toggleUnfolded(mod, foldKey)}>
        <Text dimColor wrap={isOpen ? 'wrap' : 'truncate-end'}>{`${isOpen ? '▾' : '▸'} ${label}`}</Text>
      </Button>
    </Box>
  )
}
