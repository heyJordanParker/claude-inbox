# Triage

## Round 1

| Source | What the code showed | Grade | Ruling |
| --- | --- | --- | --- |
| code-reviewer | `convertJsonFiles` in src/items/store.ts catches only `converted(...)`. `writeRevisions`, `itemMarkdown`, and `writePerson` run after the `try`, so one JSON item the writer refuses rejects the conversion, `loaded` in src/mod.tsx rejects, every inbox tool fails, and `inbox serve` never starts. Repeats at every start. | Blocking | Fix: a JSON file that does not convert stays and its reason is logged, as CLAUDE.md says. |
| code-reviewer | src/items/markdown.ts refuses text src/schemas.ts accepts: an idea with a `#` line or a fence, a line break in a title or evidence line, a two-word example language. 41 `throw` sites in a line-based parser. The approved format is plain Markdown with YAML front matter, but front matter lines parse with `JSON.parse`. | Blocking | Drawings are `~~~` blocks, so a backtick fence in an idea is no drawing. The cause is that the parser is not fence-aware inside ideas, not the format. Ponytail showed the format round-trips the live data byte for byte. Routed to storage-fixes with YAML scalars in front matter. |
| code-reviewer | `writeItem` runs the rulebook check (timeout 20 s) inside `inWriteTurn`, which every answer, note, read mark, and skip in that session also waits on. | Important | Fix: check before entering the write queue. |
| code-reviewer | `readFresh` drops the parser's error, so a hand-edited item vanishes with no reason logged. | Important | Fix with the parser rework: log the reason. |
| code-reviewer | `isFollowed` calls `runningSessions()` while `isArchived` reads `Sender.isRunning`: two sources of the same fact. | Important | Fix: `isFollowed` reads the senders. |
| code-reviewer | The mod and `inbox serve` both run `convertJsonFiles`; the server passes `{}` notes. | Polish | Only installs below format 6. Note it. |
| code-reviewer | An open note shows its saved words both above the field and in the field. `filed` guards only `session.editing`, which typing does not set. | Important | Fix: draw typed text only while it differs from the saved words; typing counts as editing. |
| code-reviewer | CHANGELOG says "cmod 5.3.0" and "keeps waiting for you"; CLAUDE.md says old items hold `title` and `color`. | Polish | Fix in the polish round. |
| code-reviewer | The live-data round-trip test in tests/markdown.test.ts depends on the Architect's folder and checks no JSON today. | Important | Fix: a fixture of each kind replaces reading the live folder. |
| ponytail | The conversion blocker, reproduced in a scratch run: `convertJsonFiles threw: An idea cannot hold a line that starts with "#"`, all 3 JSON files left. | Blocking | Merged with code-reviewer's. Routed to storage-fixes. |
| ponytail | `rulebook text @inbox/do-we-want-courses.md` on an item with an em dash answers `{"failures":[],"findings":[]}`. `block-em-dashes` paths are `['**', '@reply']`. | Blocking | Cause in dotfiles, owned by the rulebook session. Sent to it. The inbox side is correct. |
| ponytail | A `person/<old id>.json` merges into the item that owns the old id after the JSON item converted under a new id. | Important | Routed to storage-fixes. |
| ponytail | The rulebook check measured 26 to 28 ms. | Important | Kept: the 20 s timeout is the bound when rulebook hangs. Routed to storage-fixes. |
| ponytail | The bundle builds to 979,756 bytes; all 94 live items and 79 person files write back byte for byte. | Sound | Confirms the parser round trip. |
| storage-fixes | A JSON item converted under a moved id keeps its JSON file as the record of the move, and later `person/<id>.json` merges into the copy found by first revision time. | Accepted | The case needs an old-release session filing an item whose title matches a stored one. It loses nothing and needs no new stored file. |
| sidebar-fixes | The "no session hears this answer" warning now reads the session list reloaded every 30 s, so it can be 30 s stale. | Accepted | One source for running sessions outweighs a 30 s window right after a session closes. |
| code-reviewer | plugin.json `>=5.6.0` vs package.json `^5.7.0`. | Dropped |

## Round 2

| Source | What the code showed | Grade | Ruling |
| --- | --- | --- | --- |
| code-reviewer | Every round 1 Blocking and Important finding is fixed at its cause, each with a passing test. | Sound | |
| code-reviewer | `isArchived` reads origin and subscribers, `isFollowed` reads subscribers. After the origin unsubscribes, the list shows the item live while no session hears an answer. | Important | Fix: both read `subscribers`, the set delivery uses. |
| code-reviewer | `convertItem` names a moved copy through `newId`, which cuts a slug over 48 characters, so `isCopyOf` misses it and every start writes another copy into his list. | Blocking | Rare, but it duplicates items without end. Fix: name the copy `${id}-${n}`. |
| code-reviewer | A saved note opened again shows only inside the field, which Claude Code draws as one cut-off line, so a long saved note can't be read. | Important | Round 1's ruling was wrong: the workaround exists because the field can't show its text. The text above shows the field's whole text, typed or saved, while it is open. A short note showing twice is the lesser cost. |
| code-reviewer | `docs/agents/20261102-inbox-web-view/architecture.md` names the deleted `runningSessions`. CHANGELOG says cmod 5.3.0 and "keeps waiting"; CLAUDE.md says old items hold `title` and `color`, and only views write `person/`. | Important | Stale docs a later agent copies. Fix in the polish round. |
| code-reviewer | A JSON item that still fails to convert shows in neither view. | Polish | Matches the contract. Old-release sessions are transient. |
| ponytail | Every round 1 finding fixed at its cause; the live folder still writes back byte for byte on 5.8.0; bundle 890,521 bytes. | Sound | |

## Round 3

| Source | What the code showed | Grade | Ruling |
| --- | --- | --- | --- |
| code-reviewer | Every round 2 finding fixed at its cause. Nothing new loses or misstates what the Architect wrote. | Sound | |
| code-reviewer | An item whose session unsubscribed while still running shows "agent closed". README and CHANGELOG still say "sessions have all closed". | Polish | "Agent closed" stays true: the agent stopped following it. README and CHANGELOG now say "no running session follows, because its sessions closed or stopped following it". |
| ponytail | Every round 2 finding fixed at its cause; a moved 48-character id converts once across three starts; the live folder writes back byte for byte. architecture.md line 133 still names `cmod history sessions --running`. | Polish | Line corrected. |

Round 3 is clean: no Blocking or Important finding from either reviewer. The Review ends.

Round 2 fixes, made by the Orchestrator: `isFollowed` moved into `src/items/item.ts` and `isArchived` reads it; `copyId` names a moved copy `<id>-<n>` with no cut; `Typed` draws the typed text or the saved note; CLAUDE.md, CHANGELOG.md, and architecture.md lines corrected. `bun test` 166 pass, `cli check` passes, `cmod check` 12 passed. 5.6.0 is the runtime `page.focus` needs; 5.7.0 is the bundled library. cmod check 5.7.0 keeps the author's minimum. |
