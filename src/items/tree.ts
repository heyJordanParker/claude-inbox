import { drawingLabel } from './drawings.js'
import { current, plural, revisionNumber, revisionOf, wording, type Content, type Idea, type Item, type Person, type Problem, type Shipped, type Solution } from './item.js'

export type Node =
  | { readonly type: 'problem'; readonly path: string; readonly number: string; readonly problem: Problem }
  | { readonly type: 'solution'; readonly path: string; readonly number: string; readonly label: 'Solution' | 'Option'; readonly solution: Solution }
  | { readonly type: 'change'; readonly path: string; readonly number: string; readonly change: Shipped }

function letter(index: number): string {
  const own = String.fromCharCode(65 + (index % 26))
  return index < 26 ? own : `${letter(Math.floor(index / 26) - 1)}${own}`
}

function numberUnder(parent: string, index: number): string {
  if (parent === '') return `${index + 1}`
  return /\d$/.test(parent) ? `${parent}${letter(index)}` : `${parent}${index + 1}`
}

function problems(list: readonly Problem[], parentPath: string, parentNumber: string, offset = 0, part = 'p'): Node[] {
  return list.map((problem, index) => ({
    type: 'problem' as const,
    path: parentPath === '' ? `${part}${index}` : `${parentPath}.${part}${index}`,
    number: numberUnder(parentNumber, offset + index),
    problem,
  }))
}

export const openPart = 'u'

export const changePart = 'c'

export function childrenOf(node: Node): Node[] {
  if (node.type === 'change') return []
  if (node.type === 'problem') {
    const { solution, problems: nested = [] } = node.problem
    return [
      ...(solution === undefined ? [] : [{ type: 'solution' as const, path: `${node.path}.s`, number: node.number, label: 'Solution' as const, solution }]),
      ...problems(nested, node.path, node.number, solution?.problems?.length ?? 0),
    ]
  }
  return problems(node.solution.problems ?? [], node.path, node.number)
}

export function rootsOf(content: Content): Node[] {
  if (content.kind === 'question') return []
  if (content.kind === 'proposal') return problems(content.problems, '', '')
  if (content.kind === 'options') return content.options.map((solution, index) => ({ type: 'solution' as const, path: `o${index}`, number: `${index + 1}`, label: 'Option' as const, solution }))
  return [
    ...content.changes.map((change, index) => ({ type: 'change' as const, path: `${changePart}${index}`, number: `${index + 1}`, change })),
    ...problems(content.open ?? [], '', '', 0, openPart),
  ]
}

export function ideasOf(node: Node): readonly Idea[] {
  if (node.type === 'change') return []
  return node.type === 'problem' ? node.problem.ideas : node.solution.ideas
}

export function evidenceOf(node: Node): readonly string[] {
  return node.type === 'change' ? node.change.evidence : []
}

export function ideaPath(parent: string, index: number): string {
  return `${parent}.i${index}`
}

export function drawingPath(idea: string): string {
  return `${idea}.d`
}

const evidencePart = 'e'

export function evidencePath(node: string): string {
  return `${node}.${evidencePart}`
}

function startsFolded(path: string): boolean {
  const parts = path.split('.')
  const last = parts.at(-1) ?? ''
  return last === evidencePart || (parts.length > 1 && last.startsWith('p'))
}

export type Revised = {
  readonly changed: ReadonlySet<string>
  readonly removed: ReadonlyMap<string, readonly string[]>
  readonly was: ReadonlyMap<string, string>
}

export const unrevised: Revised = { changed: new Set(), removed: new Map(), was: new Map() }

const wordsOf = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9']+/g) ?? [])

function isSimilar(was: string, now: string): boolean {
  const before = wordsOf(was)
  const after = wordsOf(now)
  const shared = [...before].filter((word) => after.has(word)).length
  return shared * 2 >= Math.max(before.size, after.size)
}

type Aligned ={ readonly pairs: readonly (readonly [number, number])[]; readonly added: readonly number[]; readonly removed: readonly (readonly [number, number])[] }

function align<Each>(was: readonly Each[], now: readonly Each[], keyOf: (each: Each) => string): Aligned {
  const a = was.map(keyOf)
  const b = now.map(keyOf)
  const longest = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const at = (i: number, j: number) => longest[i]?.[j] ?? 0
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) (longest[i] ?? [])[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
  const pairs: (readonly [number, number])[] = []
  const added: number[] = []
  const removed: (readonly [number, number])[] = []
  let gapWas: number[] = []
  let gapNow: number[] = []
  let i = 0
  let j = 0
  const closeGap = () => {
    const edited = Math.min(gapWas.length, gapNow.length)
    for (let k = 0; k < edited; k += 1) {
      const o = gapWas[k] ?? 0
      const n = gapNow[k] ?? 0
      if (isSimilar(a[o] ?? '', b[n] ?? '')) pairs.push([o, n])
      else {
        removed.push([o, n])
        added.push(n)
      }
    }
    removed.push(...gapWas.slice(edited).map((o) => [o, j] as const))
    added.push(...gapNow.slice(edited))
    gapWas = []
    gapNow = []
  }
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      closeGap()
      pairs.push([i, j])
      i += 1
      j += 1
    } else if (at(i + 1, j) >= at(i, j + 1)) gapWas.push(i++)
    else gapNow.push(j++)
  }
  while (i < a.length) gapWas.push(i++)
  while (j < b.length) gapNow.push(j++)
  closeGap()
  return { pairs, added, removed }
}

const under = (parent: string, part: string) => (parent === '' ? part : `${parent}.${part}`)

export function revisedSince(before: Content | undefined, now: Content): Revised {
  if (before === undefined) return unrevised
  const changed = new Set<string>()
  const removed = new Map<string, string[]>()
  const was = new Map<string, string>()
  const remove = (oldPath: string, at: string) => removed.set(at, [...(removed.get(at) ?? []), oldPath])
  const words = (path: string, old: string, fresh: string) => {
    if (old === fresh) return
    changed.add(path)
    was.set(path, old)
  }
  const ideas = (oldParent: string, newParent: string, old: readonly Idea[], fresh: readonly Idea[]) => {
    const aligned = align(old, fresh, (each) => each.idea)
    for (const [o, n] of aligned.pairs) {
      const path = ideaPath(newParent, n)
      words(path, old[o]?.idea ?? '', fresh[n]?.idea ?? '')
      if (JSON.stringify(old[o]) !== JSON.stringify(fresh[n])) changed.add(path)
    }
    aligned.added.forEach((n) => changed.add(ideaPath(newParent, n)))
    aligned.removed.forEach(([o, at]) => remove(ideaPath(oldParent, o), ideaPath(newParent, at)))
  }
  const addNode = (node: Node): void => {
    changed.add(node.path)
    ideasOf(node).forEach((_, n) => changed.add(ideaPath(node.path, n)))
    childrenOf(node).forEach(addNode)
  }
  const addProblem = (path: string, problem: Problem) => addNode({ type: 'problem', path, number: '', problem })
  const addSolution = (path: string, solution: Solution) => addNode({ type: 'solution', path, number: '', label: 'Solution', solution })
  const list = <Each>(oldParent: string, newParent: string, part: string, old: readonly Each[], fresh: readonly Each[], titleOf: (each: Each) => string, compare: (oldPath: string, newPath: string, was: Each, now: Each) => void, add: (path: string, now: Each) => void) => {
    const aligned = align(old, fresh, titleOf)
    for (const [o, n] of aligned.pairs) {
      const was = old[o]
      const now = fresh[n]
      if (was !== undefined && now !== undefined) compare(under(oldParent, `${part}${o}`), under(newParent, `${part}${n}`), was, now)
    }
    aligned.added.forEach((n) => {
      const now = fresh[n]
      if (now !== undefined) add(under(newParent, `${part}${n}`), now)
    })
    aligned.removed.forEach(([o, at]) => remove(under(oldParent, `${part}${o}`), under(newParent, `${part}${at}`)))
  }
  const solution = (oldPath: string, newPath: string, old: Solution, fresh: Solution) => {
    words(newPath, old.title, fresh.title)
    if (old.precedent !== fresh.precedent) changed.add(newPath)
    ideas(oldPath, newPath, old.ideas, fresh.ideas)
    problems(oldPath, newPath, old.problems ?? [], fresh.problems ?? [])
  }
  const problem = (oldPath: string, newPath: string, old: Problem, fresh: Problem) => {
    words(newPath, old.title, fresh.title)
    ideas(oldPath, newPath, old.ideas, fresh.ideas)
    if (old.solution !== undefined && fresh.solution !== undefined) solution(`${oldPath}.s`, `${newPath}.s`, old.solution, fresh.solution)
    else if (fresh.solution !== undefined) addSolution(`${newPath}.s`, fresh.solution)
    else if (old.solution !== undefined) remove(`${oldPath}.s`, `${newPath}.s`)
    problems(oldPath, newPath, old.problems ?? [], fresh.problems ?? [])
  }
  const problems = (oldParent: string, newParent: string, old: readonly Problem[], fresh: readonly Problem[]) => list(oldParent, newParent, 'p', old, fresh, (each) => each.title, problem, addProblem)
  words('title', before.title, now.title)
  if (before.kind === 'question' && now.kind === 'question') words('why', before.why, now.why)
  if (before.kind !== 'question' && now.kind !== 'question') words('goal', before.goal, now.goal)
  if (before.kind === 'proposal' && now.kind === 'proposal') problems('', '', before.problems, now.problems)
  if (before.kind === 'options' && now.kind === 'options') {
    words('problem', before.problem.title, now.problem.title)
    ideas('problem', 'problem', before.problem.ideas, now.problem.ideas)
    list('', '', 'o', before.options, now.options, (each) => each.title, solution, addSolution)
  }
  if (before.kind === 'report' && now.kind === 'report') {
    list('', '', changePart, before.changes, now.changes, (each) => each.title, (_, newPath, was, fresh) => {
      words(newPath, was.title, fresh.title)
      if (JSON.stringify(was) !== JSON.stringify(fresh)) changed.add(newPath)
    }, (path) => void changed.add(path))
    list('', '', openPart, before.open ?? [], now.open ?? [], (each) => each.title, problem, addProblem)
  }
  return { changed, removed, was }
}

function changesInside(changed: Iterable<string>, path: string): boolean {
  return [...changed].some((each) => each.startsWith(`${path}.`))
}

const isPart = (path: string) => /^[pou]\d/.test(path)

function isRevised({ changed, removed }: Revised): boolean {
  return [...changed].some(isPart) || removed.size > 0
}

export function isChanged({ changed, removed }: Revised, path: string): boolean {
  return changed.has(path) || changesInside(changed, path) || changesInside(removed.keys(), path)
}

export function isUnchanged(revised: Revised, path: string): boolean {
  return isRevised(revised) && !isChanged(revised, path)
}

export function foldKey(item: Item, path: string): string {
  return `${item.id}:${revisionOf(item)}:${path}`
}

const foldingPart = new RegExp(`^(?:[pou]\\d+|problem|d|${evidencePart})$`)

export function folds(path: string): boolean {
  return foldingPart.test(path.split('.').at(-1) ?? '')
}

function foldingOwnerOf(path: string): string {
  const parts = path.split('.').slice(0, -1)
  while (parts.length > 0 && !foldingPart.test(parts.at(-1) ?? '')) parts.pop()
  return parts.join('.')
}

export function opensAt(revised: Revised, path: string): boolean {
  const owner = foldingOwnerOf(path)
  if (!isRevised(revised) || (owner !== '' && !isChanged(revised, owner))) return !startsFolded(path)
  return path.endsWith('.d') ? revised.changed.has(path.slice(0, -'.d'.length)) : isChanged(revised, path)
}

export type Folds = Readonly<Record<string, boolean>>

export type Reading = { readonly item: Item; readonly person: Person; readonly before: Content | undefined; readonly revised: Revised; readonly folds: Folds }

export function readingOf(item: Item, person: Person, folds: Folds): Reading {
  const before = person.lastRead < 0 ? undefined : item.revisions[person.lastRead]?.content
  return { item, person, before, folds, revised: revisedSince(before, current(item)) }
}

export function isUnfolded({ item, revised, folds: saved }: Reading, path: string, isFoldedAtFirst = false): boolean {
  return !folds(path) || (saved[foldKey(item, path)] ?? (!isFoldedAtFirst && opensAt(revised, path)))
}

export function foldedLine({ revised, person }: Reading, path: string, summary: string): string {
  return isUnchanged(revised, path) ? `${summary} · unchanged since revision ${revisionNumber(person.lastRead)}` : summary
}

export function isDrawingUnchanged({ revised }: Reading, path: string): boolean {
  return isUnchanged(revised, path.slice(0, -'.d'.length))
}

export function unseenAt({ revised }: Reading, path: string): 'changed' | 'changed inside' | undefined {
  if (revised.changed.has(path)) return 'changed'
  return isChanged(revised, path) ? 'changed inside' : undefined
}

export type RootGroup = { readonly part: string; readonly nodes: readonly Node[] }

export function rootGroups(content: Content): RootGroup[] {
  const roots = rootsOf(content)
  const parts = content.kind === 'report' ? [changePart, openPart] : content.kind === 'options' ? ['o'] : ['p']
  return parts.map((part) => ({ part, nodes: roots.filter((node) => node.path.replace(/\d+$/, '') === part) }))
}

export function isLeftOpen(node: Node): boolean {
  return node.path.startsWith(openPart) && !node.path.includes('.')
}

function kindOfNode(node: Node): 'Problem' | 'Solution' | 'Option' | 'Change' {
  if (node.type === 'solution') return node.label
  return node.type === 'problem' ? 'Problem' : 'Change'
}

export function headingOf(node: Node): string {
  return `${kindOfNode(node)} ${node.number}`
}

export function titleOf(node: Node): string {
  if (node.type === 'change') return node.change.title
  return node.type === 'problem' ? node.problem.title : node.solution.title
}

function nameOf(node: Node): string {
  return `${headingOf(node)}: ${titleOf(node)}`
}

function tally(node: Node): { readonly ideas: number; readonly drawings: number } {
  const own = ideasOf(node)
  return childrenOf(node)
    .map(tally)
    .reduce((sum, each) => ({ ideas: sum.ideas + each.ideas, drawings: sum.drawings + each.drawings }), { ideas: own.length, drawings: own.filter((idea) => idea.drawing !== undefined).length })
}

export function summaryOf(node: Node): string {
  const { ideas, drawings } = tally(node)
  const counts = [plural(ideas, 'idea'), ...(drawings === 0 ? [] : [plural(drawings, 'drawing')])].join(', ')
  const children = childrenOf(node)
  const solution = children.find((child) => child.type === 'solution')
  const nested = children.filter((child) => child.type === 'problem').map(headingOf)
  return [...(solution === undefined ? [] : [`${headingOf(solution)} · ${titleOf(solution)}`]), counts, ...nested].join(' · ')
}

const longestQuote = 60

function quoteOf(idea: Idea): string {
  const words = idea.idea.replace(/\s+/g, ' ').trim()
  return `"${words.length <= longestQuote ? words : `${words.slice(0, longestQuote - 1).trimEnd()}…`}"`
}

export function titlePath(content: Content, path: string): string {
  if (path === '') return 'the whole item'
  if (path === 'goal') return wording.goal
  if (path === 'why') return wording.whyItMatters
  const parts = path.split('.')
  if (content.kind === 'options' && parts[0] === 'problem') {
    const named = `${wording.problem}: ${content.problem.title}`
    const idea = parts[1] === undefined ? undefined : content.problem.ideas[Number(parts[1].slice(1))]
    if (idea === undefined) return named
    return parts[2] === 'd' && idea.drawing !== undefined ? `${named} › ${drawingLabel(idea.drawing)}` : `${named} › ${quoteOf(idea)}`
  }
  let nodes = rootsOf(content)
  let walked = ''
  let parent: Node | undefined
  for (const [index, part] of parts.entries()) {
    if (parent !== undefined && part === evidencePart) return `${nameOf(parent)} › ${wording.evidence}`
    if (parent?.type === 'change' && part === 'd' && parent.change.drawing !== undefined) return `${nameOf(parent)} › ${drawingLabel(parent.change.drawing)}`
    if (parent !== undefined && part.startsWith('i')) {
      const idea = ideasOf(parent)[Number(part.slice(1))]
      if (idea === undefined) return nameOf(parent)
      return parts[index + 1] === 'd' && idea.drawing !== undefined ? `${nameOf(parent)} › ${drawingLabel(idea.drawing)}` : `${nameOf(parent)} › ${quoteOf(idea)}`
    }
    walked = walked === '' ? part : `${walked}.${part}`
    const node = nodes.find((each) => each.path === walked)
    if (node === undefined) break
    parent = node
    nodes = childrenOf(node)
  }
  return parent === undefined ? 'the whole item' : nameOf(parent)
}

function nodesUnder(nodes: readonly Node[]): Node[] {
  return nodes.flatMap((node) => [node, ...nodesUnder(childrenOf(node))])
}

export type Part = { readonly kind: ReturnType<typeof kindOfNode> | 'idea'; readonly words: string }

export function partAt(content: Content, path: string): Part | undefined {
  const idea = /^(.*)\.i(\d+)$/.exec(path)
  const nodes = nodesUnder(rootsOf(content))
  if (idea !== null) {
    const [, parent = '', index = ''] = idea
    const owner = nodes.find((node) => node.path === parent)
    const ideas = owner !== undefined ? ideasOf(owner) : content.kind === 'options' && parent === 'problem' ? content.problem.ideas : []
    const found = ideas[Number(index)]
    return found === undefined ? undefined : { kind: 'idea', words: found.idea }
  }
  const node = nodes.find((each) => each.path === path)
  return node === undefined ? undefined : { kind: kindOfNode(node), words: titleOf(node) }
}

export function withRemoved<Shown>({ before, revised }: Reading, slot: (index: number) => string, parts: readonly Shown[], removedPart: (part: Part, path: string) => Shown): Shown[] {
  const removedAt = (at: string) =>
    (revised.removed.get(at) ?? []).flatMap((path) => {
      const part = before === undefined ? undefined : partAt(before, path)
      return part === undefined ? [] : [removedPart(part, path)]
    })
  return [...parts.flatMap((part, index) => [...removedAt(slot(index)), part]), ...removedAt(slot(parts.length))]
}
