import { fs, messageOf, process } from '../node_modules/@cmodjs/core/mod.js'
import { drawnDiagram } from './items/drawings.js'
import type { Change, Content, Declaration, Drawing, Idea, Problem, Shipped, Solution } from './items/item.js'

export type DeclaredDrawing =
  | { readonly kind: 'files'; readonly files: readonly { readonly path: string; readonly change: Change; readonly note: string }[] }
  | { readonly kind: 'api'; readonly path: string; readonly changes: readonly { readonly name: string; readonly change: Change; readonly signature?: string; readonly note: string }[] }
  | { readonly kind: 'diff'; readonly path: string; readonly old: string; readonly new: string }
  | { readonly kind: 'diagram'; readonly mermaid: string }
  | Extract<Drawing, { kind: 'table' | 'example' }>

export type DeclaredIdea = Omit<Idea, 'drawing'> & { readonly drawing?: DeclaredDrawing }

export type DeclaredSolution = Omit<Solution, 'ideas' | 'problems'> & { readonly ideas: readonly DeclaredIdea[]; readonly problems?: readonly DeclaredProblem[] }

export type DeclaredProblem = Omit<Problem, 'ideas' | 'solution' | 'problems'> & {
  readonly ideas: readonly DeclaredIdea[]
  readonly solution?: DeclaredSolution
  readonly problems?: readonly DeclaredProblem[]
}

export type DeclaredShipped = Omit<Shipped, 'drawing'> & { readonly drawing?: DeclaredDrawing }

export type DeclaredContent =
  | { readonly kind: 'proposal'; readonly title: string; readonly goal: string; readonly problems: readonly DeclaredProblem[] }
  | { readonly kind: 'options'; readonly title: string; readonly goal: string; readonly problem: Omit<DeclaredProblem, 'solution' | 'problems'>; readonly options: readonly DeclaredSolution[] }
  | { readonly kind: 'report'; readonly title: string; readonly goal: string; readonly changes: readonly DeclaredShipped[]; readonly open?: readonly DeclaredProblem[] }
  | Extract<Content, { kind: 'question' }>

const contextLines = 3

const memberKinds: ReadonlySet<string> = new Set(['property', 'field'])

export async function completeContent(content: DeclaredContent, project: string): Promise<Content> {
  const refusals: string[] = []
  const reader = codeReader(project)
  const ideas = (declared: readonly DeclaredIdea[], here: string): Promise<Idea[]> =>
    inOrder(declared, async ({ drawing, ...rest }) => {
      refusals.push(...longList(rest.idea, here))
      return { ...rest, ...(drawing === undefined ? {} : { drawing: await completeDrawing(drawing, reader, here, refusals, false) }) }
    })
  const solution = async (declared: DeclaredSolution, where: string): Promise<Solution> => {
    const { problems, ...rest } = declared
    const here = `${where} › ${declared.title}`
    refusals.push(...unshown(declared, here))
    return {
      ...rest,
      ideas: await ideas(declared.ideas, here),
      ...(problems === undefined ? {} : { problems: await inOrder(problems, (each) => problem(each, here)) }),
    }
  }
  const problem = async (declared: DeclaredProblem, where: string): Promise<Problem> => {
    const { solution: declaredSolution, problems, ...rest } = declared
    const here = `${where} › ${declared.title}`
    return {
      ...rest,
      ideas: await ideas(declared.ideas, here),
      ...(declaredSolution === undefined ? {} : { solution: await solution(declaredSolution, here) }),
      ...(problems === undefined ? {} : { problems: await inOrder(problems, (each) => problem(each, here)) }),
    }
  }
  const shipped = async ({ drawing, ...rest }: DeclaredShipped, where: string): Promise<Shipped> => ({
    ...rest,
    ...(drawing === undefined ? {} : { drawing: await completeDrawing(drawing, reader, `${where} › ${rest.title}`, refusals, true) }),
  })
  const completed = await completeKind(content, problem, solution, shipped)
  if (refusals.length > 0) throw new Error(`The inbox refused it:\n${refusals.map((line) => `- ${line}`).join('\n')}`)
  return completed
}

const longestList = 4

function longList(idea: string, here: string): string[] {
  let items = 0
  let run = 0
  let isFenced = false
  for (const line of idea.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) isFenced = !isFenced
    if (isFenced || line.trim() === '' || /^\s+\S/.test(line)) continue
    run = /^([-*+]|\d+[.)])\s/.test(line) ? run + 1 : 0
    items = Math.max(items, run)
  }
  if (items <= longestList) return []
  return [`${here}: an idea lists ${items} items. Keep a list to ${longestList} items of one kind. Give each point of a longer list its own idea, and draw steps that happen in order as a diagram.`]
}

function unshown(solution: DeclaredSolution, here: string): string[] {
  if (solution.ideas.some((idea) => idea.drawing !== undefined)) return []
  return [`${here}: shows nothing. Put a drawing under the idea it shows: the files, public API, stored data, diagram, or example that proves it.`]
}

async function completeKind(
  content: DeclaredContent,
  problem: (declared: DeclaredProblem, where: string) => Promise<Problem>,
  solution: (declared: DeclaredSolution, where: string) => Promise<Solution>,
  shipped: (declared: DeclaredShipped, where: string) => Promise<Shipped>,
): Promise<Content> {
  if (content.kind === 'question') return content
  if (content.kind === 'proposal') return { ...content, problems: await inOrder(content.problems, (each) => problem(each, content.title)) }
  if (content.kind === 'options') return { ...content, problem: await problem(content.problem, content.title), options: await inOrder(content.options, (each) => solution(each, content.title)) }
  const { open, ...rest } = content
  return {
    ...rest,
    changes: await inOrder(content.changes, (each) => shipped(each, content.title)),
    ...(open === undefined ? {} : { open: await inOrder(open, (each) => problem(each, content.title)) }),
  }
}

async function inOrder<Each, Done>(list: readonly Each[], complete: (each: Each) => Promise<Done>): Promise<Done[]> {
  const done: Done[] = []
  for (const each of list) done.push(await complete(each))
  return done
}

function codeReader(project: string) {
  const path = (file: string) => `${project}/${file}`
  const git = async (args: readonly string[]): Promise<string> => (await process.run(['git', '-C', project, ...args])).stdout
  const trace = async (args: readonly string[]): Promise<unknown> => {
    const { exitCode, stdout, stderr } = await process.run(['trace', '-C', project, ...args, '--json'])
    if (exitCode !== 0) throw new Error(`trace ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`)
    return JSON.parse(stdout)
  }
  return {
    exists: (file: string) => fs.exists(path(file)),
    text: (file: string) => fs.read(path(file)),
    async declarations(file: string, revision?: string): Promise<Declaration[]> {
      const answer = (await trace(['api', file, ...(revision === undefined ? [] : ['--revision', revision])])) as { results?: readonly { name: string; kind: string; header: string; line: number }[] }
      return (answer.results ?? []).filter(({ kind }) => !memberKinds.has(kind)).map(({ name, header, line }) => ({ name, header, line }))
    },
    isCommitted: async (file: string) => (await git(['ls-tree', 'HEAD', '--', file])).trim() !== '',
    async diff(file: string, change: Change): Promise<string> {
      const tracked = await git(['diff', 'HEAD', '--', file])
      return hunksOf(tracked === '' && change === 'add' ? await git(['diff', '--no-index', '--', '/dev/null', file]) : tracked)
    },
  }
}

function fileRefusal(path: string, change: Change, exists: boolean, isDone: boolean): string | undefined {
  if (isDone) {
    if (change === 'remove' && exists) return `${path} still exists, so it was not removed.`
    if (change !== 'remove' && !exists) return `${path} does not exist, so it was not ${change === 'add' ? 'added' : 'edited'}.`
    return undefined
  }
  if (change === 'add' && exists) return `${path} already exists, so it cannot be added. Mark it edit.`
  if (change !== 'add' && !exists) return `${path} does not exist, so it cannot be ${change === 'edit' ? 'edited' : 'removed'}.`
  return undefined
}

async function completeDrawing(drawing: DeclaredDrawing, code: ReturnType<typeof codeReader>, where: string, refusals: string[], isDone: boolean): Promise<Drawing> {
  const refuse = (reason: string | undefined) => void (reason === undefined ? undefined : refusals.push(`${where}: ${reason}`))
  if (drawing.kind === 'files') {
    const files = await inOrder(drawing.files, async (file) => {
      refuse(fileRefusal(file.path, file.change, await code.exists(file.path), isDone))
      if (isDone && file.change === 'remove' && !(await code.isCommitted(file.path))) refuse(`${file.path} is not in the last commit, so the work removed nothing there.`)
      const diff = isDone ? await code.diff(file.path, file.change) : ''
      return diff === '' ? file : { ...file, diff }
    })
    return { kind: 'files', files }
  }
  if (drawing.kind === 'api') {
    const exists = await code.exists(drawing.path)
    const isNew = drawing.changes.every((change) => change.change === (isDone ? 'remove' : 'add'))
    if (!exists && !isNew) refuse(`${drawing.path} does not exist, so its signatures ${isDone ? 'did not' : 'cannot'} change.`)
    const declarations = exists ? await code.declarations(drawing.path) : []
    const before = isDone && drawing.changes.some((change) => change.change !== 'add') ? await code.declarations(drawing.path, 'HEAD') : declarations
    const names = new Set(declarations.map((declaration) => declaration.name))
    const declared = `It declares ${[...names].join(', ') || 'nothing public'}.`
    const changes = await inOrder(drawing.changes, async (change) => {
      const shouldExist = isDone ? change.change !== 'remove' : change.change !== 'add'
      if (exists && shouldExist && !names.has(change.name)) refuse(`${drawing.path} declares no ${change.name}. ${declared}`)
      if (exists && isDone && change.change === 'remove' && names.has(change.name)) refuse(`${drawing.path} still declares ${change.name}, so it was not removed.`)
      if (change.change !== 'remove' && change.signature === undefined) refuse(`${change.name} needs its signature, because it is ${change.change === 'add' ? 'added' : 'edited'}.`)
      const was = change.change === 'add' ? undefined : before.find((declaration) => declaration.name === change.name)
      const now = isDone ? declarations.find((declaration) => declaration.name === change.name)?.header : undefined
      return { ...change, ...(now === undefined ? {} : { signature: now }), ...(was === undefined ? {} : { was }) }
    })
    return { kind: 'api', path: drawing.path, changes, declarations }
  }
  if (drawing.kind === 'diff') {
    const old = linesOf(drawing.old)
    const fresh = drawing.new === '' ? [] : linesOf(drawing.new)
    const normalized = { ...drawing, old: old.join('\n'), new: fresh.join('\n') }
    if (!(await code.exists(drawing.path))) {
      refuse(`${drawing.path} does not exist, so its lines ${isDone ? 'did not' : 'cannot'} change.`)
      return { ...normalized, startLine: 1, before: [], after: [] }
    }
    if (isDone && fresh.length === 0) {
      refuse(`${drawing.path}: a report finds a diff by its new lines, so keep the line next to the deleted ones in both old and new.`)
      return { ...normalized, startLine: 1, before: [], after: [] }
    }
    const lines = linesOf(await code.text(drawing.path))
    const held = isDone ? fresh : old
    const which = isDone ? 'new' : 'old'
    const matches = held.length === 0 ? [] : lines.flatMap((_, index) => (held.every((line, offset) => lines[index + offset] === line) ? [index] : []))
    if (matches.length !== 1) {
      refuse(
        matches.length === 0
          ? `${drawing.path} does not hold the ${which} lines as whole lines. Copy them from the file as they are now.`
          : `${drawing.path} holds the ${which} lines ${matches.length} times, at lines ${matches.map((index) => index + 1).join(', ')}. Add the lines around them so they match once.`,
      )
      return { ...normalized, startLine: 1, before: [], after: [] }
    }
    const [at = 0] = matches
    return {
      ...normalized,
      startLine: at + 1,
      before: lines.slice(Math.max(0, at - contextLines), at),
      after: lines.slice(at + held.length, at + held.length + contextLines),
    }
  }
  if (drawing.kind === 'table') {
    for (const column of drawing.columns) if (column.change === 'edit' && column.was === undefined) refuse(`${drawing.table}: ${column.name} needs was, its type before the change, because it is edited.`)
    return drawing
  }
  if (drawing.kind === 'diagram') {
    try {
      return { ...drawing, drawn: drawnDiagram(drawing.mermaid) }
    } catch (error) {
      refuse(`the diagram is not Mermaid the inbox can draw: ${messageOf(error)}. It draws flowcharts, sequence, state, class, and ER diagrams.`)
      return { ...drawing, drawn: '' }
    }
  }
  return drawing
}

function hunksOf(diff: string): string {
  const start = diff.search(/^@@ /m)
  return start === -1 ? '' : diff.slice(start).trimEnd()
}

function linesOf(text: string): string[] {
  const unified = text.replace(/\r\n/g, '\n')
  return (unified.endsWith('\n') ? unified.slice(0, -1) : unified).split('\n')
}
