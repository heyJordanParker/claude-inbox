import { Progress } from '../../node_modules/@cmodjs/core/ui/components.js'
import { Box, Text, type TextProps } from '../../node_modules/@cmodjs/core/ui/elements.js'
import type { Block } from '../goals/progress.js'

type Table = Extract<Block, { readonly kind: 'table' }>

const indent = 2

const shortestBar = 8

function checked(text: string, isDone: boolean, look: TextProps = {}): JSX.Element {
  return <Text wrap="wrap" {...look}>{`${isDone ? '☑' : '☐'} ${text}`}</Text>
}

function Labeled({ label, children }: { readonly label: string | undefined; readonly children: JSX.Children }): JSX.Element {
  if (label === undefined) return <Box flexDirection="column">{children}</Box>
  return (
    <Box flexDirection="column">
      <Text bold wrap="truncate-end">
        {label}
      </Text>
      <Box flexDirection="column" paddingLeft={indent}>
        {children}
      </Box>
    </Box>
  )
}

function columnWidths(table: Table, columns: number): number[] {
  const widths = table.columns.map((name, index) => Math.max(name.length, ...table.rows.map((row) => row[index]?.length ?? 0)))
  const room = columns - (widths.length - 1)
  for (let total = widths.reduce((sum, width) => sum + width, 0); total > room; total -= 1) {
    const widest = widths.indexOf(Math.max(...widths))
    if ((widths[widest] ?? 1) <= 1) break
    widths[widest] = (widths[widest] ?? 1) - 1
  }
  return widths
}

function TableRows({ table, columns }: { readonly table: Table; readonly columns: number }): JSX.Element {
  const widths = columnWidths(table, columns)
  const row = (cells: readonly string[], isHeader: boolean) => (
    <Box columnGap={1}>
      {cells.map((cell, index) => (
        <Box width={widths[index] ?? 1} minWidth={widths[index] ?? 1} flexShrink={0}>
          <Text bold={isHeader} wrap="truncate-end">
            {cell}
          </Text>
        </Box>
      ))}
    </Box>
  )
  return (
    <Box flexDirection="column">
      {row(table.columns, true)}
      {table.rows.map((cells) => row(cells, false))}
    </Box>
  )
}

function BlockRows({ block, columns }: { readonly block: Block; readonly columns: number }): JSX.Element {
  if ('preset' in block) {
    if (block.preset === 'steps') return <Labeled label={block.label}>{block.steps.map((step, index) => checked(step, index < block.current, index === block.current ? { bold: true } : index > block.current ? { dimColor: true } : {}))}</Labeled>
    return <Labeled label={block.label}>{block.tasks.map((task) => checked(task.text, task.state === 'done', task.state === 'active' ? { bold: true } : task.state === 'planned' ? { dimColor: true } : {}))}</Labeled>
  }
  switch (block.kind) {
    case 'bar': {
      const count = `${block.done} of ${block.total}`
      return (
        <Box columnGap={1}>
          <Box flexShrink={1}>
            <Text bold wrap="truncate-end">
              {block.label}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Progress value={(block.done / block.total) * 100} width={Math.max(columns - block.label.length - count.length - 2, shortestBar)} />
          </Box>
          <Box flexShrink={0}>
            <Text>{count}</Text>
          </Box>
        </Box>
      )
    }
    case 'checklist':
      return <Labeled label={block.label}>{block.items.map((item) => checked(item.text, item.done))}</Labeled>
    case 'note':
      return <Text wrap="wrap">{block.text}</Text>
    case 'table':
      return (
        <Labeled label={block.label}>
          <TableRows table={block} columns={columns - (block.label === undefined ? 0 : indent)} />
        </Labeled>
      )
  }
}

export function ProgressBlocks({ blocks, columns }: { readonly blocks: readonly Block[]; readonly columns: number }): JSX.Element {
  return (
    <Box flexDirection="column">
      {blocks.map((block) => (
        <BlockRows block={block} columns={columns} />
      ))}
    </Box>
  )
}
