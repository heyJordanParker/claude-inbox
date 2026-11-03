import { fs, messageOf, type Mod, type Page, type PageInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Code, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { whereLine } from '../items/item.js'
import type { FileView, InboxState } from '../state.js'

export const filePage: PageInit<InboxState> = {
  id: 'file',
  title: 'File',
  render: (mod) => {
    const shown = mod.state.session.file
    if (shown === null) return <Text dimColor>Press a file in an inbox item to see it here.</Text>
    const { project, path, view } = shown
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{path}</Text>
          <Text dimColor>{whereLine(project, view.status === 'read' && view.isDiff)}</Text>
        </Box>
        {view.status === 'failed' ? <Text color="error" wrap="wrap">{view.error}</Text> : <Code key={`file:${project}:${path}`} source={view.text} path={path} {...(view.isDiff ? { format: 'diff' } : { startLine: 1 })} />}
      </Box>
    )
  },
}

async function viewOf(project: string, path: string, diff: string | undefined): Promise<FileView> {
  if (diff !== undefined) return { status: 'read', text: diff, isDiff: true }
  try {
    return { status: 'read', text: await fs.read(`${project}/${path}`), isDiff: false }
  } catch (error) {
    return { status: 'failed', error: `${path} could not be read: ${messageOf(error)}` }
  }
}

export async function showFile(mod: Mod<InboxState>, page: Page, project: string, path: string, diff: string | undefined): Promise<void> {
  mod.state.session.file = { project, path, view: await viewOf(project, path, diff) }
  await page.open({ focus: true })
}
