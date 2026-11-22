# Inbox

One inbox for every proposal, choice, question, and report your Claude Code agents bring you.

An agent's proposal in a reply gets buried under the next tool call, and by the time you read it the context is gone. The inbox keeps every open item from every running session in one Sidebar page. You answer each one from the item alone, and your answer goes back to every session that follows it.

## What the inbox holds

- **Proposals.** The Problems that block a goal, biggest first, each with the Solution the agent would ship. You approve it, reject it, or request changes.
- **Options.** One Problem and two or more Solutions the agent would each ship. You pick one, or reject every option.
- **Questions.** One product or Capability question. You answer it in your own words, or reject it.
- **Reports.** Finished work: each thing that changed for you with how the agent knows it works, and the Problems left open. You decide whether the goal is reached: you mark it done, or request changes.

## Agents fill fields, and the inbox draws the code

Agents never write a proposal's format. Each tool's input is the format. A Solution is a list of ideas, each one or two sentences with the drawing that shows it right under it, so you read each claim next to its evidence. The inbox refuses a Solution that is only prose.

An agent declares what each drawing shows: the files, the signatures, the lines, the stored data, a diagram, or an example. The inbox reads the code with [tracer](https://github.com/heyJordanParker/tracer) and then:

- refuses a file, signature, or line the code does not hold, with the reason, before you ever see it
- draws every public declaration of each changed file, changed or not
- draws the lines around a changed block

The `proposals` Skill teaches agents to write each kind this way.

## Every item is a Markdown file

Each item is `~/.local/share/cmod/data/inbox/items/<id>.md`, which any editor opens: the title and each Problem and Solution as headings, the goal under the title, each idea as a paragraph, and each drawing as a fenced block named for its kind. Earlier revisions are in `revisions/<id>/`, and your answers and notes in `person/<id>.md`. Before the inbox stores an item, your rulebook rules check it as `@inbox/<id>.md`, and a rule's refusal goes back to the agent word for word.

## What you see

An item opens in the Sidebar as soon as an agent files it. The agent's reply links to it, and clicking the link opens it again. `/inbox` or the count above the prompt opens the Inbox page, and `/inbox` hides it again. The inbox binds no key. Its "Show or hide the inbox" hotkey starts unbound, and you pick its key in Settings, under inbox, Hotkeys, or with `cmod hotkeys set inbox toggle <combo>`.

The Inbox page opens on the list, one row per item, newest first, as a mail inbox does:

```text
 This session 3  [ ] Select all          [ Open in browser  o ]

 All 3   Proposals 1   Reports 2

 [ ] ● Proposal · php#                                    5h ago
       Exhaustive match needs no default

 [ ] ● Report · php#                                     14h ago
       The inbox ships, and every proposal waits in one page

 [ ]   Report · schema planning                           3d ago
       Courses ship with paid tiers
```

A `●` and a bold title mark what you haven't read. A proposal, choice, or question shows its kind in the accent color, because an agent waits on your answer, and a report shows its kind dim. The menu at the top widens the list from this session to this project, which counts every worktree of the repository, or to every project. The tabs under it list one kind at a time, each with its count.

Pressing a row opens the item, under a line that goes back to the list, `u`, as in Gmail:

```text
 [ ← Inbox  u ]                         [ Open in browser  o ]
╭──────────────────────────────────────────────────────────╮
│  Proposal from php# · 1 of 3 · revision 2, you read 1    │
│                                                          │
│  Exhaustive match needs no default                       │
│                                                          │
│  Goal                                                    │
│  Enums ship without boilerplate defaults                 │
│                                                          │
│                                                          │
│  Problem 1  changed inside                               │
│  A full match still demands a default                    │
│                                                          │
│  Users write a default the compiler could prove          │
│  unreachable.                                            │
│                                                          │
│                                                          │
│  Solution 1                                              │
│  No default                                              │
│  As in Rust, C#                                          │
│                                                          │
│  changed                                                 │
│  A match that covers every case compiles without a       │
│  default.                                                │
│  ✎ Name the precedent                                    │
│  ╭────────────────────────────────────────────────────╮  │
│  │  Files  work · 1 edited                            │  │
│  │                                                    │  │
│  │  src/match.ts  edited                              │  │
│  │  learns exhaustiveness                             │  │
│  ╰────────────────────────────────────────────────────╯  │
│                                                          │
│  removed                                                 │
│  A default arm documents intent.                         │
│                                                          │
│                                                          │
│  Problem 1A                                              │
│  The spec demands a default                              │
│  Solution 1A · Drop the rule · 1 idea, 1 drawing         │
│                                                          │
│  [ Request changes (1)  r ] [ Approve with 1 note  a ]   │
│  [ Reject with 1 note  x ] [ Comment  m ] [ Next →  n ]  │
╰──────────────────────────────────────────────────────────╯
```

Each heading starts with a row of chips, its kind and whether it changed, and its title sits under them, so you scan the titles and open only what you doubt. Pressing a Problem's chip folds the Problem with its Solution, and pressing a drawing's chip folds the drawing. Pointing at any heading, idea, or drawing shows `✎` at its right edge, which writes a note under it. **Comment** in the footer writes a note on the whole item beside the buttons, and pressing the saved comment edits it.

An item an agent revised after you read it is unread again, as a mail thread is when a reply arrives. It opens only the parts that changed, shows each changed idea's old words struck through, and shows each part the revision removed, struck through, where it was, each marked **changed** or **removed**. A report keeps each change's evidence in a folded Evidence section under it. An item counts as read once you move past it, answer it, or close the page on it, and the count above the prompt says how many are unread.

The list holds every open item whose agent still runs. Each row shows its kind, the session that filed it in that session's color, **changes requested** while the agent works on your notes, the time, and the title.

Each row has a checkbox, and **Select all** checks every row the tab lists. With rows checked, **Done**, `e`, closes the reports among them, and **Mark read**, `i`, marks them all read. Proposals, choices, and questions stay open, because each needs your answer. Pointing at a report's row also shows **Done** where its time was. So clearing the reports you glanced at takes the Reports tab, Select all, and `e`.

Under the list, the **Archive** folds under one line with its count, and opens when you press it. It holds every item you answered or an agent withdrew, marked approved, rejected, picked, answered, done, or withdrawn. It also holds every open item that no running session follows, because its sessions closed or stopped following it, marked **agent closed**. Nothing is ever deleted. An archived item still opens, and an open one still takes your answer, which reaches its session when the session resumes. An item moves back to the list as soon as its session runs again.

## One row for each piece of work

A report names the items its work finishes: the proposal, choice, or question it ships, and each earlier report on the same work. Those items leave your list with the report and wait in the Archive marked **delivered**, so the list shows one row for the work, the newest report. The report's row says how many items it delivers. The report lists each one under **Delivers**, and each delivered item names its report under **Delivered by**, each a press away. An answer you already gave stays the item's mark, and an item you rejected or are waiting on changes to can't be delivered, so your open decisions stay in the list.

The page shows this session's items: the ones it filed or follows. Each scope in the menu counts the items in its list, not its Archive. Only the session that files an item opens the page on it.

The actions follow the review and inbox tools you already use. **Approve**, **Reject**, and **Request changes** work as in a GitHub pull request review, and your notes go out with each. **Done**, `e`, closes a report, and a report has no Reject. A plain Done tells the agent nothing, since a report is final and the agent waits on nothing, and Done with a note or a comment sends the note. **Next →** opens the next item down the list, and the one you leave counts as read. After an answer the next item opens, and after the last one the list. After Request changes the item stays on the page with what you sent, so you can add more while the agent revises, and the agent's revision ends the wait on its own.

## Read and answer in the browser

**Open in browser**, or `o`, opens the inbox in your browser with the same scope as the page: the list from the list, and the item from an item. The browser shows the same items, notes, read marks, folds, and actions, with the same keys, plus room for wide diagrams and long diffs. A note or answer you give in one view shows in the other, and an item an agent files appears in the open tab without a reload.

One `inbox` program serves the browser for the whole computer, at `http://127.0.0.1:<port>`. It runs whenever you are logged in, as a service of the computer, so the browser view works with no Claude Code open. The address stays the same across restarts, so a bookmark keeps working. While Tailscale is signed in with HTTPS on, the browser view is also on your tailnet at `https://<computer>.<tailnet>.ts.net:<port>/`, so it opens from your other devices with nothing to run. Settings, under cmod, shows that address in the inbox's entry. Only your own Tailscale login gets in through the tailnet, and any other login, a tagged device, or another host name gets 403. The list carries each item's title, and the browser reads an item whole when you open it. When the program restarts on a new version, the tab shows "Reconnecting to the inbox…" until it is back.

Your items and answers stay in `~/.local/share/cmod/data/inbox/`, the same files the terminal reads, so both views always agree.

## Each session's goal and tasks show beside it

The **Goal** view shows the session's goal, with **Edit**, and your requirements grouped by Capability. Each requirement is the agent's one line with ✓ once every task that serves it is done, and your exact words folded under ▸. Unfolding them shows **Correct…**, which sends the agent your correction and keeps it as a new quote. **Add a requirement** files one in your words. **Save and tell Claude** sets the goal and tells the agent, as a note while it works and as a prompt while it waits.

```text
Goal · claude inbox                                 [ Edit ]
You see each agent's progress in the Sidebar, not the chat
1 of 2 requirements met · 1 waits on you

Progress view
  ✓ Progress shows beside the session
    ▸ "this isn't at all effective & should work inside…"
  ○ Agents script it from primitives and presets
    ▸ "Agents script it from primitives and presets"

[ Add a requirement ]

1 prompt of yours is not filed yet
```

The **Tasks** view shows the session's tasks with a bar for those done, then the agent's progress. A task waiting on you has **Open**, which opens the item it waits on. A done task's evidence unfolds, with **Reopen**, which plans it again. Pressing a task's title unfolds **Correct…**, which sends the agent your correction and keeps it under the task, and the agent reads it again after every compaction.

```text
Tasks · claude inbox                       1 of 5 done · 38m
████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

Active   Move the browser view to cmod 8.0               12m
Waiting  Draw the Tasks view                        [ Open ]
         on you: Approve the Tasks view?
Waiting  Hide the progress tool's chat row
         after: Move the browser view to cmod 8.0
Done     Store requirements with your quotes    ▸ ✓ evidence
Planned  Write the README section

Progress
  Tests ██████████████████████████████░░░░░░░░░░░ 121 of 164
```

Three widgets show the gist without a view, and you place each in Settings, under cmod, Widgets: the goal with requirements met below the prompt, the active task with its time under the spinner, and every running session's goal on the Dashboard. Pressing the goal or the task opens its view. The "Show or hide the session's goal and your requirements" and "Show or hide the session's tasks and progress" hotkeys start unbound, and you pick their keys in Settings, under inbox, Hotkeys, or with `cmod hotkeys set inbox goal <combo>` and `cmod hotkeys set inbox tasks <combo>`.

## Progress stays out of the chat

An agent keeps its session's progress in the inbox instead of repeating it in its replies, and the Tasks view shows it. It sets every block at once with the `progress` tool: a bar, a checklist, a note, a table, and the `steps` and `tasks` presets. Each call replaces the blocks before it, so only the current state is kept. The call and its result draw no row in the chat, and ctrl+o still shows them.

A long command, such as a test run, updates the progress while it runs, with no tool call:

```bash
inbox progress '[{ "kind": "bar", "label": "Tests", "done": 121, "total": 164 }]'
```

It sets the progress of the session in `CLAUDE_CODE_SESSION_ID`, which Claude Code sets in every Bash command, or of the one `--session` names, and takes the blocks on stdin too. Each session's progress is `progress/<session>.json` in the data folder. That session's Tasks view rereads it as soon as it changes, and other mods hear it through `inbox/Goals`.

## What agents call

| Tool | What it does |
| --- | --- |
| `propose` | Files a proposal |
| `propose_options` | Files a choice between two or more Solutions |
| `ask_question` | Files one product or Capability question |
| `report` | Files finished work: each change with short evidence, the Problems left open, and the items it delivers |
| `revise` | Replaces an item with a new revision, from any session, and subscribes that session |
| `withdraw` | Takes an item out of the inbox |
| `subscribe`, `unsubscribe` | Starts or stops hearing an item's changes in this session |
| `read` | Lists the open items, or reads one with every answer. With `session`, reads that session's goal, your requirements in your exact words, and its tasks |
| `goal` | Sets what this session is for, in one plain sentence, on top of the Goal view |
| `file` | Files your prompt or worded answer into requirements, in your exact words, and the turn cannot end until each is filed |
| `plan` | Adds tasks to this session's list, each naming the requirements it serves, or a template's list |
| `start` | Takes a planned task, in this session's list or another session's, and the turn cannot end while it is active |
| `finish` | Marks an active task done, with the evidence that shows it works |
| `wait` | Makes a task wait on your answer to an open inbox item, or after another task in the same list |
| `drop` | Drops a planned or active task with the reason, unless its template marks it required |
| `progress` | Replaces this session's progress, with no row in the chat |

Claude sees each as `mcp__inbox__<tool>`. A project adds its own checks as ordinary `PreToolUse` hooks with the matcher `mcp__inbox__.*`. A hook that exits with code 2 refuses the call, and its stderr reaches the agent.

## Other mods read your agents' goals

Another mod reads each session's requirements, tasks, and progress through the `inbox/Goals` interface, so it never parses the inbox's files. The `inbox` program provides it for the whole computer while it runs as a service:

```ts
import { providers } from '../node_modules/@cmodjs/core/mod.js'

const [inbox] = await providers('inbox/Goals')
inbox?.onChange(async ({ session }) => {
  const { goals } = await inbox.goals(session)
  mod.log(`${session}: ${goals?.tasks.filter((task) => task.state === 'done').length ?? 0} tasks done`)
})
```

The interface has two methods and one event:

- `goals(session)` answers the session's requirements and tasks as `goals`, and its progress blocks as `progress`, each absent when the session has none
- `sessions()` answers the id of every session with a goals or progress file
- `Change { session, part }` comes after each write, with `part` set to `goals` or `progress`, once `goals(session)` answers the new file, and with `part` set to `goal` when a session on this computer changes its goal, whose text `goals(session)` does not hold, so a mod reads it from cmod

A mod that lists `inbox` in the `dependencies` of its `.claude-plugin/plugin.json` gets these types from the inbox's `types/index.d.ts`. A mod that does not list it copies the `'inbox/Goals'` entry of that file into its own `types/index.d.ts`. The service is a new provider each time it restarts on a new version, so a mod that keeps listening asks `providers('inbox/Goals')` again on each `Change` that `cmod/Providers` tells.

## Install

The inbox is a [Claude Mod Manager](https://claudemodmanager.com) mod. It needs `trace` on the machine. A computer on inbox 0.2.0 or older updates through 0.3.0 first, which moves its items to Markdown files.

```bash
cmod install heyJordanParker/claude-inbox
```

## Develop

```bash
cmod link                  # build the inbox program, and load this checkout in every new Claude Code session
cmod check                 # check, type-check, lint, and test the mod
bun test                   # test the mod and the inbox program
bun run --cwd cli check    # type-check the inbox program and the browser view
```
