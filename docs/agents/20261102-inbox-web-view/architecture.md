# Inbox web view: architecture

The Architect asked for a web view of the inbox with the same functionality as the terminal view, and an Open in browser button on each terminal item. This file is the contract every Slice is built and judged against. Change it only through the Orchestrator.

## The controlling Decision

The files in the mod's data folder stay the single source of truth. The web server is one more reader and writer of those files, like any session. Each subscribed session reads what changed and sends its own agent the prompt, and records it as heard only after the send resolves. The two views never talk to each other, and the terminal never depends on the server.

## Data folder

```text
~/.local/share/cmod/data/inbox/
├── items/<id>.json      written only by agents' tools: file, revise, withdraw, subscribe, and by the migration below. Holds revisions, subscribers (each with `since`), status from a withdrawal
├── person/<id>.json     written only by the person's two views: { notes, answers, lastRead, queuedAt }
├── changed              "<time> <id>", written after either file of <id>; means "a file of <id> changed"
├── delivering-since     the time the first setup of this release wrote it, when it was missing
└── server.json          { port, token }, mode 0600, written only by inbox serve, through a temporary file and a rename
```

- Each file has one kind of writer. `updateItem` has no lock and cmod's `fs` cannot provide one, so an agent's revise read before the person's Approve and written after it would erase the approval before any session delivered it. With one writer kind per file, an agent's write never touches the person's answers, and the person's write never touches a revision.
- An item's status comes from both files: the person's answer or the agent's withdrawal, whichever came first.
- Every writer writes its file first, then `changed`.
- `readItems` and `readPerson` use one stamp rule: reread a file whose `modifiedAt:size` changed, and reread both files of the id `changed` names. Each reader keeps one stamp map per folder.
- At every session start, `/clear`, `/resume`, and fork (`sessions.current.onSessionStart`), `load` drops its stamps, reads every file again, and then delivers. cmod's `switchSession` resets `memory` and `session` without rerunning `setup`, so without this the session loses every item that has not changed since. That already breaks the Inbox page, `read`, and `revise` after `/clear` today.
- cmod's `fs` cannot delete, so a person file with no drafts holds `"notes": []`.
- The stored `format` rises, and `upgrade` reads an item's person fields from the person file.

The migration runs at every setup. For each item file below format 6, it writes the person file from the item's `answers`, `lastRead`, and `queuedAt` and that item's `mod.state.global.notes`, when the item has no person file. When it has one, it adds each answer the person file lacks, matched by `at`, because a session still on the old release wrote that answer after the first move. Then it rewrites the item file at the current format, so an old release skips the file as unreadable and can no longer write an answer into it. It writes `changed` once, sets `global.notes` to `{}`, and logs `moved <n> items into person/`. This rewrite is the one exception to "only agents write `items/`". The migration, its exception, and `global.notes` are deleted in the release after this one.

## The shared core: `src/items/`, which imports nothing from `@cmodjs/core`

A test fails when any file in `src/items/` imports `@cmodjs/core`. File access comes in as a `Disk` and git as a `Run`. cmod's `fs` and `process.run` already have those shapes. The server passes adapters over `node:fs` and `Bun.spawn`. Precedent: cmod's `core/src/records.ts` takes file access as a parameter.

```text
src/items/
├── item.ts        FROM inbox.ts: every type (Note moves here from state.ts), current, revisionOf, revisedAt, isOpen,
│                  revisionNumber, sentCorrections, isWithAgent, queue, withAgents, shownOf, unseenOf, byQueue, Scope,
│                  scopes, scopeNames, isInScope, Run, repositoryOf(run, project, log), kindName, ago, webLink(address, id, here, code);
│                  the session names: Sender, Senders, sendersOf(sessions), senderOf(author, project, senders),
│                  isUnnamed(items, senders), sendersFor(items, listed);
│                  the page rules both views run: nextAfter, positionLine(waiting, shown, person, now) (none on a
│                  closed item, whose answer line carries its word and time), Closed, closedItems, closedWord,
│                  closedLine, closingLines, emptyLine, narrowestScope(offered, from, id, itemsIn), noteOn,
│                  earlierNotes, projectName, whereLine; the sentences both views show: wording, notePlaceholder,
│                  precedentLine
├── store.ts       FROM inbox.ts: Disk, Store, storeIn(dataFolder, disk), readItems, createItem, updateItem, itemPath;
│                  NEW Person, readPerson, personOf, updatePerson, personPath, readerOf (Reader, Reread), Changed,
│                  rereadMs, savedServer and serverPath (Server)
├── formats.ts     MOVED: format, upgrade(), holdsPersonFields
├── tree.ts        MOVED, plus the fold and revision rules both views run: foldKey, folds, opensAt, isChanged,
│                  isUnchanged, summaryOf, Folds, Reading, readingOf, isUnfolded, foldedLine, isDrawingUnchanged,
│                  unseenAt, rootGroups (RootGroup), isLeftOpen, withRemoved
├── answers.ts     NEW: Given, Moved, NotOffered, answer(store, id, seen, given), setNote(store, item, path, revision,
│                  words), dropNote(store, item, path, revision), markRead(store, item, seen), skip, actionsOf(item, notes),
│                  viewingAfterAnswer
├── heard.ts       NEW: Heard, Told, marksIn, unheard(item, person, session, marks, senders), advanced(heard, id, told, start),
│                  isFollowed, unfollowedWarning
└── drawings.ts    NEW: diffOf(drawing) for diff and table drawings, treeOf(drawing) and TreeRow and Mark for files
                   and api drawings, diffRowsOf(code) for an example in diff, statsOf, changeCounts, kindOf,
                   diagramKindOf, drawingLabel (from tree.ts), lineRange, drawnDiagram (from src/drawings.ts)
```

How each view reaches the core:
- The terminal calls `src/items/` in-process with `storeIn(mod.dataFolder, fs)`.
- The server calls it in-process with `storeIn(dataFolder, disk)`.
- The browser imports only the pure parts (tree, `actionsOf`, drawing text, labels) and reaches the store only over HTTP.

```ts
export async function answer(store: Store, id: string, seen: number, given: Given): Promise<Person> {
  const item = await itemOf(store, id)
  return updatePerson(store, item, (person) => answeredWith(item, person, seen, given))   // checks status, revision, and that actionsOf offers the answer, then appends it with the notes as its corrections and empties notes
}
```

The answer and the emptied notes land in one write of the person file, so nothing can leave sent notes showing as drafts. An answer `actionsOf` does not offer for the item throws `NotOffered`, so Request changes with no note is refused with "Write a note before you request changes." A blank answer to a question throws `NotOffered` with "Write an answer before you send it.", and the core stores the words trimmed, so both views store the same text.

Writes and reads of the store:
- The core runs every write through one `Disk` one at a time, so a second answer in the same process reads the first and is refused as `Moved`.
- `updatePerson` writes nothing when the change returns the same person, so a second read mark of one revision sends no event.
- `readerOf` runs its reads one at a time, so a later read never finishes before an earlier one and puts older files back. A read returns `Reread`, which is `Changed` plus `skipped`: the items and person files that changed, the ids of the files deleted since the last read in `gone`, and the files it could not read.
- A file that does not parse or upgrade is skipped as unreadable, in every read and in the format-6 migration, so one bad file never stops a session's loads or its tools.
- `updateItem` hands its change the person file read in the same write turn, so `revise` and `withdraw` check the status on disk, never the status in a session's memory.
- `setNote` and `markRead` take the revision the person saw, as `dropNote` does. `setNote` refuses with `Moved` when the item on disk moved past it. `setNote` and `dropNote` also refuse with `Moved` when the item is answered or withdrawn, checked inside the `updatePerson` change. `markRead` never lowers `lastRead`.
- `revisionNumber` turns the stored index into the number people and agents read, which counts from 1. Every sentence and the `read` tool's `revision` fields use it, and the stored index counts from 0.

Rendering splits at the drawing primitives:
- Shared in `src/items/`: the item tree, the revision diff, `actionsOf(item, notes)` (each action's id, label, hotkey, primary flag, and the answer, skip, comment, or Answer box it opens; on a question, `a` puts the keyboard in the Answer box and shows as the box's hint; none on a closed item), the unified diff text of diff and table drawings with counts and stats, the /show-me tree rows of files and api drawings, and every label and sentence both views show, including the text sent to agents.
- A files or api drawing is the /show-me tree. Each `TreeRow` holds a `mark` (`+` added, `-` removed, or a space) drawn before the tree glyphs, and the line. An edited file ends in `*`, and each note follows `<-` in one column. An api drawing is its file's tree, and a changed declaration is its old line marked `-`, then its new line marked `+`. Both views color a `+` row green and a `-` row red, and an example in the language `diff` draws through `diffRowsOf` with the same colors.
- The terminal owns the Ink layout, chips, hotkeys, fitting diagrams to the width with `outlineRows`, the File page, the count widget, item-link styling, and the stored `drawn` ASCII.
- The web owns a two-column layout, Shiki highlighting of the shared diff text, Mermaid as SVG from beautiful-mermaid's `renderMermaidSVGAsync` on the stored `mermaid` source, a file view, URL routes, the same hotkeys from `actionsOf`, and the open count in the tab title.

## Rest of the tree after the change

```text
claude-inbox/
├── package.json                CHANGED  "cmod": { program: "inbox", hotkeys }
├── rules/inbox.md              CHANGED  one line: the same inbox answer can arrive twice after a reload; act on each answer number once
├── src/
│   ├── completion.ts           RENAMED from drawings.ts: completeContent(), Declared*, the agent side that runs trace and git
│   ├── actions.ts              CHANGED  tell deleted; deliver(mod, items) and the delivering set added; storeOf(mod); load also reads notes
│   ├── answers.ts              CHANGED  thin terminal wrappers: answer, setNote, dropNote, markRead, view, skip
│   ├── state.ts                CHANGED  memory.person and session.heard added; global.notes kept only for the migration
│   ├── tools.ts                CHANGED  no tell; read returns no notes
│   ├── mod.tsx                 CHANGED  program job, openInBrowser, the one-time notes migration
│   ├── components/item.tsx     CHANGED  rules from src/items, Open in browser (o) in the header, footer from actionsOf
│   ├── components/drawing.tsx  CHANGED  diff text from items/drawings.ts; keeps fit and outlineRows
│   ├── pages/inbox.tsx         CHANGED  scopeNames and closedWords from src/items
│   └── inbox.ts, formats.ts, tree.ts, drawings.ts at src/ root   DELETED (moved)
├── cli/                        NEW: the inbox program, the web server and the browser view
│   ├── package.json            bin inbox, "cmod": { "build": "bun run build", "output": "dist" }, react, react-dom, react-markdown, shiki, beautiful-mermaid
│   ├── build.ts                buildApp(): Bun.build of src/app/main.tsx into build/script.txt and build/style.txt, and src/app/index.html into build/shell.txt with its inbox-build meta set to the SHA-256 of the script and styles
│   ├── src/main.ts             `inbox serve --data <folder>`: writes server.json, binds, prints 127.0.0.1:<port>
│   ├── src/server.ts           serve({ store, port, token, senders, repositoryOf }): routes, guards, codes, the 500 ms poll of changed, the event stream
│   ├── src/disk.ts             disk: Disk over node:fs, run: Run over Bun.spawn
│   ├── src/cmod.ts             sessionSenders(): runs cmod history sessions --all --json, each session's title and isRunning
│   └── src/app/                index.html, main.tsx, api.ts (token, fetch, event stream with backoff), list.tsx, item.tsx, drawing.tsx, styles.css
├── tests/items.test.ts         NEW  behavior suite on src/items with an in-memory Disk
├── tests/mod.test.ts           CHANGED  agent tools, key to store, delivery, migration, Open in browser
└── cli/tests/server.test.ts    NEW  guards, routes to src/items, event stream, file route, server.json
```

## The web server: one `inbox serve` per computer through cmod's program job

```ts
const web = mod.use(program({ command: ['inbox', 'serve', '--data', mod.dataFolder], singleInstance: true }))
```

- `cmod program` elects the running copy and moves it when the holder's session ends or reloads. On `@cmodjs/core` 5.3.0 each other session runs it with `--no-wait`: it touches the holder's file and exits, so no session keeps a waiting process, and it runs `cmod program` again once the holder's file is gone or 15 seconds old.
- A rebuilt program reaches the running server by itself. The compiled `inbox serve`, which `Bun.main` starting with `/$bunfs/` tells apart from a `bun` run, checks the inode, size, and modification time of the path it was started as every second. That path is `process.argv0`, which holds the path the spawner named, `~/.local/share/cmod/programs/inbox`, a symbolic link, and `process.execPath` only when `argv0` is a bare name found on PATH. `stat` follows the link, so the check sees a rebuild of the same version, a new file behind the same link, and a new version, the link moved to a new file while the old build stays in place. Once the identity differs from its start and stays the same across two checks, it stops serving and exits 0. `cmod link` copies each build to a temporary file and renames it onto `~/.local/share/cmod/bin/inbox/<version>/inbox`, and moves the link with a rename too, so the file is new and whole when the check sees it. cmod's program job then starts the copy again: the holder exits with the server's 0, the holding session's job retries after 1 second, and `cmod program` runs `~/.local/share/cmod/programs/inbox`, the new build. The new copy reuses the port and token in `server.json`, and an open tab reloads onto the new build. In a walk the tab was back on the new build within 9 seconds of the rename, with no banner.
- The server binds `127.0.0.1` on the port in `server.json`. On first start it picks a free port and writes `{ port, token }` with mode 0600, and later starts reuse both. If another app holds the port, it picks a new one and rewrites the file. It writes the file before it prints `127.0.0.1:<port>` as its first line.
- The server reads the store once before it answers its first request. Then it polls `changed` every 500 ms, rereads with the core `readerOf` the mod's `load` uses, and pushes what the reader returns as one `changed` event `{ items, person, gone }` to every tab, where `gone` names the item and person files that were deleted. It counts `changed` as seen only after the reread succeeds, so a failed reread is tried again on the next poll. It also rereads every `rereadMs`, 30 seconds, the mod's timer, so a deleted file reaches the tabs although nothing wrote `changed`. A stream's first frame and a read answer from memory and never reread, so they send no event.
- `server.json` is written to a temporary file and renamed into place, and the temporary file is removed when the rename fails. `savedServer` in the core reads it for both `inbox serve` and Open in browser, and an unreadable file counts as missing, so a half-written file never crashes every session's copy in turn.
- `isFollowed` reads each subscriber's `isRunning` from the senders `sessionSenders()` lists.
- An item stores only the id of each session that wrote it, never its title or color. Both views and every tool name a session by its current title from cmod's sessions, and a session with no title by its agent type or project name plus its short id. The server learns the titles with `sessionSenders()`, which runs `cmod history sessions --all --json` (2.4 s for 859 sessions), at start, every 30 seconds, and when an item names a session it has not named yet, one run at a time. It sends the titles as `senders` in the first frame and in every `changed` event, and an event that only renames sessions carries no items. The mod learns them the same way through cmod's `sessions.list({ everyProject: true })`, and the `read` tool waits for them when an item names an unnamed session.
- The browser app is built in a first step: `cli/build.ts` runs `Bun.build` on `src/app/main.tsx` and writes `build/script.txt`, `build/style.txt`, and `build/shell.txt` (a copy of `src/app/index.html`). `server.ts` imports each `with { type: 'file' }`, so `bun build --compile` embeds the three files and `bun run` and `bun test` read them from `build/`. The guarded handler serves them itself at `/`, `/items/:id`, `/app.js`, and `/app.css`, so every request, the shell included, passes one guard and gets the CSP. The files end in `.txt` because `@types/bun` declares `*.txt` as a string, and the declarations for `with { type: 'file' }` apply only from TypeScript 7.1. `cli/build/` is git-ignored, and the server tests build it before they import the server.

HTTP API:

```text
GET    /  and  /items/:id                  the app shell, no token
GET    /app.js  and  /app.css              the app's script and styles, no token
POST   /api/tokens          {code}         → {token}                           Origin required, code used once
POST   /api/codes                          → {code}                            Bearer token, called by the mod
GET    /api/events?project=…               stream: first "listed" {items, person, repositories, senders, build}, then "changed" {items, person, gone, senders}  Bearer token
GET    /api/items/:id/file?path=…          → text                              Bearer token, path named by a drawing
POST   /api/items/:id/answer {seen, kind, option?, words?} → {person, isFollowed}   400 when actionsOf does not offer it or the answer is blank
PUT    /api/items/:id/notes  {path, revision, words}  empty words drops the note; 409 when the item moved past revision
DELETE /api/items/:id/notes  {path, revision}  idempotent: a note already gone answers 200
POST   /api/items/:id/read   {seen}         marks seen read, also after the item moved past it
POST   /api/items/:id/skip   {seen}
```

Security:
- Listens on `127.0.0.1` only.
- Every request must carry `Host: 127.0.0.1:<port>`, which blocks DNS rebinding.
- Every `/api` request except `/api/tokens` needs `Authorization: Bearer <token>`, compared in constant time.
- A request that carries an Origin header must carry `http://127.0.0.1:<port>`. `/api/tokens` requires it.
- No CORS headers. The app's HTML, JS, and CSS need no token because they hold no data.
- Item text never renders as raw HTML: react-markdown without raw HTML, Shiki escapes code, Mermaid SVG renders inside `<img>`.
- CSP: `default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`.
- The file route serves only paths one of the item's drawings names, inside the item's project.
- The tab reads the event stream with `fetch` so it can send the token, and keeps the token in `localStorage`.

Reconnecting:
- When the stream breaks, the tab retries after 0.5, 1, 2, and 4 seconds, then every 5 seconds. It shows "Reconnecting to the inbox…" only once the server has been away for 5 seconds, so a restart onto a new build shows no banner. A tab opened or reloaded while the server is down retries trading its code the same way.
- Each time the stream opens, the first time and on every reconnect, its first frame is the `listed` event: every item, every person file, the repository of each project and of the tab's own, and the build the server's shell names. The server writes it before the stream joins the set that hears `changed`, so one connection carries the listing and every change after it, in order, and no change is lost between them.
- A `changed` event that names a project the tab has no repository for makes the tab reopen the stream, and the new first frame names it.
- A tab whose own `inbox-build` meta differs from the listing's `build` reloads itself, so a tab never keeps running the script of an older server.
- A reply to the tab's own answer, note, read, or skip replaces the person the tab shows only when no stream frame named that person since the request was sent, so a tab never replaces a newer person with an older one.
- After 60 seconds without a server it says "The inbox moved. Open it again from the terminal."
- An answer posted while the server is down shows "The inbox server did not answer. Once it reconnects, this item shows whether your answer was recorded." and keeps the typed text. The tab never retries a POST by itself.

## Delivery: each subscribed session delivers its own prompts, at least once

`tell` and its cross-session relay are deleted. After `load` updates memory, `deliver` finds what this session has not been told about each item it subscribes to. A person's answer becomes a Prompt. Another session's revision or withdrawal becomes a Note. The terminal's own answers take the same path.

```ts
const delivering = new Set<string>()

async function deliverItem(mod: Mod<InboxState>, id: string): Promise<void> {
  if (delivering.has(id)) return
  delivering.add(id)
  try {
    for (let told = nextUnheard(mod, id); told !== undefined; told = nextUnheard(mod, id)) {
      const sentTo = sessions.current.id
      await sessions.current.send({ type: told.kind === 'prompt' ? Prompt : Note, text: told.text })
      if (sessions.current.id !== sentTo) return
      mod.state.session.heard = advanced(mod.state.session.heard, id, told, start)
    }
  } finally {
    delivering.delete(id)
  }
}
```

- Each item has two marks, one per file: `person` orders the answers in the person file, and `item` orders the revisions and withdrawal in the item file. A load can read one file before the other, so one mark across both would let a revision at T2 hide an answer at T1 that a later load reads. Each mark is the `at` of the newest entry of its file this session was told about, plus how many entries it was told at exactly that `at`, so two entries written in one millisecond are both delivered. A session's single mark from before this change seeds both marks, and that seeding is deleted with the migration.
- Each `subscribers` entry records `since`, the time it subscribed. A revision or answer is unheard when its `at` is after both the mark and `since`, and a writer other than this session made it. Counting entries instead would drop a later answer after an overwrite shrank the array, and would let a revise swallow a correction stored just before it.
- A missing mark starts at the time in `<dataFolder>/delivering-since`. So a session that starts long after the upgrade still receives the answers given since the upgrade, and repeats nothing `tell` sent before it.
- `heard` advances only after delivery is confirmed, one message at a time. A send that rejects is logged and the mark stays. A send that resolves after `/clear` or `/resume` records no mark, because the current session is no longer the one it went to.
- Delivery runs after every load and also every 30 seconds, so a refused send is retried without waiting for an unrelated change.
- `sessions.current.send` of a Prompt resolves when the prompt enters the conversation, not when Claude Code queues it. Slice 2 measured it live: a send started 8 seconds into a 33-second turn resolved 59 ms after the turn ended and 6 ms before `onPrompt` heard it. So a session quit mid-turn never records the answer as heard, and receives it on resume.
- `deliver(mod)` checks every subscribed item. A message stamped at or after `since` counts, so an answer in the same millisecond as a subscribe is kept. Own events are filtered by author, so filing, revising, and subscribing set no mark.
- A load drops from memory every item and person entry whose file is gone. The `read` tool loads before it answers, and a 30-second timer loads, because a deletion writes no `changed`.
- A duplicate can happen only when a reload or exit lands after delivery and before cmod saves `heard`, when cmod fails to save `heard`, or when two windows run one conversation id. Each prompt names its answer number, as in `… (exhaustive-match), answer 2`.

## Notes live in the person file

- Agents never read or write the person file, and the `read` tool returns no notes. Notes reach an agent only as the corrections of an answer the person sends.
- The mod keeps person files in `mod.state.memory.person` and still watches only `changed`.

Read state is the person file's `lastRead`, shared by both views. Each view sets it on answering, Next →, moving to another item, and hiding the view; in the web, moving includes the browser's Back and Forward, and hiding means the tab is hidden or closed. Folds stay per view, in terminal `session` state and web `localStorage`, with the shared `foldKey` and `opensAt`. Scope stays per view: the terminal's `session` state, and the web's URL, which carries the session id and project from Open in browser. A bare URL shows every project.

## Open in browser

A Button in the item's header row, `Open in browser`, hotkey `o`.

The press takes the port and the token from `server.json`, not from this session's `web.ready()`. A session whose own job went `fatal` would otherwise fail while another session's copy serves. It calls `web.ready()` only when `server.json` is missing or the server does not answer, then reads the file again.

```ts
const openInBrowser = async (current: Mod<InboxState>, id: string): Promise<void> => {
  const { port, token } = await runningServer(current)   // server.json, falling back to web.ready() then server.json again
  const url = `http://127.0.0.1:${port}`
  const minted = await http.fetch(`${url}/api/codes`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
  const { code } = JSON.parse(minted.text) as { code: string }
  await process.run([(await device.read()).os === 'darwin' ? 'open' : 'xdg-open', webLink(url, id, here(), code)])
}
```

The link is `http://127.0.0.1:<port>/items/<id>?session=<id>&project=<path>#code=<code>`. The code works once and expires in 60 seconds. The tab trades it for the token and removes the fragment. A tab that already holds a valid token uses it and ignores a spent code. When no server answers, the press shows the program's failure as a toast.

The program answers `inbox --version` with the version in `.claude-plugin/plugin.json`, because cmod runs `<program> --version` on every release download and refuses a nonzero exit.

## Behaviors a person sees change

- The browser view: the same items, notes, read marks, and actions at `http://127.0.0.1:<port>`.
- Open in browser (`o`) on each terminal item.
- Notes show in both views, and an edit in one shows in the other within about 500 ms.
- The answering session's own prompt arrives within about 500 ms instead of at once.
- A closed session receives answers given while it was closed when it resumes.
- The no-running-session warning says "Your answer is kept with the item, and reaches its session when it resumes."
- Each prompt ends with its answer number.
- An answer is never lost to a reload, and can arrive twice in the cases above.
- Revision and withdrawal notes to other sessions arrive within about 500 ms. A subscribed session with the inbox turned off no longer hears them.
- No item leaves the views. Both views list every closed item in the scope under Closed, each marked approved, rejected, answered, picked, done, or withdrawn, and a closed item opens with its answer and no actions.
- Every item names each session by its current title, also an item it filed under an older title.
- A files or api drawing is the /show-me tree, colored the same way in both views.

The footer stays as built in both views: Approve, Reject, Request changes, Done, Comment, Next →, Pick option N, and Answer.

## Slices

Slice 0 is done: the compiled program serves an embedded React page, built and linked by cmod. Slices 1, 3, and 2 run in that order. Slices 4, 5, and 6 need Slice 2, and run in order.

### Slice 0: spike the compiled program with an embedded React page
Build `cli/package.json` with `"cmod": { "build": "bun run build", "output": "dist" }` and `bin` `inbox`, and a `main.ts` that serves an HTML-imported React page saying "inbox web" and prints `127.0.0.1:<port>`. Its files become Slice 4's starting point. If it fails, Slices 4 to 6 stop and the failure goes to the Architect.
- `cmod link` builds the program and links `~/.local/share/cmod/programs/inbox`.
- A copy of the binary in a folder with no `node_modules` runs `inbox serve --data <scratch folder>`, prints its address, and serves the page.
- A browser renders the React text, with a screenshot as Evidence.
- `cmod check` passes.

### Slice 1: move the shared core to `src/items/` with no behavior change
- Every assertion in `tests/mod.test.ts` passes unchanged, with only imports updated.
- The import-rule test passes, and `cmod check` passes.
- Live: filing a proposal, a note, Request changes, a revision, and Approve behave as before.

### Slice 2: replace `tell` with `deliver`
- Tests: an answer another writer stores arrives once at a subscriber and never at a non-subscriber; own events never come back; a restart after the send repeats only that message; a restart before the send delivers it; the first start on the new release sends no old answers.
- Live: two sessions follow one item; an answer from one reaches the other as a Prompt, and a revision reaches the other as a Note.
- Live: a Prompt delivered while the receiving session is mid-turn still arrives after `/reload-plugins` runs in that session before the turn ends.

### Slice 3: split the person's data into `person/<id>.json`
- Tests: a note save, an answer, a read mark, and Next → never change the item file; a revise, withdraw, or subscribe never changes the person file; an agent's revise interleaved with an Approve keeps both; status comes from whichever of answer and withdrawal came first; `read` returns no notes; an answer carries the notes and empties them in one write; the migration moves answers, read marks, queue times, and `global.notes`, and runs only while `person/` is missing.
- Live: a note typed in one session shows in a second session within a second; the debug log shows `moved <n> items into person/`; after `/clear` and `/resume`, the Inbox page and `read` still list every open item.

Slice 3 runs before Slice 2, because delivery reads answers from the person file. The order is Slice 1, Slice 3, Slice 2.

### Slice 4: the server, its API, and its guards
- Server tests: a bad Host, a foreign Origin, a missing token, or a reused or expired code is refused; every route changes the store as the core does; the event stream fires within a second of a file change; `server.json` has mode 0600 and is reused on restart.
- Live: one `inbox serve` runs with three sessions open; ending the holder's session brings a new copy on the same port within about 10 seconds; `curl` with the token posts an Approve, and the subscribed agent receives the prompt.

### Slice 5: the web app reaches parity
Live, with a screenshot of each: every item kind renders; every footer action works, including Comment, notes on an earlier revision, and Next →; a revised item opens only changed parts with old words struck through; folds persist across a reload; wide Mermaid draws as SVG; Shiki highlights diffs; the file view opens; a filed item appears without a reload; ending the holder's session shows the banner, then the tab recovers and refetches; posting during the gap shows the error and keeps the typed text; an idea holding `<script>` and `<img onerror>` renders as text.

### Slice 6: Open in browser in the terminal
- Test kit: the press reads `server.json`, posts `/api/codes`, and runs the opener on a link with `#code=`.
- Live: pressing `o` opens the browser on the same item and scope; opening the same link again is refused and asks the person to open it again from the terminal.

## Known costs outside this plan

- Files still have no lock. The core orders the writes inside one process, but two agent sessions revising one item at once, or the terminal and the browser writing one person file at once, can still overwrite each other, as two agents can today. An answer given in the terminal and the browser in the same moment can both be accepted, and the agent then receives both. No write of an agent and the person shares a file anymore.
- A fresh clone needs `bun install --cwd cli` before `cmod link` can build the program, because cmod installs packages only at the mod's root.
