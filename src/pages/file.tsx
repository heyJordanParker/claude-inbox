import type { Mod, Page, PageInit } from '../../node_modules/@cmodjs/core/mod.js'
import { Box, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { codeReader } from '../drawings.js'
import type { InboxState } from '../state.js'

export type FileParams = { readonly project: string; readonly path: string }

function keyOf({ project, path }: FileParams): string {
  return `${project}::${path}`
}

export const filePage: PageInit<InboxState, FileParams> = {
  id: 'file',
  title: 'File',
  render: (mod, { params }) => {
    const view = mod.state.memory.files[keyOf(params)]
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{params.path}</Text>
          <Text dimColor>{params.project}</Text>
        </Box>
        {view === undefined || view.status === 'loading' ? <Text dimColor>Reading its public API…</Text> : null}
        {view?.status === 'failed' ? <Text color="error" wrap="wrap">{view.error}</Text> : null}
        {view?.status === 'ready' ? (
          view.declarations.length === 0 ? (
            <Text dimColor>It declares nothing public.</Text>
          ) : (
            <Box flexDirection="column" gap={1}>
              {view.declarations.map((declaration) => (
                <Box flexDirection="column">
                  <Text dimColor>{`line ${declaration.line}`}</Text>
                  <Text wrap="wrap">{declaration.header}</Text>
                </Box>
              ))}
            </Box>
          )
        ) : null}
      </Box>
    )
  },
}

export async function showFile(mod: Mod<InboxState>, page: Page<FileParams>, params: FileParams): Promise<void> {
  const key = keyOf(params)
  mod.state.memory.files = { ...mod.state.memory.files, [key]: { status: 'loading' } }
  await page.open({ params, focus: true })
  try {
    const declarations = await codeReader(params.project).declarations(params.path)
    mod.state.memory.files = { ...mod.state.memory.files, [key]: { status: 'ready', declarations } }
  } catch (error) {
    mod.state.memory.files = { ...mod.state.memory.files, [key]: { status: 'failed', error: error instanceof Error ? error.message : String(error) } }
  }
}
