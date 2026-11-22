# Goals, requirements, tasks, and progress in the inbox

The Architect approved the inbox proposal `your-agents-goal-requirements-tasks-and-progress` (revision 4), read at `~/.local/share/cmod/data/inbox/items/your-agents-goal-requirements-tasks-and-progress.md`. Each Claude Code session keeps its requirements in the Architect's exact words, its task list, and its progress in the inbox. A Goal view, a Tasks view, three widgets, and a hidden `progress` tool show them, so no agent repeats progress in the chat.

## What cmod 8.3.1 gives, checked in its docs and code

- The session goal is cmod's, one text string: `sessions.current.goal.text()`, `goal.update({ text })` on any session from `sessions.get(id)`, `goal.onGoalChange`. The inbox reads it and never copies it.
- `sessions.current.onPrompt(listener)` hears each prompt with `id` (transcript uuid), `at`, trimmed `text`, and `from`. `from.type === 'person'` is a prompt the person sent. The inbox's own delivered answers arrive as `{ type: 'mod', name: 'inbox' }`.
- `sessions.current.beforeTurnEnd` answers `{ refuse }` to keep the main agent working. `sessions.current.goal.beforeTurnEnd` hears every subagent's stop, with `task` set.
- `sessions.current.beforeSessionStart(listener)` answers `{ note }` for every `source`, `compact` included. `sessions.current.goal.beforePrompt` hears a subagent's first prompt and answers `{ note }`.
- `sessions.current.goal.beforeToolCall({ name: [...] }, listener)` hears every agent's tool call, its payload carries `task` (absent for the main agent), and answers `{ refuse }`.
- A tool's `execute(input, mod)` never learns which agent called it. `sessions.current` is the calling session.
- `session.send({ type: Note | Prompt, text })`. `await sessions.current.turn()` is `undefined` between turns, so a Note goes while a turn runs and a Prompt while idle.
- Widget areas: `BelowPrompt`, `Working` (under the spinner), `Dashboard`, from `mod.js`. The person places each widget in Settings.
- No `Progress` element. `Progress({ value, width })` from `ui/components.js` draws `█░` in `Text`. `Toggle` draws `[x]`. No table element: `Box` rows.
- `mod.styles.add({ kind: ToolCall | ToolResult | ToolGroup, render })` hears every tool, branches on `props.tool`, one style per kind per mod.
- A toast shows only in the session whose mod raised it.
- A view takes no hotkey. `defineMod({ hotkeys })` with no default starts unbound.
- `program({ isService: true, isWebApp: true })` sets `CMOD_TAILNET_NAME` and `CMOD_TAILNET_LOGIN` and runs `tailscale serve` for the port. Tailscale sets `Tailscale-User-Login` on each tailnet request.
- A Bash command inside a session has `CLAUDE_CODE_SESSION_ID` (checked live: `printenv CLAUDE_CODE_SESSION_ID` printed this session's id). `inbox` is on PATH at `~/.local/share/cmod/programs/inbox`. The data folder is `<cmod store>/data/inbox`, the cmod store being `$XDG_DATA_HOME/cmod`, else `~/.local/share/cmod`.
- The config folders are `~/.claude/cmods/inbox/` and `<project>/.claude/cmods/inbox/`, read with `fs` (no API names them).

## Modules

```
src/goals/                 pure core, imports nothing from @cmodjs/core, shared with cli/
├── goal.ts                types (below) and every derived rule: shownState, isMet, counts
├── markdown.ts            goalsMarkdown(goals) and parseGoals(session, text)
├── store.ts               goalsPath, readGoals, updateGoals (write queue, check, changed)
├── progress.ts            Block types, validateBlocks, progressPath, readProgress, setProgress
└── templates.ts           parseTemplate(markdown), the template lookup order
src/
├── gates.ts               onPrompt filing, turn-end refusal, session-start and subagent notes, checklist refusal, waiting toast
├── requirements.ts        the person's actions from the Goal and Tasks views
├── tools.ts*              goal, file, plan, start, finish, wait, drop, progress, read with session
├── schemas.ts*            the schema of each new tool
├── state.ts*              memory.goals, memory.progress, memory.goalTexts, session.unfiled
├── mod.tsx*               wires gates, views, widgets, hotkeys, styles
├── views/goal.tsx         the Goal view
├── views/tasks.tsx        the Tasks view
├── components/progress.tsx  ProgressBlocks({ blocks, columns })
├── widgets/goal.tsx       BelowPrompt: the goal, requirements met, tasks waiting on you
├── widgets/task.tsx       Working: the active task, its elapsed time, done of total
└── widgets/sessions.tsx   Dashboard: every running session's goal, met, waiting on you
cli/src/
├── main.ts*               inbox progress
└── server.ts*             tailnet login check, inbox/Goals interface
```

`src/items/` stays as it is apart from what the goals store reuses: `Disk`, the per-`Disk` write queue, and the `changed` file.

## Stored data

`<data>/goals/<session>.md`, one per session, written only by the mods. Front matter and sections follow `src/items/markdown.ts`: `key: <JSON>` front matter, `## <kind> {json}` section headers, `> ` quoted words.

```ts
type Source = 'prompt' | 'answer' | 'view'
type Quote = { words: string; source: Source; id: string; at: string }   // id: transcript uuid, `<item id>#<answer number>`, or `view:<iso>`
type Requirement = { id: string; capability: string; line: string; quotes: Quote[] }   // id r1, r2, … per file
type Filing = { id: string; source: Source; requirements: string[] } | { id: string; source: Source; reason: string }
type TaskState = 'planned' | 'active' | 'done' | 'dropped'
type Task = {
  id: string                     // t1, t2, … per file
  title: string
  state: TaskState
  serves: string[]               // requirement ids
  after?: string                 // a task id in the same file
  waitsOn?: string               // an inbox item id
  owner?: string                 // the session that took it
  cmodTask?: string              // the subagent's cmod task id, when a subagent took it
  template?: string              // the template it came from
  isRequired: boolean            // "(required)" in its template: drop refuses it
  evidence?: string[]            // finish
  reason?: string                // drop
  startedAt?: string
  endedAt?: string
  corrections: Quote[]           // the person's Correct… on this task
}
type Goals = { format: 1; session: string; project: string; requirements: Requirement[]; filings: Filing[]; tasks: Task[]; updatedAt: string }
```

`<data>/progress/<session>.json`, written by the `progress` tool and by `inbox progress`, each write replacing the whole file through a temporary file and a rename. It has one writer kind per write, last write wins, so it needs no read before the write.

```ts
type Block =
  | { kind: 'bar'; label: string; done: number; total: number }
  | { kind: 'checklist'; label: string; items: { text: string; done: boolean }[] }
  | { kind: 'note'; text: string }
  | { kind: 'table'; label?: string; columns: string[]; rows: string[][] }
  | { preset: 'steps'; label?: string; steps: string[]; current: number }      // steps before current are done
  | { preset: 'tasks'; label?: string; tasks: { text: string; state: 'planned' | 'active' | 'done' }[] }
type Progress = { session: string; blocks: Block[]; at: string }
```

Each goals write also writes `changed` as `<iso> goals/<session>`, so every running mod and the server reload through the watch they already have. A reader that sees an id with a `/` rereads that file, and the item reader ignores it. A progress write writes no `changed`: each session watches its own progress file, and the server reads the progress folder's stamps on each poll.

Unfiled prompts live in `session.unfiled` state, never in a file, so a session that never files writes nothing to the data folder:

```ts
type Unfiled = { id: string; source: Source; text: string; at: string }
```

## Rules

- `shownState(task, goals, items, person)`: `waiting on you` while `waitsOn` names an item that is open and not with its agent (`statusOf` and `isWithAgent` in `src/items/item.ts`), `waiting after` while `after` names a task that is not done, else `state`. Computed, never stored, as `isArchived` is.
- A requirement is met when at least one task serves it and every task that serves it, dropped ones aside, is done.
- Only the person reopens a done task: a done task's state changes only from the Tasks view.
- A quote's `words` must appear word for word in the prompt or answer text it names, or the `file` tool refuses it.
- Each person prompt (`onPrompt`, `from.type === 'person'`) adds an `Unfiled`. Each inbox answer that carries words (an answer's `words` or its corrections' `words`), at the moment `deliverItem` sends it, adds an `Unfiled` with id `<item id>#<answer number>` and those words. An answer with no words needs no filing.
- The main agent's turn end is refused while `session.unfiled` is not empty or a task this session owns with no `cmodTask` shows `active`. A subagent's stop is refused while a task whose `cmodTask` is that subagent shows `active`. The refusal names each unfiled prompt with its id and text, and each active task with its id and title, and the tools that clear each.
- The gates (prompt filing, the turn-end refusals, the checklist refusal) run only in a session a Claude app shows (`sessions.current.surfaces()` not empty), so a `claude -p` run or a background session is never refused.
- A refusal never traps a session: a stop is refused once for each set of unfiled ids and active task ids within one turn, and the refusal says the next stop passes with them left open. The next stop on the same set passes with no answer.
- `finish`, `wait`, and `drop` refuse a task this session does not own while its owner runs (`isRunning`). Any session closes a task whose owner no longer runs.
- A fork keeps the conversation's requirements: `session.goalsSession` names the session whose goals file this conversation last wrote. When it names another session than the current one, which only a fork leaves (cmod copies `session` state into a fork and `/clear` resets it), the load copies that file's requirements and filings into the current session's file, then names the current session.
- The goals lock folder holds its writer's token. `release` removes only its own lock, a stale lock whose stamp changed is left in place for a retry, and a failed release after a landed write is a warning in the tool's answer, never a failure.
- The rulebook check of a goals write checks only the agent's words this write adds or changes, never words already stored.
- Each session loads only its own progress file and watches it with `fs.onChange`. A progress write does not write `changed`. The server's poll reads the progress folder's stamps itself. A new turn of the main agent forgets the set, so a task left active refuses again in the next turn.
- Every goals write, from any process, holds a lock folder `<goals file>.lock` made with `mkdir` while it reads, changes, and writes the file, because each session runs its own copy of the mod and another session's `start`, `finish`, `wait`, or `drop` writes this session's file. A lock older than 10 seconds is broken.
- `Task` is a union keyed on `state`: an active task has `owner` and `startedAt`, a done task `owner`, `startedAt`, `evidence`, and `endedAt`, a dropped task `reason` and `endedAt`. `parseGoals` refuses a file whose task lacks its state's fields.
- A quote matches whole words: its words appear in the prompt's words as a run, never as part of a word.
- When a person prompt arrives, the agent gets a Note naming the id to file it under. A delivered inbox answer names its `<item id>#<n>` id.
- When a subagent ends, each task still active with its `cmodTask` loses the `cmodTask`, so it returns to the main agent's gate.
- A subagent's note holds the goal, the requirements with quotes, and the open tasks, never the main agent's unfiled prompts.
- The person corrects a task from the Tasks view with Correct…, and each task's corrections are in the agent's notes.
- A full rulebook run does not check the stored goals folder, because it holds the person's quotes. Only the write check runs, on the agent's words.
- The rulebook check of a goals write leaves the person's quotes out, because they are the person's words, not the agent's.
- At every session start, compaction included, and at a subagent's first prompt, the agent gets a note: the cmod goal, each requirement with its quotes, each open task with its shown state, and each unfiled prompt.
- `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, and `TodoWrite` are refused for every agent with a pointer to `plan`, `start`, `finish`, `wait`, and `drop`.
- A subagent's `start` is linked to its cmod task: `goal.beforeToolCall({ name: 'mcp__inbox__start' })` records the call's `task` against the input's task id in memory, and `execute` reads it.
- A template is a Markdown task list, `- [ ] <title>` with an optional ` (required)` suffix, read from `<project>/.claude/cmods/inbox/templates/<name>.md` first, then `~/.claude/cmods/inbox/templates/<name>.md`.
- Every goals write passes the rulebook check first: `rulebook check --stdin-file-path=@inbox/goals/<session>.md` with the Markdown on stdin, with the same exit-code handling as items.
- The `progress` tool's chat row and result draw nothing unless expanded (`isExpanded`, ctrl+o). A `ToolGroup` that holds a progress call draws expanded, so the hidden row does not leave a group row behind.
- Every running mod toasts once when any session's task newly shows `waiting on you`, with Open on the item. Tasks already waiting at the first load do not toast.
- The Goal and Tasks views each get a hotkey with no default, as `toggle` has.
- The inbox's program runs with `isWebApp`. The server answers a request whose `Host` name is `127.0.0.1` or `localhost` and that carries no `X-Forwarded-For` unchecked (Tailscale forwards the client's own `Host` and always sets that header), a request whose `Host` name equals `CMOD_TAILNET_NAME` only when `Tailscale-User-Login` equals `CMOD_TAILNET_LOGIN`, and refuses every other request with 403.

## Tools

The agent sees each as `mcp__inbox__<name>`.

```
goal      { text }                                          sets this session's cmod goal
file      { prompt, requirements: [{ id } | { capability, line }, quotes: string[]] } | { prompt, reason }
plan      { tasks?: [{ title, serves, after? }], template?, serves? }
start     { task, session? }                                takes a planned task, in this session or another
finish    { task, session?, evidence: string[] }
wait      { task, session?, on: <item id> } | { task, session?, after: <task id> }
drop      { task, session?, reason }
progress  { blocks: Block[] }                               replaces this session's progress
read      { id } | {} | { session }                         session: that session's goal, requirements, tasks, unfiled count
```

## Safety for every Agent

- Never write `~/.local/share/cmod/data/inbox`. Reading it is fine. Tests use scratch folders. A live check calls no tool that writes.
- Never set `XDG_DATA_HOME`. Never signal the Architect's processes. Never touch a session's state file.
- Never commit. No `git stash`, `reset`, `restore`, `clean`, or `checkout --`.
- No em dashes anywhere.
