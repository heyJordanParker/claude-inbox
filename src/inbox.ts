import { fs } from '../node_modules/@cmodjs/core/mod.js'

export type Change = 'add' | 'remove' | 'edit'

export type Declaration = { readonly name: string; readonly header: string; readonly line: number }

export type Caller = { readonly name: string; readonly file: string; readonly line: number }

export type FileTree = {
  readonly kind: 'files'
  readonly files: readonly {
    readonly path: string
    readonly change: Change
    readonly note: string
    readonly declarations: readonly Declaration[]
  }[]
}

export type ApiChange = {
  readonly kind: 'api'
  readonly path: string
  readonly changes: readonly {
    readonly name: string
    readonly change: Change
    readonly signature?: string
    readonly note: string
    readonly callers: readonly Caller[]
  }[]
  readonly declarations: readonly Declaration[]
}

export type CodeDiff = {
  readonly kind: 'diff'
  readonly path: string
  readonly old: string
  readonly new: string
  readonly startLine: number
  readonly before: readonly string[]
  readonly after: readonly string[]
}

export type TableChange = {
  readonly kind: 'table'
  readonly table: string
  readonly columns: readonly { readonly name: string; readonly type: string; readonly change?: Change; readonly note?: string }[]
}

export type Diagram = { readonly kind: 'diagram'; readonly mermaid: string }

export type Example = { readonly kind: 'example'; readonly language: string; readonly code: string }

export type Drawing = FileTree | ApiChange | CodeDiff | TableChange | Diagram | Example

export type Solution = {
  readonly title: string
  readonly summary: string
  readonly idea: string
  readonly precedent?: string
  readonly capabilities: readonly string[]
  readonly drawings?: readonly Drawing[]
  readonly problems?: readonly Problem[]
}

export type Problem = {
  readonly title: string
  readonly summary: string
  readonly impact: string
  readonly solution?: Solution
  readonly problems?: readonly Problem[]
}

export type ProposalContent = { readonly kind: 'proposal'; readonly title: string; readonly goal: string; readonly problems: readonly Problem[] }

export type OptionsContent = { readonly kind: 'options'; readonly title: string; readonly goal: string; readonly problem: Problem; readonly options: readonly Solution[] }

export type QuestionContent = { readonly kind: 'question'; readonly title: string; readonly why: string }

export type Content = ProposalContent | OptionsContent | QuestionContent

export type Kind = Content['kind']

export type Author = { readonly session: string; readonly title: string; readonly agent?: string }

export type Revision = Author & { readonly content: Content; readonly at: string }

export type Answer = {
  readonly kind: 'approve' | 'option' | 'answer' | 'correct' | 'withdraw'
  readonly option?: string
  readonly words?: string
  readonly target?: string
  readonly revision: number
  readonly by: 'person' | Author
  readonly at: string
}

export type Status = 'waiting' | 'corrected' | 'answered' | 'withdrawn'

export type Item = {
  readonly id: string
  readonly kind: Kind
  readonly project: string
  readonly origin: Author
  readonly subscribers: readonly Author[]
  readonly revisions: readonly Revision[]
  readonly answers: readonly Answer[]
  readonly lastRead: number
  readonly queuedAt: string
  readonly status: Status
}

export type Store = {
  readonly folder: string
  readonly items: string
  readonly changed: string
}

export function storeIn(dataFolder: string): Store {
  return { folder: dataFolder, items: `${dataFolder}/items`, changed: `${dataFolder}/changed` }
}

export async function readItems(store: Store): Promise<Item[]> {
  if (!(await fs.exists(store.items))) return []
  const entries = await fs.list(store.items)
  const items = await Promise.all(entries.filter((entry) => entry.isFile && entry.name.endsWith('.json')).map(async (entry) => JSON.parse(await fs.read(`${store.items}/${entry.name}`)) as Item))
  return items.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
}

export async function writeItem(store: Store, item: Item): Promise<void> {
  await fs.write(`${store.items}/${item.id}.json`, `${JSON.stringify(item, null, 2)}\n`)
  await fs.write(store.changed, `${new Date().toISOString()} ${item.id}\n`)
}

export function current(item: Item): Content {
  const revision = item.revisions.at(-1)
  if (revision === undefined) throw new Error(`The inbox item ${item.id} has no revision.`)
  return revision.content
}

export function queue(items: readonly Item[]): Item[] {
  return items.filter((item) => item.status === 'waiting')
}

export function withAgents(items: readonly Item[]): Item[] {
  return items.filter((item) => item.status === 'corrected')
}

export function newId(title: string, taken: readonly string[]): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'item'
  if (!taken.includes(slug)) return slug
  for (let index = 2; ; index += 1) if (!taken.includes(`${slug}-${index}`)) return `${slug}-${index}`
}

export function isSameAuthor(a: Author, b: Author): boolean {
  return a.session === b.session
}
