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

function sessionsOf(item: Summary): string[] {
  return [item.origin, ...item.subscribers, ...item.revisions, ...(item.withdrawal === undefined ? [] : [item.withdrawal.by])].map((each) => each.session)
}

export function isUnnamed(items: readonly Summary[], senders: Senders): boolean {
  return items.some((item) => sessionsOf(item).some((id) => senders[id] === undefined))
}

export function sendersFor(items: readonly Summary[], listed: Senders): Senders {
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
  readonly delivers?: readonly string[]
  readonly updatedAt: string
}

export type Summary = Omit<Item, 'revisions'> & { readonly revisions: readonly (Author & { readonly at: string; readonly content: Pick<Content, 'title'> })[] }

export function summaryOf(item: Item): Summary {
  return { ...item, revisions: item.revisions.map(({ content, ...revision }) => ({ ...revision, content: { title: content.title } })) }
}

export type Person = {
  readonly notes: readonly Note[]
  readonly answers: readonly Answer[]
  readonly lastRead: number
}

export type PersonFiles = Readonly<Record<string, Person>>

export function personOf(person: PersonFiles, item: Summary): Person {
  return person[item.id] ?? { notes: [], answers: [], lastRead: -1 }
}

export function current<Each extends Summary>(item: Each): Each['revisions'][number]['content'] {
  const revision = item.revisions.at(-1)
  if (revision === undefined) throw new Error(`The inbox item ${item.id} has no revision.`)
  return revision.content
}

export function revisionOf(item: Summary): number {
  return item.revisions.length - 1
}

export function revisionNumber(revision: number): number {
  return revision + 1
}

export function revisedAt(item: Summary): string {
  return item.revisions.at(-1)?.at ?? item.updatedAt
}

export function closingOf(item: Summary, person: Person): Answer | Withdrawal | undefined {
  const answered = person.answers.find((answer) => answer.kind !== 'correct' && (answer.kind !== 'reject' || answer.revision === revisionOf(item)))
  const withdrawn = item.withdrawal
  if (withdrawn === undefined) return answered
  return answered !== undefined && answered.at <= withdrawn.at ? answered : withdrawn
}

export function statusOf(item: Summary, person: Person): Status {
  const closing = closingOf(item, person)
  if (closing === undefined) return 'open'
  return closing.kind === 'withdraw' ? 'withdrawn' : 'answered'
}

export function isOpen(item: Summary, person: Person): boolean {
  return statusOf(item, person) === 'open'
}

export function sentCorrections(item: Summary, person: Person): Note[] {
  return person.answers.filter((answer) => answer.kind === 'correct' && answer.revision === revisionOf(item)).flatMap((answer) => answer.corrections ?? [])
}

export function isWithAgent(item: Summary, person: Person): boolean {
  return isOpen(item, person) && sentCorrections(item, person).length > 0
}

export function isRunning(session: string, senders: Senders): boolean {
  return senders[session]?.isRunning !== false
}

export function isFollowed(item: Summary, senders: Senders): boolean {
  return item.subscribers.some(({ session }) => isRunning(session, senders))
}

export type Deliveries = Readonly<Record<string, Summary>>

export function deliveriesOf(items: readonly Summary[]): Deliveries {
  const revised = new Map(items.map((item) => [item.id, revisedAt(item)]))
  const reports = items.filter((item) => item.delivers !== undefined).sort((a, b) => revisedAt(a).localeCompare(revisedAt(b)))
  const delivered = reports.flatMap((report) => (report.delivers ?? []).filter((id) => (revised.get(id) ?? '') <= revisedAt(report)).map((id) => [id, report] as const))
  return Object.fromEntries(delivered.reverse())
}

export function isArchived(item: Summary, person: Person, senders: Senders, deliveries: Deliveries): boolean {
  return !isOpen(item, person) || deliveries[item.id] !== undefined || !isFollowed(item, senders)
}

export function byNewest(a: Summary, b: Summary): number {
  return revisedAt(b).localeCompare(revisedAt(a))
}

export function queue<Each extends Summary>(items: readonly Each[], person: PersonFiles, senders: Senders, deliveries: Deliveries): Each[] {
  return items.filter((item) => !isArchived(item, personOf(person, item), senders, deliveries)).sort(byNewest)
}

export function archive<Each extends Summary>(items: readonly Each[], person: PersonFiles, senders: Senders, deliveries: Deliveries): Each[] {
  return items.filter((item) => isArchived(item, personOf(person, item), senders, deliveries)).sort((a, b) => cardTime(b, personOf(person, b), deliveries).localeCompare(cardTime(a, personOf(person, a), deliveries)))
}

export function shownOf<Each extends Summary>(items: readonly Each[], person: PersonFiles, senders: Senders, deliveries: Deliveries, viewing: string | null): Each | undefined {
  const listed = queue(items, person, senders, deliveries)
  return items.find((item) => item.id === viewing) ?? listed.find((item) => !isWithAgent(item, personOf(person, item))) ?? listed[0]
}

export type Unseen = 'new' | 'changed'

export function unseenOf(item: Summary, person: Person): Unseen | undefined {
  if (person.lastRead < 0) return 'new'
  return person.lastRead < revisionOf(item) ? 'changed' : undefined
}

export function isUnread(item: Summary, person: Person): boolean {
  return unseenOf(item, person) !== undefined
}

export function needsAnswer(item: Summary): boolean {
  return item.kind !== 'report'
}

export function ofKind<Each extends Summary>(items: readonly Each[], kind: Kind | null): Each[] {
  return kind === null ? [...items] : items.filter((item) => item.kind === kind)
}

export type Scope = 'session' | 'project' | 'all'

export const scopes: readonly Scope[] = ['session', 'project', 'all']

export const scopeNames: Readonly<Record<Scope, string>> = { session: 'This session', project: 'This project', all: 'All projects' }

type Place = { readonly session: string; readonly repository: string }

export function isInScope(item: Summary, scope: Scope, here: Place, repositories: Readonly<Record<string, string>>): boolean {
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

export function kindName(item: Summary): string {
  return kindNames[item.kind]
}

export const kinds: readonly Kind[] = ['proposal', 'options', 'question', 'report']

export const kindTabNames: Readonly<Record<Kind, string>> = { proposal: 'Proposals', options: 'Options', question: 'Questions', report: 'Reports' }

export function elapsed(since: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(since)) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

export function ago(at: string, now: number): string {
  return `${elapsed(at, now)} ago`
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
  delivered: 'delivered',
  delivers: 'Delivers',
  deliveredBy: 'Delivered by',
  changesRequested: 'changes requested',
  inbox: 'Inbox',
  all: 'All',
  unread: 'unread',
  selectAll: 'Select all',
  selected: 'selected',
  done: 'Done',
  markRead: 'Mark read',
  inboxZero: 'Inbox zero',
  emptyHint: "An agent's next proposal, choice, question, or report shows here as it arrives.",
} as const

export function notePlaceholder(label: string): string {
  return `What to change here, or empty to drop the ${label.toLowerCase()}`
}

export function precedentLine(precedent: string): string {
  return `As in ${precedent}`
}

function whenLine(item: Summary, person: Person, now: number): string {
  return unseenOf(item, person) === 'changed' ? `revision ${revisionNumber(revisionOf(item))}, you read revision ${revisionNumber(person.lastRead)}` : ago(revisedAt(item), now)
}

export function noteOn(item: Summary, person: Person, path: string): Note | undefined {
  return person.notes.find((note) => note.path === path && note.revision === revisionOf(item))
}

export function earlierNotes(item: Summary, person: Person): Note[] {
  return person.notes.filter((note) => note.revision !== revisionOf(item))
}

export function nextAfter<Each extends Summary>(listed: readonly Each[], shown: Summary): Each | undefined {
  const index = listed.findIndex((item) => item.id === shown.id)
  return listed.find((item) => item.id !== shown.id && (index === -1 || listed.indexOf(item) > index)) ?? listed.find((item) => item.id !== shown.id)
}

const closedWords: Readonly<Record<(Answer | Withdrawal)['kind'], string>> = { approve: 'approved', reject: 'rejected', option: 'picked', answer: 'answered', acknowledge: 'done', correct: wording.changesRequested, withdraw: 'withdrawn' }

export function closedWord(closing: Answer | Withdrawal): string {
  return closedWords[closing.kind]
}

export function closedLine(closing: Answer | Withdrawal, now: number): string {
  return `${closedWord(closing)} · ${ago(closing.at, now)}`
}

export function positionLine(listed: readonly Summary[], shown: Summary, person: Person, deliveries: Deliveries, now: number): string | undefined {
  if (closingOf(shown, person) !== undefined) return undefined
  const index = listed.indexOf(shown)
  const place = index !== -1 ? `${index + 1} of ${listed.length}` : deliveries[shown.id] === undefined ? wording.agentClosed : wording.delivered
  return `${place} · ${whenLine(shown, person, now)}`
}

export function threadLine(item: Summary): string | undefined {
  const count = item.delivers?.length ?? 0
  return count === 0 ? undefined : `${wording.delivers.toLowerCase()} ${plural(count, 'item')}`
}

export function threadStatusOf(item: Summary, person: Person, senders: Senders, deliveries: Deliveries): CardStatus | undefined {
  const status = cardStatusOf(item, person, senders, deliveries)
  return status?.word === wording.delivered ? undefined : status
}

export type Thread = { readonly deliveredBy?: Summary; readonly delivers: readonly Summary[] }

export function threadOf(item: Summary, items: readonly Summary[], deliveries: Deliveries): Thread {
  const deliveredBy = deliveries[item.id]
  const delivers = (item.delivers ?? []).flatMap((id) => items.filter((each) => each.id === id))
  return { ...(deliveredBy === undefined ? {} : { deliveredBy }), delivers }
}

export type CardStatus = { readonly word: string; readonly tone: 'requested' | 'archived' }

export function cardStatusOf(item: Summary, person: Person, senders: Senders, deliveries: Deliveries): CardStatus | undefined {
  const closing = closingOf(item, person)
  if (closing !== undefined) return { word: closedWord(closing), tone: 'archived' }
  if (deliveries[item.id] !== undefined) return { word: wording.delivered, tone: 'archived' }
  if (isArchived(item, person, senders, deliveries)) return { word: wording.agentClosed, tone: 'archived' }
  return isWithAgent(item, person) ? { word: wording.changesRequested, tone: 'requested' } : undefined
}

export function cardTime(item: Summary, person: Person, deliveries: Deliveries): string {
  const delivered = deliveries[item.id]
  return closingOf(item, person)?.at ?? (delivered === undefined ? revisedAt(item) : revisedAt(delivered))
}

export function closingLines(item: Summary, closing: Answer | Withdrawal, senders: Senders): string[] {
  if (closing.kind === 'withdraw') return [`${senderOf(closing.by, item.project, senders).title} withdrew it: ${closing.words}`]
  const picked = closing.option === undefined ? [] : [`Picked "${closing.option}"`]
  const words = closing.words === undefined ? [] : [closing.words]
  const notes = (closing.corrections ?? []).map((note) => `✎ ${note.target}: ${note.words}`)
  return [...picked, ...words, ...notes]
}

export function emptyLine(scope: Scope): string {
  return `Nothing needs you in ${scopeNames[scope].toLowerCase()}.`
}

export function narrowestScope(offered: readonly Scope[], from: Scope, id: string, itemsIn: (scope: Scope) => readonly Summary[]): Scope {
  const holds = (scope: Scope) => itemsIn(scope).some((item) => item.id === id)
  return offered.find((scope) => offered.indexOf(scope) >= offered.indexOf(from) && holds(scope)) ?? from
}

export function projectName(project: string): string {
  return project.split('/').at(-1) ?? project
}

export function whereLine(project: string, isDiff: boolean): string {
  return isDiff ? `what the work changed in ${projectName(project)}` : `in ${projectName(project)}`
}
