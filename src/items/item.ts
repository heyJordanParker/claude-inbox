export type Change = 'add' | 'remove' | 'edit'

export type Declaration = { readonly name: string; readonly header: string; readonly line: number }

export type FileTree = {
  readonly kind: 'files'
  readonly files: readonly {
    readonly path: string
    readonly change: Change
    readonly note: string
    readonly diff?: string
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
    readonly was?: Declaration
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
  readonly columns: readonly { readonly name: string; readonly type: string; readonly change?: Change; readonly was?: string; readonly note?: string }[]
}

export type Diagram = { readonly kind: 'diagram'; readonly mermaid: string; readonly drawn: string }

export type Example = { readonly kind: 'example'; readonly language: string; readonly code: string }

export type Drawing = FileTree | ApiChange | CodeDiff | TableChange | Diagram | Example

export type Idea = {
  readonly idea: string
  readonly drawing?: Drawing
}

export type Solution = {
  readonly title: string
  readonly precedent?: string
  readonly ideas: readonly Idea[]
  readonly problems?: readonly Problem[]
}

export type Problem = {
  readonly title: string
  readonly ideas: readonly Idea[]
  readonly solution?: Solution
  readonly problems?: readonly Problem[]
}

export type ProposalContent = { readonly kind: 'proposal'; readonly title: string; readonly goal: string; readonly problems: readonly Problem[] }

export type OptionsContent = {
  readonly kind: 'options'
  readonly title: string
  readonly goal: string
  readonly problem: Omit<Problem, 'solution' | 'problems'>
  readonly options: readonly Solution[]
}

export type QuestionContent = { readonly kind: 'question'; readonly title: string; readonly why: string }

export type Shipped = { readonly title: string; readonly drawing?: Drawing; readonly evidence: readonly string[] }

export type ReportContent = {
  readonly kind: 'report'
  readonly title: string
  readonly goal: string
  readonly changes: readonly Shipped[]
  readonly open?: readonly Problem[]
}

export type Content = ProposalContent | OptionsContent | QuestionContent | ReportContent

export type Kind = Content['kind']

export type Author = { readonly session: string; readonly agent?: string }

export type Sender = { readonly title: string; readonly color?: string; readonly isRunning?: boolean }

export type Senders = Readonly<Record<string, Sender>>

const longestTitle = 32

function titleOf(title: string, agent: string | undefined, project: string, session: string): string {
  const line = title.split('\n')[0]?.trim() ?? ''
  return line === '' || line.length > longestTitle ? [agent ?? projectName(project), session.slice(0, 8)].filter((part) => part !== '').join(' ') : line
}

export function sendersOf(sessions: readonly { readonly id: string; readonly title: string; readonly color?: string; readonly project: string; readonly agentType?: string; readonly isRunning: boolean }[]): Senders {
  return Object.fromEntries(sessions.map((each) => [each.id, { title: titleOf(each.title, each.agentType, each.project, each.id), ...(each.color === undefined ? {} : { color: each.color }), isRunning: each.isRunning }]))
}

export function senderOf(author: Author, project: string, senders: Senders): Sender {
  const known = senders[author.session]
  return known === undefined || known.title === '' ? { title: titleOf('', author.agent, project, author.session) } : known
}

function sessionsOf(item: Item): string[] {
  return [item.origin, ...item.subscribers, ...item.revisions, ...(item.withdrawal === undefined ? [] : [item.withdrawal.by])].map((each) => each.session)
}

export function isUnnamed(items: readonly Item[], senders: Senders): boolean {
  return items.some((item) => sessionsOf(item).some((id) => senders[id] === undefined))
}

export function sendersFor(items: readonly Item[], listed: Senders): Senders {
  return Object.fromEntries(items.flatMap(sessionsOf).map((id) => [id, listed[id] ?? { title: '', isRunning: false }]))
}

type Subscriber = Author & { readonly since: string }

export type Revision = Author & { readonly content: Content; readonly at: string }

export type Note = { readonly path: string; readonly revision: number; readonly target: string; readonly words: string }

export type Answer = {
  readonly kind: 'approve' | 'reject' | 'option' | 'answer' | 'acknowledge' | 'correct'
  readonly option?: string
  readonly words?: string
  readonly corrections?: readonly Note[]
  readonly revision: number
  readonly at: string
}

export type Withdrawal = { readonly kind: 'withdraw'; readonly words: string; readonly revision: number; readonly by: Author; readonly at: string }

export type Status = 'open' | 'answered' | 'withdrawn'

export type Item = {
  readonly format: number
  readonly id: string
  readonly kind: Kind
  readonly project: string
  readonly origin: Author
  readonly subscribers: readonly Subscriber[]
  readonly revisions: readonly Revision[]
  readonly withdrawal?: Withdrawal
  readonly updatedAt: string
}

export type Person = {
  readonly notes: readonly Note[]
  readonly answers: readonly Answer[]
  readonly lastRead: number
  readonly queuedAt: string
}

export type PersonFiles = Readonly<Record<string, Person>>

export function personOf(person: PersonFiles, item: Item): Person {
  return person[item.id] ?? { notes: [], answers: [], lastRead: -1, queuedAt: item.revisions[0]?.at ?? item.updatedAt }
}

export function current(item: Item): Content {
  const revision = item.revisions.at(-1)
  if (revision === undefined) throw new Error(`The inbox item ${item.id} has no revision.`)
  return revision.content
}

export function revisionOf(item: Item): number {
  return item.revisions.length - 1
}

export function revisionNumber(revision: number): number {
  return revision + 1
}

export function revisedAt(item: Item): string {
  return item.revisions.at(-1)?.at ?? item.updatedAt
}

export function closingOf(item: Item, person: Person): Answer | Withdrawal | undefined {
  const answered = person.answers.find((answer) => answer.kind !== 'correct' && (answer.kind !== 'reject' || answer.revision === revisionOf(item)))
  const withdrawn = item.withdrawal
  if (withdrawn === undefined) return answered
  return answered !== undefined && answered.at <= withdrawn.at ? answered : withdrawn
}

export function statusOf(item: Item, person: Person): Status {
  const closing = closingOf(item, person)
  if (closing === undefined) return 'open'
  return closing.kind === 'withdraw' ? 'withdrawn' : 'answered'
}

export function isOpen(item: Item, person: Person): boolean {
  return statusOf(item, person) === 'open'
}

export function sentCorrections(item: Item, person: Person): Note[] {
  return person.answers.filter((answer) => answer.kind === 'correct' && answer.revision === revisionOf(item)).flatMap((answer) => answer.corrections ?? [])
}

export function isWithAgent(item: Item, person: Person): boolean {
  return isOpen(item, person) && sentCorrections(item, person).length > 0
}

export function isRunning(session: string, senders: Senders): boolean {
  return senders[session]?.isRunning !== false
}

export function isFollowed(item: Item, senders: Senders): boolean {
  return item.subscribers.some(({ session }) => isRunning(session, senders))
}

export function isArchived(item: Item, person: Person, senders: Senders): boolean {
  return !isOpen(item, person) || !isFollowed(item, senders)
}

export function byQueue(person: PersonFiles): (a: Item, b: Item) => number {
  return (a, b) => personOf(person, a).queuedAt.localeCompare(personOf(person, b).queuedAt)
}

export function queue(items: readonly Item[], person: PersonFiles, senders: Senders): Item[] {
  return items.filter((item) => !isArchived(item, personOf(person, item), senders)).sort(byQueue(person))
}

export function archive(items: readonly Item[], person: PersonFiles, senders: Senders): Item[] {
  return items.filter((item) => isArchived(item, personOf(person, item), senders)).sort((a, b) => cardTime(b, personOf(person, b)).localeCompare(cardTime(a, personOf(person, a))))
}

export function shownOf(items: readonly Item[], person: PersonFiles, senders: Senders, viewing: string | null): Item | undefined {
  const listed = queue(items, person, senders)
  return items.find((item) => item.id === viewing) ?? listed.find((item) => !isWithAgent(item, personOf(person, item))) ?? listed[0]
}

export type Unseen = 'new' | 'changed'

export function unseenOf(item: Item, person: Person): Unseen | undefined {
  if (person.lastRead < 0) return 'new'
  return person.lastRead < revisionOf(item) ? 'changed' : undefined
}

export type Scope = 'session' | 'project' | 'all'

export const scopes: readonly Scope[] = ['session', 'project', 'all']

export const scopeNames: Readonly<Record<Scope, string>> = { session: 'This session', project: 'This project', all: 'All projects' }

type Place = { readonly session: string; readonly repository: string }

export function isInScope(item: Item, scope: Scope, here: Place, repositories: Readonly<Record<string, string>>): boolean {
  if (scope === 'all') return true
  if (scope === 'project') return (repositories[item.project] ?? item.project) === here.repository
  return item.origin.session === here.session || item.subscribers.some((each) => each.session === here.session)
}

export type Run = (argv: readonly string[]) => Promise<{ readonly exitCode: number; readonly stdout: string }>

export async function repositoryOf(run: Run, project: string, log: (line: string) => void): Promise<string> {
  try {
    const { exitCode, stdout } = await run(['git', '-C', project, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
    return exitCode === 0 && stdout.trim() !== '' ? stdout.trim() : project
  } catch (error) {
    log(`git could not name the repository of ${project}, so its items count as their own project: ${error instanceof Error ? error.message : String(error)}`)
    return project
  }
}

const kindNames: Readonly<Record<Kind, string>> = { proposal: 'Proposal', options: 'Options', question: 'Question', report: 'Report' }

export function kindName(item: Item): string {
  return kindNames[item.kind]
}

export function ago(at: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000))
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export const wording = {
  goal: 'Goal',
  whyItMatters: 'Why it matters',
  problem: 'Problem',
  evidence: 'Evidence',
  note: 'Note',
  comment: 'Comment',
  answer: 'Answer',
  answerPlaceholder: 'Your words',
  sent: 'You sent',
  earlierNotes: 'Your notes on an earlier revision',
  earlierNotesHint: 'They go out with the rest. Press one to drop it.',
  leftOpen: 'left open',
  removed: 'removed',
  unchanged: 'unchanged',
  archive: 'Archive',
  agentClosed: 'agent closed',
  changesRequested: 'changes requested',
  emptyHint: "An agent's next proposal, choice, question, or report shows here as it arrives.",
} as const

export function notePlaceholder(label: string): string {
  return `What to change here, or empty to drop the ${label.toLowerCase()}`
}

export function precedentLine(precedent: string): string {
  return `As in ${precedent}`
}

function whenLine(item: Item, person: Person, now: number): string {
  return unseenOf(item, person) === 'changed' ? `revision ${revisionNumber(revisionOf(item))}, you read revision ${revisionNumber(person.lastRead)}` : ago(revisedAt(item), now)
}

export function noteOn(item: Item, person: Person, path: string): Note | undefined {
  return person.notes.find((note) => note.path === path && note.revision === revisionOf(item))
}

export function earlierNotes(item: Item, person: Person): Note[] {
  return person.notes.filter((note) => note.revision !== revisionOf(item))
}

export function nextAfter(listed: readonly Item[], shown: Item): Item | undefined {
  const index = listed.indexOf(shown)
  return listed.find((item) => item.id !== shown.id && (index === -1 || listed.indexOf(item) > index)) ?? listed.find((item) => item.id !== shown.id)
}

const closedWords: Readonly<Record<(Answer | Withdrawal)['kind'], string>> = { approve: 'approved', reject: 'rejected', option: 'picked', answer: 'answered', acknowledge: 'done', correct: wording.changesRequested, withdraw: 'withdrawn' }

export function closedWord(closing: Answer | Withdrawal): string {
  return closedWords[closing.kind]
}

export function closedLine(closing: Answer | Withdrawal, now: number): string {
  return `${closedWord(closing)} · ${ago(closing.at, now)}`
}

export function positionLine(listed: readonly Item[], shown: Item, person: Person, now: number): string | undefined {
  if (closingOf(shown, person) !== undefined) return undefined
  const index = listed.indexOf(shown)
  return `${index === -1 ? wording.agentClosed : `${index + 1} of ${listed.length}`} · ${whenLine(shown, person, now)}`
}

export type CardStatus = { readonly word: string; readonly tone: 'unseen' | 'requested' | 'archived' }

export function cardStatusOf(item: Item, person: Person, senders: Senders): CardStatus | undefined {
  const closing = closingOf(item, person)
  if (closing !== undefined) return { word: closedWord(closing), tone: 'archived' }
  if (isArchived(item, person, senders)) return { word: wording.agentClosed, tone: 'archived' }
  if (isWithAgent(item, person)) return { word: wording.changesRequested, tone: 'requested' }
  const unseen = unseenOf(item, person)
  return unseen === undefined ? undefined : { word: unseen, tone: 'unseen' }
}

export function cardTime(item: Item, person: Person): string {
  return closingOf(item, person)?.at ?? revisedAt(item)
}

export function closingLines(item: Item, closing: Answer | Withdrawal, senders: Senders): string[] {
  if (closing.kind === 'withdraw') return [`${senderOf(closing.by, item.project, senders).title} withdrew it: ${closing.words}`]
  const picked = closing.option === undefined ? [] : [`Picked "${closing.option}"`]
  const words = closing.words === undefined ? [] : [closing.words]
  const notes = (closing.corrections ?? []).map((note) => `✎ ${note.target}: ${note.words}`)
  return [...picked, ...words, ...notes]
}

export function emptyLine(scope: Scope): string {
  return `Your inbox is empty · ${scopeNames[scope]}`
}

export function narrowestScope(offered: readonly Scope[], from: Scope, id: string, itemsIn: (scope: Scope) => readonly Item[]): Scope {
  const holds = (scope: Scope) => itemsIn(scope).some((item) => item.id === id)
  return offered.find((scope) => offered.indexOf(scope) >= offered.indexOf(from) && holds(scope)) ?? from
}

export function projectName(project: string): string {
  return project.split('/').at(-1) ?? project
}

export function whereLine(project: string, isDiff: boolean): string {
  return isDiff ? `what the work changed in ${projectName(project)}` : `in ${projectName(project)}`
}
