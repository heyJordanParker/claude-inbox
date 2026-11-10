# Changelog

What changed in each version of inbox, for the people who use it. cmod publish releases the section for the version, and the Updated toast and Settings show it.

## [0.4.0]

### Added
- A report names the items its work finishes, the proposal, choice, or question it ships, and each earlier report on the same work, and they leave your list with it. They wait in the Archive marked delivered, so the list shows one row for each piece of work. The report's row says how many items it delivers, the report lists them under Delivers, and each delivered item names its report under Delivered by, a press away, in the Sidebar and in the browser. An item you rejected or are waiting on changes to can't be delivered.
- The browser view works with no Claude Code open: its program runs whenever you are logged in, as a service of your computer, and restarts on each new version by itself.

### Changed
- An agent's `read` lists only what is still open, leaves out what a report delivered, and names the report that delivered an item.
- The inbox needs cmod 5.10.0 or newer.
- Items stored as JSON by inbox 0.2.0 or older no longer convert. Update through 0.3.0 first.

### Fixed
- The Inbox page no longer blanks the whole Sidebar in Claude Code 2.1.318 when the Archive line shows.
- Claude Code no longer stops the inbox's hooks when a session starts slowly. The inbox waits at most 5 s for its start, inside the 10 s Claude Code gives a hook.

## [0.3.0]

### Added
- The browser view: **Open in browser**, or `o`, in an item's header opens it in your browser with the page's scope. The browser has the same items, notes, read marks, folds, and actions with the same keys, draws wide Mermaid diagrams whole and diffs with syntax colors, opens a drawing's file, and shows an item an agent files without a reload. It follows your system's light or dark theme.
- The browser answers only this computer and only a tab you opened from the terminal, through a code that works once for 60 seconds. A tab you opened before keeps its key, so it ignores the next code and opens the item straight away.
- When the session running the browser's server closes, another session takes over on the same port, and the tab shows "Reconnecting to the inbox…" until it is back. An answer you give while it is away shows an error and keeps what you typed.
- When no server answers, Open in browser shows why in a toast, and the terminal page keeps working.
- An agent resubmits a proposal, choice, or question you rejected by revising it. The same item comes back to your list marked changed, with its history and your rejection, instead of arriving as a new item.
- Your rulebook rules check each item an agent files or revises, before the inbox stores it, as `@inbox/<id>.md`. A refusal goes back to the agent word for word, and nothing is stored. When rulebook cannot run, the item is stored and the agent is told why the check did not run.

### Changed
- Each item is a Markdown file you can open in any editor: `items/<id>.md` in the inbox's data folder holds it as it reads now, `revisions/<id>/` holds each earlier revision, and `person/<id>.md` holds your answers, notes, and read marks. Each item stored as JSON converts at the next start, with every revision, answer, note, and withdrawal, and its JSON file goes.
- Your answer reaches the session that asked within about half a second, whether you give it in the terminal or in the browser.
- A session that was closed when you answered receives your answer when it resumes.
- Each answer's prompt names its number, as in `answer 2`, so an agent that receives the same answer twice after a reload acts on it once.
- After Request changes, both the terminal and the browser stay on the item while the agent revises it.
- An answer the item does not offer, such as Request changes with no note, is refused with the reason, and a second press while the first is sending does nothing.
- An answer you gave in a session still on 0.2.0 or older moves into the new person file the next time a session starts on this release.
- An answer stands when the inbox cannot list the running sessions. The failure goes to the log, and no warning claims that a session missed it.
- A renamed Problem or Solution shows its old title struck through, as a changed idea does.
- A note on the Goal, or on why a question matters, reaches the agent under that name, not as a note on the whole item.
- On a question, `a` puts the keyboard in the Answer box, in the terminal and in the browser, so you answer without the mouse. The box shows `a` as its hint. In the Sidebar it moves the keyboard once, so a box or note you leave unsent never takes the keyboard back when the Sidebar shows, and `x`, `m`, `n`, and `o` press their buttons.
- The browser view is redesigned: each kind, status, part, and session has its own color in light and dark mode, an item reads title, Goal, then each Problem with its Solution, the answer bar stays on screen with its keys while you read, and the list and the item stack on a phone.
- An empty answer is refused with "Write an answer before you send it.", and an answer is stored without the spaces around it.
- A note you write while an agent revises the item is refused with the reason and keeps your words, instead of landing on a revision you have not read.
- A note or answer the terminal cannot save shows the reason and keeps your note open.
- An agent quotes the same revision number the page shows, and an agent's revise that changes nothing is refused, so the item stays as it was.
- An item you answered, or a note you saved, in the browser no longer shows as open or missing in the terminal for up to 30 seconds.
- A second press while an answer is sending does nothing in the terminal too.
- The browser drops an item whose files were deleted, within 30 seconds even when nothing else changes.
- The browser gets the list and every change on one connection, so no change is lost between them, and an item from a project the tab has not seen shows its project.
- A browser tab opened on an older build of the inbox reloads itself once the server runs a newer one.
- A note saved, or dropped, on an item the other view just answered is refused with the reason, instead of being stored where no agent reads it.
- An agent's revise or withdraw on an item you answered in the other view is refused, even before the agent's session has read your answer.
- One item file the inbox cannot read no longer stops every session from loading the inbox. The inbox skips it and logs its name and the reason, and a value you type by hand in its front matter, such as `kind: proposal`, reads.
- The inbox needs cmod 5.6.0 or newer. A session no longer keeps a process waiting to take over the browser's server.
- The Sidebar lists every item, and each one opens with a click, as in the browser.
- In the browser, Back and Forward mark the item you leave as read, Esc leaves the Answer box and keeps what you typed, and an answer's reply never puts back an older state of the item than the one the tab already shows.
- Every item names its session by the session's current title, in both views and in every agent tool, also an item it filed before the session was renamed. A session with no title shows its agent type or project name and its short id.
- Both views show one list of items, like an email inbox, with no sections. An item you requested changes on stays in the list, marked changes requested, and the item shown first is the first one that needs you.
- No item leaves the page: the Archive under the list holds every item you answered or an agent withdrew, marked approved, rejected, answered, picked, done, or withdrawn, and a closed item opens with its answer.
- An open item that no running session follows, because its sessions closed or stopped following it, moves to the Archive, marked agent closed, and moves back to the list when its session resumes. It still opens and takes your answer, which reaches the session when it resumes. Nothing is deleted. The warning that no running session follows your answer reads which sessions run from the same listing as the Archive.
- The list reads like a mail inbox: each row shows its session, its time, its title, and its kind, and an unread row is bold with a blue dot.
- The Archive folds under one quiet line with its count, in the browser and in the Sidebar, and opens when you press it. Its rows are faded.
- An inbox with nothing left for you says **Inbox zero**, with a check, "Nothing needs you in this session.", and what arrives next.
- The scope chips, the count above the prompt, and the browser tab's title count the items in the list, not the Archive.
- Files and API drawings draw the /show-me tree: `+` and `-` mark added and removed rows, an edited file ends in `*`, and each note follows `<-`. An added row is green and a removed row red, a changed declaration shows its old line in red above its new line in green, and a `diff` example has the same colors.
- In the browser, trees and code blocks draw unbroken box lines, keep their columns, and scroll sideways instead of wrapping a line.
- In the browser list, each card keeps its kind, status, and sender on one line with the time at the right edge, a long sender ends in an ellipsis, and a title never breaks inside a hyphenated word.
- A closed item names its answer and its time once, in the line under its title.
- In the Sidebar, a note, a comment, or an answer you are writing shows whole above its field until you save it, wrapped to the page, so you can read it before you send it. A saved note you open again shows whole above its field too.
- The Sidebar stays on the item you are typing in, also in the Answer box before you press `a`, when this session's agent files another item. A toast offers the new one, and what you typed stays.
- In the Sidebar, an item's header wraps between words, and **Open in browser** stays whole, at any width.
- A new build of the inbox reaches the browser by itself: the running server stops once its program is rebuilt or updated to a new version, cmod starts the new one on the same address, and an open tab reloads onto it. The tab shows "Reconnecting to the inbox…" only when the server stays away for 5 seconds.

## [0.2.0]

### Added
- Reports: an agent files finished work with the `report` tool, one entry per change with up to 3 lines of evidence of at most 100 characters, then the Problems left open. Evidence waits in a folded Evidence section. You decide whether the goal is reached: you mark it done or request changes.
- Scope: the page shows this session's items, and chips widen it to this project, which counts every worktree of the repository, or to every project. Only the session that files an item opens the page on it.
- New and changed marks: a new item and an item revised since you read it carry a badge on the page, in the list, and in the count above the prompt. An item counts as read once you move past it, answer it, or hide the page on it with `/inbox`.
- A revised item opens only the parts that changed, shows each changed idea's old words struck through, and shows each part the revision removed, struck through, where it was.
- Notes on several parts at once: pointing at a heading, idea, drawing, Outcome, or Goal shows ✎ at its right edge, pressing it writes a note under that part, and Request changes sends every note together.
- Real diffs: API, Diff, and Data drawings draw through Claude Code's own diff view, with real line numbers, add and remove colors, and syntax colors. A report shows each changed signature as it read at the last commit, and an agent gives an edited field's old type as `was`.
- Diagrams: an agent's Mermaid draws as boxes and arrows when it files the item, and Mermaid the inbox cannot draw is refused with the reason. A diagram wider than the Sidebar draws top to bottom instead, as an outline whose lines wrap, so nothing runs off the right edge.
- Lists in an item draw their bullets as •.
- A report cannot claim to remove a file the last commit never held.
- A Files drawing starts folded to its header line.
- A sender's name shows in the color its session picked with `/color`.
- Notes and answers are typed in a four-line field.
- With dozens of sessions open, each session rereads only the items that changed.
- An item you corrected stays on the page, shows what you sent, and takes follow-up notes.
- Notes go out with Approve, Reject, a picked option, or Done too, so you approve with small changes in one press. Notes last across `/clear` and restarts, and a note written before a revision stays listed with what it named.
- An item opens in the Sidebar as soon as an agent files or revises it.
- A link to an item in a reply opens it in the Sidebar. Every tool answer gives the agent that link.
- An empty inbox shows the items closed most recently and how each was answered.
- A report keeps each file's diff from git, and pressing the file opens it on the File page. In a proposal, pressing a file opens its code.
- An agent working in another repository names it as `project`, so its paths stay relative and the item is listed under that repository.

### Changed
- A Solution is a list of ideas, each one or two sentences with its drawing right under it. Summaries and Capability lists are gone, so nothing repeats. The inbox refuses a Solution that is only prose. Screen sketches are gone, and examples take their place.
- Each item is a card: a header bar with its kind, sender, place in the queue, and title, a padded body, and a footer bar of buttons, with the other waiting items as closed cards below it. Each heading and section starts with a grey label and whether it changed, directly above its underlined title or text. Pressing a Problem's chip folds the Problem with its Solution, a folded Problem names what it hides, and smaller Problems start folded. Each drawing sits in a frame under the idea it proves. Each color means one thing: green added, red removed, yellow new or changed, blue opens something, orange the main action, and every label is the same grey.
- A fold holds for the revision you set it on, so a revision never hides a part you did not fold. A revision folds only the outermost part that did not change, so one press opens an unchanged Problem with its Solution and every drawing. A reload keeps the item you were reading and what you folded.
- The actions are Approve, Reject, Request changes, and Done for a report, as in pull request reviews, and Next →, which puts the item behind the rest and opens the next one. Comment, beside them in the footer, writes a note on the whole item. A File page shows the file's code as soon as it opens.
- Items stored by 0.1.0 convert when the inbox reads them, so open ones stay open.
- An idea may hold a list of up to 4 items. A longer list is refused, so each point gets its own idea and its own ✎.
- An item stays open until you answer it, reject it, or mark it done. An agent never clears a status, and an agent that revises an item is subscribed to it.
- The `proposals` Skill teaches agents to write each kind, with examples.
- The `meta+i` hotkey is gone, so the inbox takes no key you did not pick. `/inbox` shows the page, or hides it when it is on screen. The "Show or hide the inbox" hotkey starts unbound, and you pick its key in Settings, under inbox, Hotkeys.
- A report is final. An agent files a new report for the next round of work instead of revising the last one.
- The inbox needs cmod 5.2, and installing it asks you to grant nothing.

## [0.1.0]

### Added
- One inbox for every proposal, choice between options, and product question your agents bring you, across every running session.
- Agents fill typed fields with the `propose`, `propose_options`, and `ask_question` tools, so a proposal always holds its goal, its Problems biggest first, and each Solution's Capabilities.
- The inbox checks each declared file, signature, and line against the code, refuses what the code contradicts, and draws each file's whole public API and each changed signature's callers.
- The Inbox page in the Sidebar shows one item at a time as a tree you open only as deep as you need, marks what changed since you last read it, and answers with Approve, an option, Correct…, Answer…, Later, or Withdraw.
- Your answer goes as a prompt to every running session that subscribed, and any session can `revise`, `withdraw`, `subscribe`, `unsubscribe`, or `read` an item.
- A count above the prompt, the `/inbox` command, and the `meta+i` hotkey open the page.
