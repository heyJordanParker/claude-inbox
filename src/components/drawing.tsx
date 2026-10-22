import type { RenderElement } from 'claude-code'
import { Box, Button, Code, Markdown, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import type { Change, CodeDiff, Declaration, Drawing } from '../inbox.js'

const markers: Readonly<Record<Change, string>> = { add: '+', remove: '-', edit: '*' }

const colors: Readonly<Record<Change, string>> = { add: 'success', remove: 'error', edit: 'warning' }

export function drawingLabel(drawing: Drawing): string {
  if (drawing.kind === 'files') return `Files: ${drawing.files.map((file) => file.path).join(', ')}`
  if (drawing.kind === 'api') return `API: ${drawing.path}`
  if (drawing.kind === 'diff') return `Diff: ${drawing.path}:${drawing.startLine}`
  if (drawing.kind === 'table') return `Table: ${drawing.table}`
  if (drawing.kind === 'diagram') return 'Diagram'
  return `Example: ${drawing.language}`
}

function firstLine(text: string): string {
  return text.split('\n')[0] ?? ''
}

function Declarations({ declarations, keyPrefix }: { readonly declarations: readonly Declaration[]; readonly keyPrefix: string }): RenderElement {
  return (
    <Box flexDirection="column" key={keyPrefix}>
      {declarations.map((declaration, index) => (
        <Text dimColor key={`${keyPrefix}${index}`}>{`${index === declarations.length - 1 ? '└──' : '├──'} ${firstLine(declaration.header)}`}</Text>
      ))}
    </Box>
  )
}

function hunkOf(diff: CodeDiff): string {
  const oldLines = diff.old.split('\n')
  const newLines = diff.new === '' ? [] : diff.new.split('\n')
  const start = diff.startLine - diff.before.length
  return [
    `@@ -${start},${diff.before.length + oldLines.length + diff.after.length} +${start},${diff.before.length + newLines.length + diff.after.length} @@`,
    ...diff.before.map((line) => ` ${line}`),
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    ...diff.after.map((line) => ` ${line}`),
  ].join('\n')
}

export function DrawingView({ drawing, keyPrefix, onFile }: { readonly drawing: Drawing; readonly keyPrefix: string; readonly onFile: (path: string) => void }): RenderElement {
  if (drawing.kind === 'files')
    return (
      <Box flexDirection="column" key={keyPrefix}>
        {drawing.files.map((file, index) => (
          <Box flexDirection="column" key={`${keyPrefix}f${index}`}>
            <Box gap={1}>
              <Text color={colors[file.change]}>{markers[file.change]}</Text>
              <Button plain key={`${keyPrefix}open${index}`} label={file.path} onPress={() => onFile(file.path)} />
              <Text dimColor>{`<- ${file.note}`}</Text>
            </Box>
            <Box marginLeft={2}>
              <Declarations declarations={file.declarations} keyPrefix={`${keyPrefix}f${index}d`} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  if (drawing.kind === 'api') {
    const changed = new Map(drawing.changes.map((change) => [change.name, change]))
    const added = drawing.changes.filter((change) => change.change === 'add')
    return (
      <Box flexDirection="column" key={keyPrefix}>
        <Button plain key={`${keyPrefix}open`} label={drawing.path} onPress={() => onFile(drawing.path)} />
        {drawing.declarations.map((declaration, index) => {
          const change = changed.get(declaration.name)
          if (change === undefined) return <Text dimColor key={`${keyPrefix}d${index}`}>{`   ${firstLine(declaration.header)}`}</Text>
          return (
            <Box flexDirection="column" key={`${keyPrefix}d${index}`}>
              <Text color="error">{`-  ${firstLine(declaration.header)}`}</Text>
              {change.signature === undefined ? <Text dimColor>{`   <- ${change.note}`}</Text> : <Text color="success">{`+  ${change.signature}   <- ${change.note}`}</Text>}
              {change.callers.length === 0 ? <Text dimColor>{'   called by nothing'}</Text> : <Text dimColor>{`   called by ${change.callers.map((caller) => `${caller.name} (${caller.file}:${caller.line})`).join(', ')}`}</Text>}
            </Box>
          )
        })}
        {added.map((change, index) => (
          <Text color="success" key={`${keyPrefix}a${index}`}>{`+  ${change.signature ?? change.name}   <- ${change.note}`}</Text>
        ))}
      </Box>
    )
  }
  if (drawing.kind === 'diff') return <Code key={keyPrefix} source={hunkOf(drawing)} path={drawing.path} format="diff" />
  if (drawing.kind === 'table')
    return (
      <Box flexDirection="column" key={keyPrefix}>
        <Text bold>{drawing.table}</Text>
        {drawing.columns.map((column, index) => (
          <Text key={`${keyPrefix}c${index}`} {...(column.change === undefined ? { dimColor: true } : { color: colors[column.change] })}>
            {`${column.change === undefined ? ' ' : markers[column.change]} ${column.name} ${column.type}${column.note === undefined ? '' : `   <- ${column.note}`}`}
          </Text>
        ))}
      </Box>
    )
  if (drawing.kind === 'diagram') return <Markdown key={keyPrefix} text={`\`\`\`mermaid\n${drawing.mermaid}\n\`\`\``} />
  return <Code key={keyPrefix} source={drawing.code} language={drawing.language} />
}
