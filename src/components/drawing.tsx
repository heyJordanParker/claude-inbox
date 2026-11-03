import type { RenderElement } from 'claude-code'
import { Box, Button, Code, Text } from '../../node_modules/@cmodjs/core/ui/elements.js'
import { parseClassDiagram } from '../../node_modules/beautiful-mermaid/src/class/parser.ts'
import type { ClassMember, RelationshipType } from '../../node_modules/beautiful-mermaid/src/class/types.ts'
import { parseErDiagram } from '../../node_modules/beautiful-mermaid/src/er/parser.ts'
import type { Cardinality } from '../../node_modules/beautiful-mermaid/src/er/types.ts'
import { parseMermaid } from '../../node_modules/beautiful-mermaid/src/parser.ts'
import { parseSequenceDiagram } from '../../node_modules/beautiful-mermaid/src/sequence/parser.ts'
import { changeCounts, changeWords, diagramKindOf, diffOf, diffRowsOf, lineRange, statsOf, treeOf, type Mark, type TreeRow } from '../items/drawings.js'
import { projectName, type Change, type Drawing } from '../items/item.js'

export type OpenFile = (path: string, diff: string | undefined) => Promise<void>

const changeColors: Readonly<Record<Change, string>> = { add: 'success', edit: 'text', remove: 'error' }

function stats(diffs: readonly string[]): RenderElement[] {
  if (diffs.length === 0) return []
  const totals = statsOf(diffs)
  return [
    <Text>
      <Text color="success">{`+${totals.added}`}</Text>
      <Text> </Text>
      <Text color="error">{`−${totals.removed}`}</Text>
    </Text>,
  ]
}

function counted(changes: readonly (Change | undefined)[]): RenderElement[] {
  return changeCounts(changes).map(({ change, count }) => <Text color={changeColors[change]}>{`${count} ${changeWords[change]}`}</Text>)
}

function opener(key: string, path: string, onPress: () => Promise<void>): RenderElement {
  return (
    <Button plain key={key} onPress={onPress}>
      <Text color="suggestion">{path}</Text>
    </Button>
  )
}

export function drawingSubject(drawing: Drawing, project: string, keyPrefix: string, onFile: OpenFile): RenderElement[] {
  if (drawing.kind === 'files') {
    const diffs = drawing.files.flatMap((file) => (file.diff === undefined ? [] : [file.diff]))
    return [<Text>{projectName(project)}</Text>, ...counted(drawing.files.map((file) => file.change)), ...stats(diffs)]
  }
  if (drawing.kind === 'api') return [opener(`${keyPrefix}open`, drawing.path, () => onFile(drawing.path, undefined)), ...counted(drawing.changes.map((change) => change.change))]
  if (drawing.kind === 'diff') return [opener(`${keyPrefix}open`, drawing.path, () => onFile(drawing.path, undefined)), <Text dimColor>{lineRange(drawing)}</Text>, ...stats([diffOf(drawing)])]
  if (drawing.kind === 'table') return [<Text>{drawing.table}</Text>, ...counted(drawing.columns.map((column) => column.change))]
  if (drawing.kind === 'diagram') return [<Text>{diagramKindOf(drawing)}</Text>]
  return [<Text dimColor>{drawing.language}</Text>]
}

type Row = { readonly prefix: string; readonly text: string }

function flowRows(mermaid: string): Row[] {
  const graph = parseMermaid(mermaid)
  const rows: Row[] = []
  const seen = new Set<string>()
  const label = (id: string) => graph.nodes.get(id)?.label ?? id
  const visit = (id: string, lead: string, rest: string): void => {
    seen.add(id)
    rows.push({ prefix: lead, text: label(id) })
    const edges = graph.edges.filter((edge) => edge.source === id)
    edges.forEach((edge, index) => {
      const isBranch = edges.length > 1
      const isLast = index === edges.length - 1
      const head = isBranch ? `${rest}${isLast ? '└─ ' : '├─ '}` : rest
      const body = isBranch ? `${rest}${isLast ? '   ' : '│  '}` : rest
      const said = edge.label?.trim() ?? ''
      if (said !== '') rows.push({ prefix: head, text: isBranch ? said : `│ ${said}` })
      const at = said === '' ? head : body
      if (seen.has(edge.target)) return void rows.push({ prefix: at, text: `→ ${label(edge.target)}, above` })
      rows.push({ prefix: at, text: '▼' })
      visit(edge.target, body, body)
    })
  }
  const targets = new Set(graph.edges.map((edge) => edge.target))
  const starts = [...graph.nodes.keys()].filter((id) => !targets.has(id))
  for (const id of [...starts, ...graph.nodes.keys()]) {
    if (seen.has(id)) continue
    if (rows.length > 0) rows.push({ prefix: '', text: '' })
    visit(id, '', '')
  }
  return rows
}

function sequenceRows(lines: readonly string[]): Row[] {
  const diagram = parseSequenceDiagram([...lines])
  const name = (id: string) => diagram.actors.find((actor) => actor.id === id)?.label ?? id
  const depth = (index: number) => '  '.repeat(diagram.blocks.filter((block) => block.startIndex < index && index <= block.endIndex).length)
  const notes = (after: number) => diagram.notes.filter((note) => note.afterIndex === after).map((note) => ({ prefix: depth(after + 1), text: `note on ${note.actorIds.map(name).join(', ')}: ${note.text}` }))
  return [
    ...notes(-1),
    ...diagram.messages.flatMap((message, index) => [
      ...diagram.blocks.filter((block) => block.startIndex === index).map((block) => ({ prefix: depth(index), text: `${block.type} ${block.label}`.trim() })),
      ...diagram.blocks.flatMap((block) => block.dividers.filter((divider) => divider.index === index).map((divider) => ({ prefix: depth(index).slice(2), text: `${block.type === 'par' ? 'and' : 'else'} ${divider.label}`.trim() }))),
      { prefix: depth(index), text: `${name(message.from)} ${message.lineStyle === 'dashed' ? '⇢' : '→'} ${name(message.to)}: ${message.label}` },
      ...notes(index),
    ]),
  ]
}

const relationArrows: Readonly<Record<RelationshipType, readonly [string, string]>> = {
  inheritance: ['◁──', '──▷'],
  composition: ['◆──', '──◆'],
  aggregation: ['◇──', '──◇'],
  association: ['<──', '──>'],
  dependency: ['<┄┄', '┄┄>'],
  realization: ['◁┄┄', '┄┄▷'],
}

function memberText(member: ClassMember): string {
  const name = member.isMethod ? `${member.name}(${member.params ?? ''})` : member.name
  return `${member.visibility === '' ? '' : `${member.visibility} `}${name}${member.type === undefined ? '' : `: ${member.type}`}`
}

function classRows(lines: readonly string[]): Row[] {
  const diagram = parseClassDiagram([...lines])
  const label = (id: string) => diagram.classes.find((each) => each.id === id)?.label ?? id
  return [
    ...diagram.classes.flatMap((each) => [
      { prefix: '', text: each.annotation === undefined ? each.label : `${each.label}  <<${each.annotation}>>` },
      ...[...each.attributes, ...each.methods].map((member) => ({ prefix: '  ', text: memberText(member) })),
    ]),
    ...diagram.relationships.map((relation) => {
      const ends = [relation.fromCardinality, relation.toCardinality].map((each) => (each === undefined ? '' : ` ${each}`))
      return { prefix: '', text: `${label(relation.from)}${ends[0]} ${relationArrows[relation.type][relation.markerAt === 'from' ? 0 : 1]}${ends[1]} ${label(relation.to)}${relation.label === undefined ? '' : `: ${relation.label}`}` }
    }),
  ]
}

const cardinalityWords: Readonly<Record<Cardinality, string>> = { one: 'one', 'zero-one': 'zero or one', many: 'one or more', 'zero-many': 'zero or more' }

function entityRows(lines: readonly string[]): Row[] {
  const diagram = parseErDiagram([...lines])
  const label = (id: string) => diagram.entities.find((each) => each.id === id)?.label ?? id
  return [
    ...diagram.entities.flatMap((entity) => [
      { prefix: '', text: entity.label },
      ...entity.attributes.map((attribute) => ({ prefix: '  ', text: [`${attribute.name}: ${attribute.type}`, ...attribute.keys, ...(attribute.comment === undefined ? [] : [attribute.comment])].join('  ') })),
    ]),
    ...diagram.relationships.map((relation) => ({ prefix: '', text: `${label(relation.entity1)} ${relation.label} ${label(relation.entity2)}, ${cardinalityWords[relation.cardinality1]} to ${cardinalityWords[relation.cardinality2]}` })),
  ]
}

function outlineRows(mermaid: string): Row[] {
  const lines = mermaid.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('%%'))
  const header = lines[0]?.toLowerCase() ?? ''
  const source = lines.map((line) => ({ prefix: '', text: line }))
  try {
    if (header === 'sequencediagram') return sequenceRows(lines)
    if (header === 'classdiagram') return classRows(lines)
    if (header === 'erdiagram') return entityRows(lines)
    if (/^(graph|flowchart|statediagram)/.test(header)) return flowRows(mermaid)
    return source
  } catch {
    return source
  }
}

function widthOf(text: string): number {
  return Math.max(0, ...text.split('\n').map((line) => [...line].length))
}

function Diagram({ mermaid, drawn, columns, keyPrefix }: { readonly mermaid: string; readonly drawn: string; readonly columns: number; readonly keyPrefix: string }): RenderElement {
  if (widthOf(drawn) <= columns) return <Lines text={drawn} keyPrefix={keyPrefix} />
  return (
    <Box flexDirection="column" key={keyPrefix}>
      {outlineRows(mermaid).map((row, index) => (
        <Box key={`${keyPrefix}r${index}`}>
          <Text>{row.prefix}</Text>
          <Box flexShrink={1}>
            <Text wrap="wrap">{row.text === '' ? ' ' : row.text}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function Lines({ text, keyPrefix }: { readonly text: string; readonly keyPrefix: string }): RenderElement {
  return (
    <Box flexDirection="column" key={keyPrefix}>
      {text.split('\n').map((line, index) => (
        <Text key={`${keyPrefix}l${index}`} wrap="truncate-end">
          {line === '' ? ' ' : line}
        </Text>
      ))}
    </Box>
  )
}

const markColors: Readonly<Record<Mark, string | undefined>> = { '+': 'success', '-': 'error', ' ': undefined }

function Marked({ rows, keyPrefix, onFile }: { readonly rows: readonly TreeRow[]; readonly keyPrefix: string; readonly onFile: OpenFile }): RenderElement {
  return (
    <Box flexDirection="column" key={keyPrefix}>
      {rows.map(({ mark, line, path, diff }, index) => {
        const color = markColors[mark]
        const text = (
          <Text wrap="wrap" {...(color === undefined ? {} : { color })}>
            {`${mark} ${line}`}
          </Text>
        )
        return path === undefined ? (
          <Box key={`${keyPrefix}r${index}`}>{text}</Box>
        ) : (
          <Button plain key={`${keyPrefix}open:${path}`} onPress={() => onFile(path, diff)}>
            {text}
          </Button>
        )
      })}
    </Box>
  )
}

export function DrawingView({ drawing, columns, keyPrefix, onFile }: { readonly drawing: Drawing; readonly columns: number; readonly keyPrefix: string; readonly onFile: OpenFile }): RenderElement {
  if (drawing.kind === 'files' || drawing.kind === 'api') return <Marked rows={treeOf(drawing)} keyPrefix={keyPrefix} onFile={onFile} />
  if (drawing.kind === 'diff') return <Code key={keyPrefix} source={diffOf(drawing)} path={drawing.path} format="diff" />
  if (drawing.kind === 'table') return <Code key={keyPrefix} source={diffOf(drawing)} language="typescript" format="diff" />
  if (drawing.kind === 'diagram') return <Diagram mermaid={drawing.mermaid} drawn={drawing.drawn} columns={columns} keyPrefix={keyPrefix} />
  if (drawing.language === 'diff') return <Marked rows={diffRowsOf(drawing.code)} keyPrefix={keyPrefix} onFile={onFile} />
  return <Code key={keyPrefix} source={drawing.code} language={drawing.language} />
}
