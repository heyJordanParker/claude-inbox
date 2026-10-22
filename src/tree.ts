import type { Content, Drawing, Problem, Solution } from './inbox.js'

export type Node =
  | { readonly type: 'problem'; readonly path: string; readonly problem: Problem }
  | { readonly type: 'solution'; readonly path: string; readonly solution: Solution; readonly label: string }
  | { readonly type: 'drawing'; readonly path: string; readonly drawing: Drawing }

export function problemPath(parent: string, index: number): string {
  return parent === '' ? `p${index}` : `${parent}.p${index}`
}

export function childrenOf(node: Node): Node[] {
  if (node.type === 'drawing') return []
  if (node.type === 'problem') {
    const { solution, problems = [] } = node.problem
    return [
      ...(solution === undefined ? [] : [{ type: 'solution' as const, path: `${node.path}.s`, solution, label: 'Solution' }]),
      ...problems.map((problem, index) => ({ type: 'problem' as const, path: problemPath(node.path, index), problem })),
    ]
  }
  const { drawings = [], problems = [] } = node.solution
  return [
    ...drawings.map((drawing, index) => ({ type: 'drawing' as const, path: `${node.path}.d${index}`, drawing })),
    ...problems.map((problem, index) => ({ type: 'problem' as const, path: problemPath(node.path, index), problem })),
  ]
}

export function rootsOf(content: Content): Node[] {
  if (content.kind === 'question') return []
  if (content.kind === 'proposal') return content.problems.map((problem, index) => ({ type: 'problem' as const, path: problemPath('', index), problem }))
  return content.options.map((solution, index) => ({ type: 'solution' as const, path: `o${index}`, solution, label: `Option ${index + 1}` }))
}

function ownOf(node: Node): string {
  if (node.type === 'drawing') return JSON.stringify(node.drawing)
  if (node.type === 'problem') {
    const { title, summary, impact } = node.problem
    return JSON.stringify({ title, summary, impact })
  }
  const { title, summary, idea, precedent, capabilities } = node.solution
  return JSON.stringify({ title, summary, idea, precedent, capabilities })
}

function everyNode(content: Content): Map<string, string> {
  const found = new Map<string, string>()
  const visit = (node: Node) => {
    found.set(node.path, ownOf(node))
    childrenOf(node).forEach(visit)
  }
  rootsOf(content).forEach(visit)
  if (content.kind === 'options') found.set('problem', JSON.stringify(content.problem))
  if (content.kind !== 'question') found.set('goal', content.goal)
  return found
}

export function changedPaths(before: Content | undefined, now: Content): ReadonlySet<string> {
  if (before === undefined) return new Set()
  const was = everyNode(before)
  return new Set([...everyNode(now)].filter(([path, own]) => was.get(path) !== own).map(([path]) => path))
}

export function changesInside(changed: ReadonlySet<string>, path: string): boolean {
  return [...changed].some((each) => each.startsWith(`${path}.`))
}

export function titlePath(content: Content, path: string): string {
  const names: string[] = []
  let nodes = rootsOf(content)
  let walked = ''
  for (const part of path.split('.')) {
    walked = walked === '' ? part : `${walked}.${part}`
    const node = nodes.find((each) => each.path === walked)
    if (node === undefined) break
    names.push(node.type === 'drawing' ? node.drawing.kind : node.type === 'problem' ? node.problem.title : `${node.label}: ${node.solution.title}`)
    nodes = childrenOf(node)
  }
  return names.join(' › ')
}
