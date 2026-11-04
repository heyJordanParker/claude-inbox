import { renderMermaidASCII } from '../../node_modules/beautiful-mermaid/src/ascii/index.ts'
import type { ApiChange, Change, CodeDiff, Diagram, Drawing, FileTree, TableChange } from './item.js'

const kinds: Readonly<Record<Drawing['kind'], string>> = { files: 'Files', api: 'API', diff: 'Diff', table: 'Data', diagram: 'Diagram', example: 'Example' }

export const changeWords: Readonly<Record<Change, string>> = { add: 'added', edit: 'edited', remove: 'removed' }

const diagramKinds: Readonly<Record<string, string>> = { graph: 'flowchart', flowchart: 'flowchart', sequenceDiagram: 'sequence', stateDiagram: 'state', 'stateDiagram-v2': 'state', classDiagram: 'class', erDiagram: 'entities', 'xychart-beta': 'chart' }

export function kindOf(drawing: Drawing): string {
  return kinds[drawing.kind]
}

export function diagramKindOf(diagram: Diagram): string {
  return diagramKinds[diagram.mermaid.trim().split(/\s/)[0] ?? ''] ?? 'diagram'
}

export function lineRange(diff: CodeDiff): string {
  const end = diff.startLine + Math.max(diff.old.split('\n').length, diff.new.split('\n').length) - 1
  return end === diff.startLine ? `line ${end}` : `lines ${diff.startLine}–${end}`
}

export function drawingLabel(drawing: Drawing): string {
  if (drawing.kind === 'files') return `Files: ${drawing.files.map((file) => file.path).join(', ')}`
  if (drawing.kind === 'api') return `API: ${drawing.path}`
  if (drawing.kind === 'diff') return `Diff: ${drawing.path}:${drawing.startLine}`
  if (drawing.kind === 'table') return `Data: ${drawing.table}`
  if (drawing.kind === 'diagram') return 'Diagram'
  return `Example: ${drawing.language}`
}

export function statsOf(diffs: readonly string[]): { readonly added: number; readonly removed: number } {
  const lines = diffs.flatMap((diff) => diff.split('\n'))
  return { added: lines.filter((line) => line.startsWith('+')).length, removed: lines.filter((line) => line.startsWith('-')).length }
}

export function changeCounts(changes: readonly (Change | undefined)[]): { readonly change: Change; readonly count: number }[] {
  return (['add', 'edit', 'remove'] as const).flatMap((change) => {
    const count = changes.filter((each) => each === change).length
    return count === 0 ? [] : [{ change, count }]
  })
}

export function diffOf(drawing: CodeDiff | TableChange): string {
  if (drawing.kind === 'diff') return hunkOf(drawing)
  return tableHunk(drawing)
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trimEnd()
}

function declared(header: string): string {
  return firstLine(header)
    .replace(/^export\s+(default\s+)?/, '')
    .replace(/\s*\{\s*…\s*\}$/, '')
    .replace(/\s*(=|\{)$/, '')
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

export type Mark = '+' | '-' | ' '

export type TreeRow = { readonly mark: Mark; readonly line: string; readonly path?: string; readonly diff?: string }

type Branch = { readonly name: string; readonly mark: Mark; readonly note: string; readonly children: Branch[]; readonly was?: string; readonly path?: string; readonly diff?: string }

const marks: Readonly<Record<Change, Mark>> = { add: '+', remove: '-', edit: ' ' }

function folded(branch: Branch): Branch {
  const [only] = branch.children
  if (branch.children.length === 1 && only !== undefined && only.path === undefined) return folded({ ...only, name: `${branch.name}${only.name}` })
  return { ...branch, children: branch.children.map(folded) }
}

function filesBranches(drawing: FileTree): Branch[] {
  const root: Branch = { name: '', mark: ' ', note: '', children: [] }
  for (const file of drawing.files) {
    const parts = file.path.split('/')
    let at = root
    for (const folder of parts.slice(0, -1)) {
      const known = at.children.find((child) => child.name === `${folder}/` && child.path === undefined)
      const next = known ?? { name: `${folder}/`, mark: ' ' as const, note: '', children: [] }
      if (known === undefined) at.children.push(next)
      at = next
    }
    at.children.push({ name: `${parts.at(-1) ?? file.path}${file.change === 'edit' ? '*' : ''}`, mark: marks[file.change], note: file.note, children: [], path: file.path, ...(file.diff === undefined ? {} : { diff: file.diff }) })
  }
  return root.children.map(folded)
}

function signatureOf(header: string): string {
  return declared(header).replace(/^(async\s+)?function\s+/, '')
}

function apiBranches(drawing: ApiChange): Branch[] {
  const changes = new Map(drawing.changes.map((change) => [change.name, change]))
  const listed = new Set(drawing.declarations.map((declaration) => declaration.name))
  const end = Math.max(0, ...drawing.declarations.map((declaration) => declaration.line))
  const rows = [
    ...drawing.declarations.map(({ name, header, line }) => ({ line, name, header, change: changes.get(name) })),
    ...drawing.changes.filter((change) => !listed.has(change.name)).map((change, index) => ({ line: change.change === 'add' ? end + 1 + index : (change.was?.line ?? end + 1 + index), name: change.name, header: change.was?.header ?? change.name, change })),
  ].sort((a, b) => a.line - b.line)
  const isShown = (index: number) => [index - 1, index, index + 1].some((near) => rows[near]?.change !== undefined)
  const children = rows.flatMap(({ header, change }, index): Branch[] => {
    if (change === undefined) return isShown(index) ? [{ name: signatureOf(header), mark: ' ', note: '', children: [] }] : []
    const was = signatureOf(change.was?.header ?? header)
    const now = signatureOf(change.signature ?? header)
    if (change.change === 'add') return [{ name: now, mark: '+', note: change.note, children: [] }]
    if (change.change === 'remove') return [{ name: was, mark: '-', note: change.note, children: [] }]
    return [{ name: now, mark: '+', note: change.note, children: [], was }]
  })
  return [{ name: `${drawing.path}*`, mark: ' ', note: '', children, path: drawing.path }]
}

type Drawn = { readonly mark: Mark; readonly tree: string; readonly note: string; readonly path?: string; readonly diff?: string }

function flattened(branches: readonly Branch[], lead: string, isRoot: boolean): Drawn[] {
  return branches.flatMap((branch, index) => {
    const isLast = index === branches.length - 1
    const head = `${lead}${isRoot ? '' : isLast ? '└── ' : '├── '}`
    const { name, mark, note, children, was, ...file } = branch
    const removed: Drawn[] = was === undefined ? [] : [{ mark: '-', tree: `${head}${was}`, note: '' }]
    return [...removed, { mark, tree: `${head}${name}`, note, ...file }, ...flattened(children, isRoot ? '' : `${lead}${isLast ? '    ' : '│   '}`, false)]
  })
}

export function treeOf(drawing: FileTree | ApiChange): TreeRow[] {
  const rows = flattened(drawing.kind === 'files' ? filesBranches(drawing) : apiBranches(drawing), '', true)
  const width = Math.max(0, ...rows.filter((row) => row.note !== '').map((row) => [...row.tree].length))
  return rows.map(({ tree, note, ...row }) => ({ ...row, line: note === '' ? tree : `${tree}${' '.repeat(width - [...tree].length)}  <- ${note}` }))
}

export function diffRowsOf(code: string): TreeRow[] {
  return code.split('\n').map((line) => {
    const mark: Mark = line.startsWith('+') ? '+' : line.startsWith('-') ? '-' : ' '
    return { mark, line: mark === ' ' && !line.startsWith(' ') ? line : line.slice(1) }
  })
}


function tableHunk(drawing: TableChange): string {
  const field = (name: string, type: string, note: string | undefined) => `  ${name}: ${type}${note === undefined || note === '' ? '' : `  // ${note}`}`
  const lines = drawing.columns.flatMap(({ name, type, change, was, note }) => {
    if (change === 'add') return [`+${field(name, type, note)}`]
    if (change === 'remove') return [`-${field(name, type, note)}`]
    if (change === 'edit') return [`-${field(name, was ?? type, undefined)}`, `+${field(name, type, note)}`]
    return [` ${field(name, type, note)}`]
  })
  const oldCount = lines.filter((line) => !line.startsWith('+')).length + 2
  const newCount = lines.filter((line) => !line.startsWith('-')).length + 2
  return [`@@ -1,${oldCount} +1,${newCount} @@`, ' type Fields = {', ...lines, ' }'].join('\n')
}

export function drawnDiagram(mermaid: string): string {
  return renderMermaidASCII(mermaid, { colorMode: 'none', boxBorderPadding: 0, paddingX: 5, paddingY: 3 })
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
}
