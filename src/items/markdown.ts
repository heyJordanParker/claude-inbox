import { diffOf, treeOf } from './drawings.js'
import { revisionNumber, type Answer, type Author, type CodeDiff, type Content, type Drawing, type FileTree, type Idea, type Item, type Kind, type Note, type Person, type Problem, type Revision, type Shipped, type Solution, type Withdrawal } from './item.js'

export const format = 7

function authorOf({ session, agent }: Author): Author {
  return { session, ...(agent === undefined ? {} : { agent }) }
}

type Fields = Readonly<Record<string, unknown>>

type Token = { readonly line: string } | { readonly level: number; readonly heading: string } | { readonly info: string; readonly code: string }

type Fence = Extract<Token, { readonly info: string }>

type Section = { readonly level: number; readonly name: string; readonly attributes: Fields; readonly body: readonly Token[] }

const ideaSeparator = '\n\n\n'

const attributesStart = ' {"'

const codeFence = /^ {0,3}(`{3,})[^`]*$/

function oneLine(text: string, what: string): string {
  if (text.includes('\n')) throw new Error(`${what} must be one line, so it cannot hold a line break: ${JSON.stringify(text)}`)
  return text
}

function headingText(text: string, what: string): string {
  if (oneLine(text, what).includes(attributesStart)) throw new Error(`${what} cannot hold ${JSON.stringify(attributesStart.trim())}, which starts a heading's attributes in the stored Markdown: ${JSON.stringify(text)}`)
  return text
}

function ideaText(text: string): string {
  if (text.startsWith('\n') || text.endsWith('\n')) throw new Error(`An idea cannot start or end with a line break: ${JSON.stringify(text)}`)
  if (/^~{3,}/m.test(text)) throw new Error(`An idea cannot hold a line that starts with "~~~", which fences a drawing in the stored Markdown. Fence code with \`\`\`: ${JSON.stringify(text)}`)
  const tokens = tokensOf(text)
  if (tokens.some((token) => 'heading' in token)) throw new Error(`An idea cannot hold a line that starts with "#" outside a \`\`\` code block, which is a heading in the stored Markdown: ${JSON.stringify(text)}`)
  if (tokens.some((token) => 'line' in token && !token.line.includes('\n') && codeFence.test(token.line))) throw new Error(`An idea's \`\`\` code block must end with a \`\`\` line: ${JSON.stringify(text)}`)
  if (tokens.some((token, index) => isBlank(token) && isBlank(tokens[index + 1]))) throw new Error(`An idea cannot hold two blank lines in a row outside a \`\`\` code block, which separate ideas in the stored Markdown: ${JSON.stringify(text)}`)
  return text
}

function frontMatter(fields: Fields): string {
  return ['---', ...Object.entries(fields).flatMap(([key, value]) => (value === undefined ? [] : [`${key}: ${JSON.stringify(value)}`])), '---'].join('\n')
}

function documentText(fields: Fields, blocks: readonly string[]): string {
  return `${frontMatter(fields)}\n${blocks.join('\n\n')}\n`
}

function heading(level: number, name: string, attributes?: Fields): string {
  return `${'#'.repeat(level)} ${name}${attributes === undefined ? '' : ` ${JSON.stringify(attributes)}`}`
}

function fenced(info: string, code: string): string {
  const longest = Math.max(2, ...code.split('\n').map((line) => /^~*/.exec(line)?.[0].length ?? 0))
  const fence = '~'.repeat(longest + 1)
  return `${fence}${info}\n${code}\n${fence}`
}

function treeText(drawing: FileTree | Extract<Drawing, { readonly kind: 'api' }>): string {
  return treeOf(drawing)
    .map(({ mark, line }) => `${mark} ${line}`.trimEnd())
    .join('\n')
}

function drawingText(drawing: Drawing): string {
  if (drawing.kind === 'example') {
    if (!/^[^\s~{]\S*$/.test(drawing.language)) throw new Error(`An example's language must be one word, such as ts or text: ${JSON.stringify(drawing.language)}`)
    return fenced(drawing.language, drawing.code)
  }
  if (drawing.kind === 'diagram') return fenced(`mermaid ${JSON.stringify({ drawn: drawing.drawn })}`, drawing.mermaid)
  if (drawing.kind === 'diff') return fenced(`diff ${JSON.stringify({ path: drawing.path })}`, diffOf(drawing))
  if (drawing.kind === 'table' || drawing.kind === 'api') {
    const { kind, ...attributes } = drawing
    return fenced(`${kind} ${JSON.stringify(attributes)}`, drawing.kind === 'table' ? diffOf(drawing) : treeText(drawing))
  }
  const files = fenced(`files ${JSON.stringify({ files: drawing.files.map(({ diff: _, ...file }) => file) })}`, treeText(drawing))
  const diffs = drawing.files.flatMap((file) => (file.diff === undefined ? [] : [fenced(`diff ${JSON.stringify({ file: file.path })}`, file.diff)]))
  return [files, ...diffs].join('\n\n')
}

function ideasText(ideas: readonly Idea[]): string[] {
  if (ideas.length === 0) return []
  return [ideas.map(({ idea, drawing }) => [ideaText(idea), ...(drawing === undefined ? [] : [drawingText(drawing)])].join('\n\n')).join(ideaSeparator)]
}

function problemText(problem: Problem, level: number): string[] {
  return [
    heading(level, `Problem: ${headingText(problem.title, 'A Problem title')}`),
    ...ideasText(problem.ideas),
    ...(problem.solution === undefined ? [] : solutionText(problem.solution, level + 1, 'Solution')),
    ...(problem.problems ?? []).flatMap((each) => problemText(each, level + 1)),
  ]
}

function solutionText(solution: Solution, level: number, label: 'Solution' | 'Option'): string[] {
  return [
    heading(level, `${label}: ${headingText(solution.title, `A ${label} title`)}`, solution.precedent === undefined ? undefined : { precedent: solution.precedent }),
    ...ideasText(solution.ideas),
    ...(solution.problems ?? []).flatMap((each) => problemText(each, level + 1)),
  ]
}

function changeText(change: Shipped): string[] {
  return [
    heading(2, `Change: ${headingText(change.title, 'A change title')}`),
    ...(change.drawing === undefined ? [] : [drawingText(change.drawing)]),
    ...(change.evidence.length === 0 ? [] : [change.evidence.map((each) => `- ${oneLine(each, 'Evidence')}`).join('\n')]),
  ]
}

function contentText(content: Content): string[] {
  const title = heading(1, headingText(content.title, 'The title'))
  if (content.kind === 'question') return [title, content.why]
  const goal = `Goal: ${oneLine(content.goal, 'The goal')}`
  if (content.kind === 'proposal') return [title, goal, ...content.problems.flatMap((problem) => problemText(problem, 2))]
  if (content.kind === 'options') return [title, goal, ...problemText(content.problem, 2), ...content.options.flatMap((option) => solutionText(option, 2, 'Option'))]
  return [title, goal, ...content.changes.flatMap(changeText), ...(content.open ?? []).flatMap((problem) => problemText(problem, 2))]
}

function revisionText(item: Item, index: number, itemFields: Fields): string {
  const revision = item.revisions[index]
  if (revision === undefined) throw new Error(`The inbox item ${item.id} has no revision ${revisionNumber(index)}.`)
  return documentText({ format: item.format, kind: item.kind, revision: revisionNumber(index), by: authorOf(revision), at: revision.at, ...itemFields }, contentText(revision.content))
}

export function itemMarkdown(item: Item): string {
  const withdrawal = item.withdrawal === undefined ? undefined : { ...item.withdrawal, revision: revisionNumber(item.withdrawal.revision) }
  return revisionText(item, item.revisions.length - 1, { project: item.project, origin: item.origin, subscribers: item.subscribers, delivers: item.delivers, updatedAt: item.updatedAt, withdrawal })
}

export function revisionMarkdown(item: Item, index: number): string {
  return revisionText(item, index, {})
}

function quoted(words: string): string {
  return words
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

function noteText(note: Note, level: number, name: string): string[] {
  return [heading(level, name, { path: note.path, revision: revisionNumber(note.revision), target: note.target }), quoted(note.words)]
}

function answerText(answer: Answer): string[] {
  return [
    heading(2, answer.kind, { revision: revisionNumber(answer.revision), at: answer.at, ...(answer.option === undefined ? {} : { option: answer.option }), ...(answer.corrections === undefined ? {} : { corrections: answer.corrections.length }) }),
    ...(answer.words === undefined ? [] : [quoted(answer.words)]),
    ...(answer.corrections ?? []).flatMap((note) => noteText(note, 3, 'correction')),
  ]
}

export function personMarkdown(person: Person): string {
  return documentText({ lastRead: revisionNumber(person.lastRead), queuedAt: person.queuedAt }, [...person.answers.flatMap(answerText), ...person.notes.flatMap((note) => noteText(note, 2, 'note'))])
}

function documentOf(text: string, what: string): { readonly fields: Fields; readonly body: string } {
  const lines = text.split('\n')
  const end = lines.indexOf('---', 1)
  if (lines[0] !== '---' || end === -1) throw new Error(`${what} has no front matter between two --- lines.`)
  const fields = Object.fromEntries(
    lines.slice(1, end).map((line) => {
      const at = line.indexOf(': ')
      if (at === -1) throw new Error(`${what}'s front matter line ${JSON.stringify(line)} is not "key: value".`)
      return [line.slice(0, at), scalarOf(line.slice(at + 2))]
    }),
  )
  const body = lines.slice(end + 1).join('\n')
  return { fields, body: body.endsWith('\n') ? body.slice(0, -1) : body }
}

function scalarOf(text: string): unknown {
  const value = text.trim()
  const quoted = /^'(.*)'$/.exec(value)?.[1]
  if (quoted !== undefined) return quoted.replaceAll("''", "'")
  if (value === '~') return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function field<Each>(fields: Fields, key: string, what: string, isValid: (value: unknown) => boolean): Each {
  const value = fields[key]
  if (!isValid(value)) throw new Error(`${what}'s front matter has no valid ${key}: ${JSON.stringify(value)}`)
  return value as Each
}

const isText = (value: unknown) => typeof value === 'string'

const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0

const isObject = (value: unknown) => typeof value === 'object' && value !== null && !Array.isArray(value)

function tokensOf(text: string): Token[] {
  const lines = text.split('\n')
  const tokens: Token[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const fence = /^(~{3,})(.*)$/.exec(line)
    if (fence !== null) {
      const closer = new RegExp(`^~{${fence[1]?.length ?? 3},}[ \\t]*$`)
      const end = lines.findIndex((each, at) => at > index && closer.test(each))
      if (end === -1) throw new Error(`The block that opens with ${JSON.stringify(line)} never closes.`)
      tokens.push({ info: fence[2] ?? '', code: lines.slice(index + 1, end).join('\n') })
      index = end
      continue
    }
    const code = codeFence.exec(line)?.[1]
    const codeCloser = code === undefined ? undefined : new RegExp(`^ {0,3}\`{${code.length},}[ \\t]*$`)
    const codeEnd = codeCloser === undefined ? -1 : lines.findIndex((each, at) => at > index && codeCloser.test(each))
    if (codeEnd !== -1) {
      tokens.push({ line: lines.slice(index, codeEnd + 1).join('\n') })
      index = codeEnd
      continue
    }
    const titled = /^(#+) (.*)$/.exec(line)
    tokens.push(titled === null ? { line } : { level: titled[1]?.length ?? 1, heading: titled[2] ?? '' })
  }
  return tokens
}

const isFence = (token: Token): token is Fence => 'info' in token

const isBlank = (token: Token | undefined) => token !== undefined && 'line' in token && token.line === ''

function trimmed(tokens: readonly Token[]): readonly Token[] {
  const start = isBlank(tokens[0]) ? 1 : 0
  const end = tokens.length > start && isBlank(tokens.at(-1)) ? -1 : undefined
  return tokens.slice(start, end)
}

function attributed(text: string): { readonly name: string; readonly attributes: Fields } {
  const at = text.indexOf(attributesStart)
  if (at === -1) return { name: text, attributes: {} }
  return { name: text.slice(0, at), attributes: JSON.parse(text.slice(at + 1)) as Fields }
}

function sectionsOf(tokens: readonly Token[]): { readonly lead: readonly Token[]; readonly sections: readonly Section[] } {
  const first = tokens.findIndex((token) => 'heading' in token)
  const sections: Section[] = []
  for (let index = first === -1 ? tokens.length : first; index < tokens.length; ) {
    const token = tokens[index]
    const next = tokens.findIndex((each, at) => at > index && 'heading' in each)
    const end = next === -1 ? tokens.length : next
    if (token === undefined || !('heading' in token)) throw new Error('A section starts without a heading.')
    sections.push({ level: token.level, ...attributed(token.heading), body: trimmed(tokens.slice(index + 1, end)) })
    index = end
  }
  return { lead: tokens.slice(0, first === -1 ? tokens.length : first), sections }
}

function textOf(tokens: readonly Token[], what: string): string {
  return tokens
    .map((token) => {
      if (!('line' in token)) throw new Error(`${what} holds a heading or a block where only text belongs.`)
      return token.line
    })
    .join('\n')
}

function codeDiffOf(path: string, hunk: string): CodeDiff {
  const [header = '', ...lines] = hunk.split('\n')
  const start = Number(/^@@ -(\d+),/.exec(header)?.[1])
  if (!Number.isInteger(start)) throw new Error(`The diff of ${path} has no hunk header: ${JSON.stringify(header)}`)
  const firstChange = lines.findIndex((line) => !line.startsWith(' '))
  const lastChange = lines.findLastIndex((line) => !line.startsWith(' '))
  if (firstChange === -1) throw new Error(`The diff of ${path} changes no line.`)
  const changed = lines.slice(firstChange, lastChange + 1)
  const before = lines.slice(0, firstChange).map((line) => line.slice(1))
  return {
    kind: 'diff',
    path,
    old: changed.filter((line) => line.startsWith('-')).map((line) => line.slice(1)).join('\n'),
    new: changed.filter((line) => line.startsWith('+')).map((line) => line.slice(1)).join('\n'),
    startLine: start + before.length,
    before,
    after: lines.slice(lastChange + 1).map((line) => line.slice(1)),
  }
}

function drawingOf(fences: readonly Fence[]): Drawing {
  const [first, ...rest] = fences
  if (first === undefined) throw new Error('A drawing holds no block.')
  const { name, attributes } = attributed(first.info)
  const isPlain = !first.info.includes(attributesStart)
  if (!isPlain && name === 'files') {
    const diffs = rest.map((fence) => ({ file: attributed(fence.info).attributes['file'], diff: fence.code }))
    const files = (attributes['files'] as FileTree['files']).map((file) => {
      if (diffs[0]?.file !== file.path) return file
      const [next] = diffs.splice(0, 1)
      return { ...file, diff: next?.diff ?? '' }
    })
    if (diffs.length > 0) throw new Error(`A files drawing holds a diff of ${String(diffs[0]?.file)}, which it does not list.`)
    return { kind: 'files', files }
  }
  if (rest.length > 0) throw new Error(`Only a files drawing is followed by more blocks, and ${JSON.stringify(first.info)} is not one.`)
  if (isPlain) return { kind: 'example', language: first.info, code: first.code }
  if (name === 'mermaid') return { kind: 'diagram', mermaid: first.code, drawn: String(attributes['drawn']) }
  if (name === 'diff') return codeDiffOf(String(attributes['path']), first.code)
  if (name === 'table' || name === 'api') return { kind: name, ...attributes } as Drawing
  throw new Error(`A block named ${JSON.stringify(name)} is no drawing the inbox knows.`)
}

function ideasOf(tokens: readonly Token[], what: string): Idea[] {
  if (tokens.length === 0) return []
  const groups: Token[][] = [[]]
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) continue
    if (isBlank(token) && isBlank(tokens[index + 1])) {
      groups.push([])
      index += 1
      continue
    }
    groups.at(-1)?.push(token)
  }
  return groups.map((group) => {
    const first = group.findIndex(isFence)
    if (first === -1) return { idea: textOf(group, what) }
    if (!isBlank(group[first - 1])) throw new Error(`${what} has a drawing with no blank line above it.`)
    const fences = group.slice(first).filter((token) => !isBlank(token))
    if (!fences.every(isFence)) throw new Error(`${what} has text below a drawing.`)
    return { idea: textOf(group.slice(0, first - 1), what), drawing: drawingOf(fences) }
  })
}

function labeled(section: Section, label: string): string {
  const prefix = `${label}: `
  if (!section.name.startsWith(prefix)) throw new Error(`The heading ${JSON.stringify(section.name)} is not a ${label}.`)
  return section.name.slice(prefix.length)
}

function labelOf(section: Section): string {
  return section.name.slice(0, section.name.indexOf(': '))
}

type Cursor = { index: number }

function problemAt(sections: readonly Section[], at: Cursor): Problem {
  const head = sections[at.index]
  if (head === undefined) throw new Error('A Problem heading is missing.')
  const title = labeled(head, 'Problem')
  at.index += 1
  let solution: Solution | undefined
  const problems: Problem[] = []
  for (let next = sections[at.index]; next !== undefined && next.level > head.level; next = sections[at.index]) {
    if (next.level !== head.level + 1) throw new Error(`The heading ${JSON.stringify(next.name)} skips a level under the Problem "${title}".`)
    if (labelOf(next) === 'Solution') solution = solutionAt(sections, at, 'Solution')
    else problems.push(problemAt(sections, at))
  }
  return { title, ideas: ideasOf(head.body, `The Problem "${title}"`), ...(solution === undefined ? {} : { solution }), ...(problems.length === 0 ? {} : { problems }) }
}

function solutionAt(sections: readonly Section[], at: Cursor, label: 'Solution' | 'Option'): Solution {
  const head = sections[at.index]
  if (head === undefined) throw new Error(`A ${label} heading is missing.`)
  const title = labeled(head, label)
  at.index += 1
  const problems: Problem[] = []
  for (let next = sections[at.index]; next !== undefined && next.level > head.level; next = sections[at.index]) {
    if (next.level !== head.level + 1) throw new Error(`The heading ${JSON.stringify(next.name)} skips a level under the ${label} "${title}".`)
    problems.push(problemAt(sections, at))
  }
  const precedent = head.attributes['precedent']
  return { title, ...(typeof precedent === 'string' ? { precedent } : {}), ideas: ideasOf(head.body, `The ${label} "${title}"`), ...(problems.length === 0 ? {} : { problems }) }
}

function changeOf(section: Section): Shipped {
  const title = labeled(section, 'Change')
  const fences = section.body.filter(isFence)
  const evidence = section.body.flatMap((token) => {
    if (isFence(token) || isBlank(token)) return []
    if (!('line' in token) || !token.line.startsWith('- ')) throw new Error(`The change "${title}" holds text that is no evidence: ${JSON.stringify(token)}`)
    return [token.line.slice(2)]
  })
  return { title, ...(fences.length === 0 ? {} : { drawing: drawingOf(fences) }), evidence }
}

function contentOf(kind: Kind, body: string): Content {
  if (kind === 'question') {
    const split = body.indexOf('\n\n')
    if (!body.startsWith('# ') || split === -1) throw new Error('A question starts with its title as a # heading and a blank line.')
    return { kind, title: body.slice(2, split), why: body.slice(split + 2) }
  }
  const { lead, sections } = sectionsOf(tokensOf(body))
  const [top, ...rest] = sections
  if (lead.length > 0 || top === undefined || top.level !== 1) throw new Error('An item starts with its title as a # heading.')
  const goalLine = textOf(top.body, 'The goal')
  if (!goalLine.startsWith('Goal: ')) throw new Error(`An item's title is followed by "Goal: ", not ${JSON.stringify(goalLine)}.`)
  const goal = goalLine.slice('Goal: '.length)
  const at: Cursor = { index: 0 }
  const problems: Problem[] = []
  const options: Solution[] = []
  const changes: Shipped[] = []
  while (at.index < rest.length) {
    const section = rest[at.index]
    if (section === undefined || section.level !== 2) throw new Error(`The heading ${JSON.stringify(section?.name)} belongs under another heading.`)
    if (kind === 'report' && labelOf(section) === 'Change') {
      changes.push(changeOf(section))
      at.index += 1
    } else if (kind === 'options' && labelOf(section) === 'Option') options.push(solutionAt(rest, at, 'Option'))
    else problems.push(problemAt(rest, at))
  }
  if (kind === 'proposal') return { kind, title: top.name, goal, problems }
  if (kind === 'report') return { kind, title: top.name, goal, changes, ...(problems.length === 0 ? {} : { open: problems }) }
  const [problem] = problems
  if (problem === undefined || problems.length > 1) throw new Error(`A choice holds one Problem, not ${problems.length}.`)
  return { kind, title: top.name, goal, problem: { title: problem.title, ideas: problem.ideas }, options }
}

function revisionOf({ fields, body }: { readonly fields: Fields; readonly body: string }, kind: Kind, what: string): Revision & { readonly number: number } {
  const by = field<Author>(fields, 'by', what, isObject)
  return { ...authorOf(by), content: contentOf(kind, body), at: field<string>(fields, 'at', what, isText), number: field<number>(fields, 'revision', what, isCount) }
}

export function parseItem(id: string, text: string, earlier: readonly string[]): Item {
  const what = `items/${id}.md`
  const document = documentOf(text, what)
  const { fields } = document
  const kind = field<Kind>(fields, 'kind', what, (value) => value === 'proposal' || value === 'options' || value === 'question' || value === 'report')
  const { number: count, ...latest } = revisionOf(document, kind, what)
  const older = earlier.map((each, index) => revisionOf(documentOf(each, `revisions/${id}/ file ${index + 1}`), kind, `revisions/${id}/ file ${index + 1}`)).filter(({ number }) => number < count)
  const sorted = [...older].sort((a, b) => a.number - b.number)
  if (sorted.length !== count - 1 || sorted.some(({ number }, index) => number !== index + 1)) throw new Error(`${what} is revision ${count}, and revisions/${id}/ holds ${sorted.map(({ number }) => number).join(', ') || 'none'} of the ${count - 1} before it.`)
  const withdrawal = fields['withdrawal'] as (Withdrawal & { readonly revision: number }) | undefined
  const delivers = fields['delivers'] === undefined ? undefined : field<readonly string[]>(fields, 'delivers', what, (value) => Array.isArray(value) && value.every(isText))
  return {
    format: field<number>(fields, 'format', what, isCount),
    id,
    kind,
    project: field<string>(fields, 'project', what, isText),
    origin: field<Author>(fields, 'origin', what, isObject),
    subscribers: field<Item['subscribers']>(fields, 'subscribers', what, Array.isArray),
    revisions: [...sorted.map(({ number: _, ...revision }) => revision), latest],
    ...(withdrawal === undefined ? {} : { withdrawal: { ...withdrawal, revision: withdrawal.revision - 1 } }),
    ...(delivers === undefined ? {} : { delivers }),
    updatedAt: field<string>(fields, 'updatedAt', what, isText),
  }
}

function wordsOf(body: readonly Token[], what: string): string | undefined {
  if (body.length === 0) return undefined
  return textOf(body, what)
    .split('\n')
    .map((line) => {
      if (!line.startsWith('>')) throw new Error(`${what} holds a line outside its quote: ${JSON.stringify(line)}`)
      return line.replace(/^> ?/, '')
    })
    .join('\n')
}

function noteOf(section: Section, what: string): Note {
  const { path, revision, target } = section.attributes
  const words = wordsOf(section.body, what)
  if (typeof path !== 'string' || typeof revision !== 'number' || typeof target !== 'string' || words === undefined) throw new Error(`${what} needs a path, a revision, a target, and quoted words.`)
  return { path, revision: revision - 1, target, words }
}

export function parsePerson(id: string, text: string): Person {
  const what = `person/${id}.md`
  const { fields, body } = documentOf(text, what)
  const { lead, sections } = sectionsOf(tokensOf(body))
  if (lead.some((token) => !isBlank(token))) throw new Error(`${what} holds text above its first heading.`)
  const answers: Answer[] = []
  const notes: Note[] = []
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index]
    const where = `${what} heading ${index + 1}, ${JSON.stringify(section?.name)},`
    if (section === undefined || section.level !== 2) throw new Error(`${where} belongs under an answer.`)
    if (section.name === 'note') {
      notes.push(noteOf(section, where))
      continue
    }
    const { revision, at, option, corrections } = section.attributes
    if (typeof revision !== 'number' || typeof at !== 'string') throw new Error(`${where} needs a revision and a time.`)
    const count = typeof corrections === 'number' ? corrections : 0
    const listed = sections.slice(index + 1, index + 1 + count)
    if (listed.length !== count || listed.some((each) => each.level !== 3 || each.name !== 'correction')) throw new Error(`${where} names ${count} corrections, and ${listed.length} correction headings follow it.`)
    const words = wordsOf(section.body, where)
    answers.push({
      kind: section.name as Answer['kind'],
      ...(typeof option === 'string' ? { option } : {}),
      ...(words === undefined ? {} : { words }),
      ...(corrections === undefined ? {} : { corrections: listed.map((each, at) => noteOf(each, `${what} heading ${index + at + 2}, "correction",`)) }),
      revision: revision - 1,
      at,
    })
    index += count
  }
  return { notes, answers, lastRead: field<number>(fields, 'lastRead', what, isCount) - 1, queuedAt: field<string>(fields, 'queuedAt', what, isText) }
}
