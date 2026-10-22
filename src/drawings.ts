import { fs, process } from '../node_modules/@cmodjs/core/mod.js'
import type { Caller, Change, Content, Declaration, Drawing, Problem, Solution } from './inbox.js'

export type DeclaredDrawing =
  | { readonly kind: 'files'; readonly files: readonly { readonly path: string; readonly change: Change; readonly note: string }[] }
  | { readonly kind: 'api'; readonly path: string; readonly changes: readonly { readonly name: string; readonly change: Change; readonly signature?: string; readonly note: string }[] }
  | { readonly kind: 'diff'; readonly path: string; readonly old: string; readonly new: string }
  | Extract<Drawing, { kind: 'table' | 'diagram' | 'example' }>

type Declared<T> = T extends Solution
  ? Omit<Solution, 'drawings' | 'problems'> & { readonly drawings?: readonly DeclaredDrawing[]; readonly problems?: readonly Declared<Problem>[] }
  : T extends Problem
    ? Omit<Problem, 'solution' | 'problems'> & { readonly solution?: Declared<Solution>; readonly problems?: readonly Declared<Problem>[] }
    : never

export type DeclaredSolution = Declared<Solution>

export type DeclaredProblem = Declared<Problem>

export type DeclaredContent =
  | { readonly kind: 'proposal'; readonly title: string; readonly goal: string; readonly problems: readonly DeclaredProblem[] }
  | { readonly kind: 'options'; readonly title: string; readonly goal: string; readonly problem: DeclaredProblem; readonly options: readonly DeclaredSolution[] }
  | Extract<Content, { kind: 'question' }>

const contextLines = 3

export async function completeContent(content: DeclaredContent, project: string): Promise<Content> {
  const refusals: string[] = []
  const reader = codeReader(project)
  const solution = async (declared: DeclaredSolution, where: string): Promise<Solution> => {
    const { drawings, problems, ...rest } = declared
    const here = `${where} › ${declared.title}`
    return {
      ...rest,
      ...(drawings === undefined ? {} : { drawings: await inOrder(drawings, (drawing) => completeDrawing(drawing, reader, here, refusals)) }),
      ...(problems === undefined ? {} : { problems: await inOrder(problems, (each) => problem(each, here)) }),
    }
  }
  const problem = async (declared: DeclaredProblem, where: string): Promise<Problem> => {
    const { solution: declaredSolution, problems, ...rest } = declared
    const here = `${where} › ${declared.title}`
    return {
      ...rest,
      ...(declaredSolution === undefined ? {} : { solution: await solution(declaredSolution, here) }),
      ...(problems === undefined ? {} : { problems: await inOrder(problems, (each) => problem(each, here)) }),
    }
  }
  const completed: Content =
    content.kind === 'question'
      ? content
      : content.kind === 'proposal'
        ? { ...content, problems: await inOrder(content.problems, (each) => problem(each, content.title)) }
        : { ...content, problem: await problem(content.problem, content.title), options: await inOrder(content.options, (each) => solution(each, content.title)) }
  if (refusals.length > 0) throw new Error(`The inbox refused it, because the code does not match:\n${refusals.map((line) => `- ${line}`).join('\n')}`)
  return completed
}

async function inOrder<Each, Done>(list: readonly Each[], complete: (each: Each) => Promise<Done>): Promise<Done[]> {
  const done: Done[] = []
  for (const each of list) done.push(await complete(each))
  return done
}

type CodeReader = {
  readonly project: string
  path(file: string): string
  exists(file: string): Promise<boolean>
  text(file: string): Promise<string>
  declarations(file: string): Promise<Declaration[]>
  callers(name: string): Promise<Caller[]>
}

export function codeReader(project: string): CodeReader {
  const path = (file: string) => (file.startsWith('/') ? file : `${project}/${file}`)
  const trace = async (args: readonly string[]): Promise<unknown> => {
    const { exitCode, stdout, stderr } = await process.run(['trace', '-C', project, ...args, '--json', '--budget', '0'])
    if (exitCode !== 0) throw new Error(`trace ${args.join(' ')} failed: ${stderr.trim() || stdout.trim()}`)
    return JSON.parse(stdout)
  }
  return {
    project,
    path,
    exists: (file) => fs.exists(path(file)),
    text: (file) => fs.read(path(file)),
    async declarations(file) {
      const answer = (await trace(['api', file])) as { results?: readonly { name: string; header: string; line: number }[] }
      return (answer.results ?? []).map(({ name, header, line }) => ({ name, header, line }))
    },
    async callers(name) {
      const answer = (await trace(['callers', name, '--limit', '20'])) as {
        results?: readonly { callers?: readonly { label: string; source_file: string; source_line: number }[] }[]
      }
      return (answer.results ?? []).flatMap((result) => (result.callers ?? []).map(({ label, source_file, source_line }) => ({ name: label, file: source_file, line: source_line })))
    },
  }
}

async function completeDrawing(drawing: DeclaredDrawing, code: CodeReader, where: string, refusals: string[]): Promise<Drawing> {
  if (drawing.kind === 'files') {
    const files = await inOrder(drawing.files, async (file) => {
      const exists = await code.exists(file.path)
      if (file.change === 'add' && exists) refusals.push(`${where}: ${file.path} already exists, so it cannot be added. Mark it edit.`)
      if (file.change !== 'add' && !exists) refusals.push(`${where}: ${file.path} does not exist, so it cannot be ${file.change === 'edit' ? 'edited' : 'removed'}.`)
      return { ...file, declarations: exists ? await code.declarations(file.path) : [] }
    })
    return { kind: 'files', files }
  }
  if (drawing.kind === 'api') {
    const exists = await code.exists(drawing.path)
    const isNew = drawing.changes.every((change) => change.change === 'add')
    if (!exists && !isNew) refusals.push(`${where}: ${drawing.path} does not exist, so its signatures cannot change.`)
    const declarations = exists ? await code.declarations(drawing.path) : []
    const names = new Set(declarations.map((declaration) => declaration.name))
    const changes = await inOrder(drawing.changes, async (change) => {
      if (change.change !== 'add' && exists && !names.has(change.name)) refusals.push(`${where}: ${drawing.path} declares no ${change.name}. It declares ${[...names].join(', ') || 'nothing public'}.`)
      if (change.change !== 'remove' && change.signature === undefined) refusals.push(`${where}: ${change.name} needs its signature, because it is ${change.change === 'add' ? 'added' : 'edited'}.`)
      return { ...change, callers: change.change === 'add' || !names.has(change.name) ? [] : await code.callers(change.name) }
    })
    return { kind: 'api', path: drawing.path, changes, declarations }
  }
  if (drawing.kind === 'diff') {
    if (!(await code.exists(drawing.path))) {
      refusals.push(`${where}: ${drawing.path} does not exist, so its lines cannot change.`)
      return { ...drawing, startLine: 1, before: [], after: [] }
    }
    const text = await code.text(drawing.path)
    const at = text.indexOf(drawing.old)
    if (at === -1) {
      refusals.push(`${where}: ${drawing.path} does not hold the old lines. Copy them from the file as they are now.`)
      return { ...drawing, startLine: 1, before: [], after: [] }
    }
    const end = at + drawing.old.length
    if ((at > 0 && text[at - 1] !== '\n') || (end < text.length && text[end] !== '\n')) {
      refusals.push(`${where}: the old lines of ${drawing.path} start or end inside a line. Give whole lines.`)
      return { ...drawing, startLine: 1, before: [], after: [] }
    }
    const lines = text.split('\n')
    const startLine = text.slice(0, at).split('\n').length
    const endLine = startLine + drawing.old.split('\n').length - 1
    return {
      ...drawing,
      startLine,
      before: lines.slice(Math.max(0, startLine - 1 - contextLines), startLine - 1),
      after: lines.slice(endLine, endLine + contextLines),
    }
  }
  return drawing
}
