# Triage of the web view review

## Round 1

Reviewers: code-reviewer (correctness, called CR here) and ponytail (size, called PT here). Both reviewed the whole uncommitted changeset against architecture.md.

### User

**Blocking: CR1, an answer given in a session on an old build is lost.**
- Code: `withoutPerson` in `src/items/formats.ts` drops `answers`, `lastRead`, `queuedAt`, and `status` from any file below format 6. `moveIntoPersonFiles` in `src/items/store.ts` writes person files but never rewrites the item files, so old builds keep writing answers into them. The move is also guarded by `exists(store.person)`, so it never runs again.
- Ruling: every load moves any item file below format 6 into its person file, when that item has none, and rewrites the item file at the current format, so old builds skip it. This replaces the one-shot guard. It is the one migration exception to "only agents write items/", and it is deleted with the rest of the migration.

**Blocking: CR2, a revision note can hide an answer forever.**
- Code: `load` in `src/actions.ts` reads `items/` and `person/` in parallel, while one `Mark` per item in `src/items/heard.ts` orders entries from both files.
- Ruling: two marks per item, one for each file. Deliver no answer twice. A session's existing single mark seeds both new marks, so no live session gets a second send of every answer.

**Important: CR3, after Request changes the browser leaves the item.**
- Code: `actionsFor.answer` in `cli/src/app/main.tsx` never sets `viewing`, and `src/answers.ts` does.
- Ruling: fixed by PT1. Both views run one core rule.

**Important: CR4 and PT's race, the browser misses changes made between a snapshot and the stream.**
- Code: `follow` in `cli/src/app/api.ts` refetches only after a failure. `refetch` overwrites with the snapshot.
- Ruling: no change may be lost between a snapshot and the stream, on the first open or on any reconnect.

**Important: CR5, a new item can take a deleted item's answer.**
- Code: `createItem` passes only the `items/` ids to `newId`.
- Ruling: pass the ids of both folders.

**Polish: CR6, smaller gaps.**
- Fix the double click on action buttons.
- Fix the 500 when Request changes has no note.
- Fix the sign-in banner that never retries when the server is down.
- The answer route accepts any kind for any item. Validate it against `actionsOf`.

**Unconfirmed: CR, `broadcast` may throw on a stream that has disconnected.**
- Ruling: prove it with two tabs and one dropped, then guard it if it is real.

### Architecture

**Important: PT1, the item and page rules are written twice.**
- Code: confirmed in both `ItemView`s. The scope widening has already drifted between them.
- Ruling: one core item view and one core page view, with sentences as core constants, and names through /naming.

**Important: PT2, the stamped reader is written twice.**
- Code: `load` in `src/actions.ts` and `reread` in `cli/src/server.ts`.
- Ruling: one core reader.

**Polish: PT3, `server.json` is parsed twice.**
- Ruling: one `Disk`-based reader in the core.

**Polish: PT4, the answer route's `item` and the DELETE note lookup.**
- Ruling: drop `item`, which changes the contract. Make `dropNote` take a `path` and a `revision`, and make it idempotent.

**Polish: PT5 through PT8, small cuts.**
- Duplicate tests.
- Shiki aliases.
- `CodeReader`.
- Exports used only inside their file.
- The note-to-correction copy.
- The format-6 shortcut.
- `messageOf` in the mod.
- Rulings:
  - Keep `merged` only if the CR4 ordering needs it.
  - Delete `void deliver(mod)` only after a live check shows that `fs.onChange` fires for the mod's own write.

**Polish: CR, the contract contradicts itself.**
- Code: the file tree in architecture.md says that `tools.ts` sets `session.heard`. The Delivery section says that own events are filtered by author.
- Ruling: fix the file tree.

### Business

No findings.

### Dropped

Nothing was dropped. Every finding matched the code.

### Round 1 outcome

Every Round 1 ruling landed. Checked by the Orchestrator: `bun test` 110 pass and 0 fail, `bun run --cwd cli check` clean, and the screenshots in the scratchpad's `round1/` folder show Request changes keeping the item in both views and every answer kind closing in the browser.

Departures from the rulings, accepted:
- The new core rules went into `src/items/item.ts` and `src/items/tree.ts`, which already held the page and item rules, instead of two new files.
- The migration also adds to an existing person file any answer an old build wrote after an earlier move, matched by `at`.
- The server runs its writes one at a time, so a double click gets the 409 instead of two accepted answers.
- The broadcast finding is not real: Bun runs `cancel()` on every disconnect. Its test stays.

Found during the fixes, carried into Round 2:
- The terminal's Answer box on a question takes only a mouse click. Tab moves focus to the prompt.
- The agent's tools number revisions from 0 and the page from 1.
- `revise` accepts a revision identical to the last one.
- `refresh` in the server re-sends the item `changed` names to every tab on each listing, read, and answer.
- The terminal and the server are two processes, so an answer given in both at the same moment can still both be accepted.
- One comment remains in `src/components/item.tsx`.

## Round 2

Reviewers: code-reviewer (CR) and ponytail (PT), on the same target and Prompt as Round 1. The code-reviewer's guard refused `bun run --cwd cli check` and scratch folders, so its races are traced by reading.

### User

**Important: CR1, a slower terminal load puts stale person data back.**
- Code: confirmed. `read` in `readerOf` in `src/items/store.ts` has no chain, and `remembered` in `src/actions.ts` merges person entries with no staleness check. The server avoids it only through its own `refreshing` chain in `cli/src/server.ts`.
- Effect: the Sidebar shows an item answered in the browser as open, or a saved note gone, for up to 30 s. `revise` and `withdraw` in `src/tools.ts` read that memory, so an agent can revise an answered item.
- Ruling: `readerOf` runs its reads one at a time, and the server's `refreshing` chain is deleted.

**Important: CR2 and PT, an empty Answer closes a question.**
- Code: confirmed. `isOffered` in `src/items/answers.ts` checks only the kind for `answer`. The browser's ⌘↵ handler skips the disabled check, and the terminal's Enter sends the empty box. PT's probe stored `{"kind":"answer","words":"  \n"}`.
- Ruling: the core refuses a blank answer with `NotOffered` and stores the words trimmed, so both views store the same text. The browser's own empty check goes.

**Important: carried item 1, a question's Answer box cannot be reached by keyboard in the terminal.**
- Code: confirmed. The Answer `Input` in `Actions` in `src/components/item.tsx` has no `autoFocus` and no hotkey. Release 0.1.0 had an Answer button on `a`.
- Ruling: on a question, `a` puts the keyboard in the Answer box in both views, shown as its hint like every other action. A question offers no Approve, so `a` is free. PT's `autoFocus` is rejected: printable keys would then go to the box, and `x`, `m`, `n`, and `o` would stop working on a question.

**Important: carried item 2, the agent's revision numbers are one lower than the page's.**
- Code: confirmed. `revisionOf` returns the index. `whenLine` and `foldedLine` add 1. `revise` and `read` in `src/tools.ts` and `noteLines` in `src/items/heard.ts` do not.
- Ruling: one core function turns the index into the number people and agents read, named through /naming, and every sentence and tool answer uses it, including the `read` tool's `revision` fields. An agent then quotes the number the person sees. The stored index is unchanged. PT's cut, deleting the number from agent sentences, is rejected: the `read` tool would still give agents the other number.

**Important: CR smaller 4, a browser note can land on the next revision.**
- Code: confirmed. `PUT /api/items/:id/notes` carries no revision, and `setNote` in `src/items/answers.ts` takes the revision of the item on disk.
- Ruling: `setNote` takes the revision the person saw, as `dropNote` does, and refuses with `Moved` when the item has moved on. Both views pass the revision they draw.

**Important: carried item 5 and CR smaller 5, a second write in one process is accepted, and a failed write in the terminal is silent.**
- Code: confirmed. `serially` in `cli/src/server.ts` orders only the server's writes. The terminal's `void answer(…)` and `void setNote(…)` in `src/components/item.tsx` drop a rejection, and the note editor closes before the write resolves.
- Ruling: the core orders every write of one store, which replaces `serially`. The terminal ignores an action press while an answer is sending, as the browser does, and a failed write shows a toast with the reason and keeps the note being written.
- The terminal and the server are two processes, so one answer in each at the same millisecond can still both be accepted. That stays the accepted cost of a store with no lock, and the contract's wording of it is corrected to say the agent can receive both.

**Polish: carried item 3, `revise` accepts an identical revision.**
- Ruling: `revise` refuses content identical to the current revision, and says so to the agent.

**Polish: CR3, the terminal's Answer `Input` key is `answer` for every question.**
- Code: confirmed against the Fact that every such key holds the part's path. Whether the host keeps a draft across items is unconfirmed.
- Ruling: the key holds the item id.

**Polish: CR smaller 6, a send in flight at `/clear` or `/resume` records its mark in the next session.**
- Code: confirmed by reading `deliverItem` in `src/actions.ts`. How the host settles a queued prompt across a switch is unconfirmed.
- Ruling: `deliverItem` records the mark only when the current session is still the one it sent to.

**Polish: CR smaller 8, the browser keeps a vanished item, and a failed listing is never retried while the stream stays open.**
- Ruling: the stream tells tabs which items and person files are gone, and `follow` retries a failed listing with the same backoff as the stream.

### Architecture

**Important: carried item 4 and PT cut 2, `refresh` re-sends an item on every listing and read.**
- Code: confirmed for `listed` and `personNow` in `cli/src/server.ts`. The answer route does not call it. `personNow` exists only because the core `markRead` takes a person from memory. PT's probe counted 5 events for three listings and one read before the cut, and 1 after.
- Ruling: PT's cut. `markRead` takes the revision the person saw and decides on the file as it is on disk, `updatePerson` writes nothing when the change returns the same person, and both `refresh` calls and `personNow` go. The read route stops refusing a moved revision. The server reads the store once before it answers its first request.

**Polish: PT cut 1, the browser writes the note form and the Answer form twice.**
- Code: confirmed. `NoteEditor` and `Answer` in `cli/src/app/item.tsx` differ only in Cancel, `autoFocus`, clearing, and the send guard.
- Ruling: one component for both, named through /naming, checked in a real browser.

**Polish: PT cut 3, `rawHtmlAsText` repeats react-markdown's default.**
- Ruling: delete it. PT's probe of `<script>`, `<img onerror>`, and `<div onclick>` becomes a real test.

**Polish: PT cut 4, the git fallback sentence is written in both processes.**
- Code: confirmed in `repositoryIn` in `src/actions.ts` and the option in `cli/src/main.ts`.
- Ruling: `repositoryOf` in `src/items/item.ts` takes a `log`, as `isFollowed` does, and both wrappers go.

**Polish: PT cut 5, `answerKinds` in `givenOf` repeats `isOffered`.**
- Ruling: delete it. An unknown kind still gets the 400 from `NotOffered`.

**Polish: carried item 6 and PT cut 6, two comments remain.**
- Code: one above `drawingInset` in `src/components/item.tsx`, one in `outlineRows` in `src/components/drawing.tsx`.
- Ruling: delete both. Name `drawingInset` for what it adds up, and return the source rows from the `catch`.

**Polish: PT smaller items.**
- `PersonFiles` replaces each spelled-out `Readonly<Record<string, Person>>`.
- The `Changed` event shape is declared once in the core.
- The formatter runs on `src/components/item.tsx`.

### Dropped

- CR smaller 7, a 0.1.0 session throws on migrated files and a 0.2.0 answer can arrive twice: no answer is lost, each arrives numbered, and both end when that session reloads. No fix.

### Round 2 outcome

Every Round 2 ruling landed. Checked by the Orchestrator: `bun test` 124 pass and 0 fail, `bun run --cwd cli check` clean, and the scratchpad's `round2/` screenshots show the keyboard-only answer reaching the agent and a browser note saved on the revision the person saw.

Departures from the rulings, accepted:
- Writes are ordered per `Disk`, because `storeOf(mod)` builds a new `Store` on each call and a process has one `Disk`.
- The Answer box is an `actionsOf` action on `a`. It draws with `autoFocus` only after `a`, since cmod has no call that moves the keyboard to an element.
- The project has no formatter, so Prettier ran on `src/components/item.tsx` alone. Choosing a formatter is a new dependency, so it goes to the Architect.

Found during the fixes, carried into Round 3:
- The inbox server keeps serving the build it started with after `cmod link` installs a new one. The browser then runs old code until the session holding the server ends.
- After `a`, hiding and reopening the page gives the keyboard back to the Answer box, so `x` and `m` type letters instead of pressing Reject and Comment.

## Round 3

Reviewers: code-reviewer (CR) and ponytail (PT), on the same target and Prompt. Both stopped once on an API timeout and were resumed. The code-reviewer's guard again refused `bun run --cwd cli check`, so its races are traced by reading.

### User

**Important: CR1 and carried item 2, a keyboard request after `a` lasts forever.**
- Code: confirmed. `session.editing` is the only keyboard request, and the Answer `Input` draws with `autoFocus` on every show until an answer, a move, or `toggle` clears it. Esc, Tab, `meta+0`, and tab switches leave it set. `filed` in `src/mod.tsx` reads any `editing` as "the person is writing", so filed items stop opening. `toggle` clears `editing` on hide, which deletes a note being typed in the terminal. The browser keeps drafts.
- PT confirmed the same cause. The mod hears neither Esc nor a hide: `InputProps` has no blur handler, and pages have no hide event. Claude Code has `$.ui.focus({ requestId, key })`, which moves the keyboard once, like the DOM's `element.focus()`. cmod wires it in `core/src/register.ts` and uses it only for toasts. `Page` and `Pane` in cmod's `core/src/ui/panes.ts` offer `scrollTo` but no `focus`.
- Ruling: no in-repo fix holds. The fix is `page.focus(key)` in cmod beside `scrollTo`, which is a cmod Public API change, so it goes to the Architect as a proposal. With it, `a` focuses the Answer box once, and the lasting `answerKey`, the conditional `autoFocus`, and the `filed` toast it causes are deleted.

**Important: CR2 and carried item 1, the server and its tabs keep the old build.**
- Code: confirmed in cmod's `commands.md`. The `program` job's holder stops its copy only on a signal, its session's exit, or the copy's exit. Nothing checks the program file. A tab keeps its old JavaScript, and an old tab's note PUT without `revision` gets a 400.
- PT observed it: the running `inbox serve` started at 11:32:59, and `cmod link` rewrote `~/.local/share/cmod/bin/inbox/0.2.0/inbox` in place at 12:01:09. The version and the path stay the same.
- Ruling: the program job owns a program's lifecycle, so cmod's holder restarts its copy when the program file changes. It already wakes every 5 seconds. That fixes every cmod program, not only the inbox, and it goes to the Architect with the `focus` proposal. A self-exit inside `inbox serve` is rejected, because the inbox would carry a lifecycle rule that belongs to cmod. In this repository, the server names its build in the stream's first frame, and a tab whose build differs reloads itself.

**Important: CR3, a note saved on an item the other view just answered is stored and never sent.**
- Code: confirmed. `setNote` in `src/items/answers.ts` checks the revision and never the status.
- Ruling: `setNote` and `dropNote` refuse with `Moved` when the item is not open, checked inside the `updatePerson` change.

**Important: CR4, the server drops a change when a reread fails, and never sees a deletion.**
- Code: confirmed. `poll` in `cli/src/server.ts` sets `lastChanged` before `reread` resolves. `readFresh` in `src/items/store.ts` runs `upgrade` outside `storedIn`'s guard, so one bad file rejects every `load` in every session, and `moveIntoPersonFiles` has no guard either.
- Ruling: `lastChanged` moves only after a reread succeeds. A file that does not parse or upgrade is skipped as unreadable, in reads and in the migration. The server rereads on the same 30 s timer as the mod, so a deletion reaches the tabs.

**Important: CR5, the Sidebar cannot open the fifth item of a list.**
- Code: confirmed. `listedCount = 4` in `src/pages/inbox.tsx` draws the rest as "and N more". `HEAD` has no limit, so this is a regression from this change. The browser lists every item.
- Ruling: every item in Waiting and With agents opens from the Sidebar, as in the browser.

**Important: CR6, `revise` and `withdraw` check the status against memory.**
- Code: confirmed. Both call `statusOf(fresh, personIn(mod, fresh))` in `src/tools.ts`.
- Effect: an agent revises an answered item and is told "the inbox shows it to the user", or is told "Withdrew X" while the item stays answered.
- Ruling: both read the person file inside the change.

**Polish: CR7, smaller differences between the views.**
- Back and Forward in the browser move without marking the left item read. Ruling: they mark it read, as the Sidebar does.
- Esc does nothing in the browser's Answer box. Ruling: Esc leaves it, as in the note box and the Sidebar.
- An answer reply can replace a newer person that arrived on the stream. Ruling: a tab never replaces a newer person with an older one.

### Architecture

**Important: PT1, the tab merges a listing and a stream that arrive on two connections.**
- Code: confirmed. `held`, `settled`, `isResyncAsked`, the listing retry, `onListed(fresh, since)`, and `onFailed` in `cli/src/app/api.ts` exist only to restore the order of two connections. Round 1's CR4 and round 2's CR smaller 8 each added to them, and neither removed the cause.
- Ruling: PT's cut. The stream's first frame carries the listing, written before the stream joins the broadcast set. `GET /api/items` and the merge are deleted, and resync reopens the stream. PT measured 64 source lines deleted and 17 added. The contract's API table and "Reconnecting" change with it. The rejected cookie and `EventSource` design stays rejected, because it moves the token into a cookie the browser sends by itself. Walk the unknown-project reconnect in a real browser.

**Polish: PT2, `Reread` and `Changed` are one shape with two names.**
- Ruling: PT's cut. The reader returns the gone ids as lists, `Reread` becomes `Changed` plus `skipped`, and the server broadcasts what the reader returns.

**Polish: PT3, `Correction` duplicates `Note`.**
- Ruling: `Note` replaces `Correction`. The stored shape does not change.

## The Architect's requests after round 3

The Architect reviewed items in both views and asked for these before the commit. Screenshots are in `~/Library/Application Support/CleanShot/media/` from 2026-11-03 13.08 to 13.10.

**A1, an item names its session by the title it had when it was filed.**
- Code: `author()` in `src/actions.ts` writes `Author.title` into the item, and both views and the agent tools show that stored title. This session filed items as "propose mod" and has had another title for a long time.
- Ruling: an item stores the session's id, never its title or color. Both views and every agent tool show the session's current title, read from cmod's sessions at read time. A session with no title shows the existing fallback of agent type or project name plus the short id. Stored titles in old items are ignored, with no migration.

**A2, the browser draws trees worse than the terminal.**
- Code: the browser draws a tree's box characters with gaps between rows, and its columns do not line up.
- Ruling: every tree and code block in the browser looks at least as good as the terminal: unbroken lines, aligned columns, and no wrapping inside a word. Use /design.

**A3, no drawing colors what changed.**
- Ruling: in both views, every drawing the inbox draws shows an added row in green, a removed row in red, and a changed row as its old line in red followed by its new line in green. An `example` in the language `diff` gets the same colors.

**A4, the inbox's own trees do not follow /show-me.**
- Ruling: the `files` and `api` drawings draw the /show-me tree. A `+` or `-` marker opens the row, before the tree glyphs. An edited file has a `*` suffix. Each annotation follows `<-` and holds under nine words. No other indicator is drawn.

**A5, closed items disappear.**
- Code: `recentlyClosed` in `src/items/item.ts` keeps 4 closed items and shows them only when nothing is open.
- Ruling: no item ever leaves the views. Both views show every closed item in the scope in its own section, always, each marked approved, rejected, answered, picked, done, or withdrawn, and each opens with its answer.

**A6, the inbox runs on an old cmod.**
- Ruling: move to @cmodjs/core 5.3.0 and let `cmod check` write the range.
