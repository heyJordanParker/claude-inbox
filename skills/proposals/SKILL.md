---
name: proposals
description: Writes an inbox item the user can review fast and answer without asking anything back. Use before calling propose, propose_options, ask_question, report, or revise.
---

# Write an inbox item

The user reviews many agents' work and reads each item hours later, with none of your context. Every minute the item costs them is a minute they do not spend deciding. So the item shows the change instead of describing it: each idea is one or two short sentences, and the drawing that proves it sits directly under it. The user reads down the page once, sees each claim next to its evidence, and answers.

## 1. Pick the kind by what the user does with it

- `propose`: you know the Solution you would ship. The user approves it, rejects it, or requests changes.
- `propose_options`: two or more Solutions you would each ship, and only the user's product judgment separates them. The user picks one or rejects every option. Never add an option you do not believe in.
- `ask_question`: a product or Capability question only the user can answer. The user answers it or rejects it. Answer every technical question yourself.
- `report`: the work is done. The user marks it done or requests changes.

## 2. Put the answer in the titles

The user scans the headings first, such as "Problem 1: A buyer can't retry a failed payment", and opens only what they doubt. So each title names its point in one plain sentence, the way you would say it to a colleague, and the first idea under it is the big idea.

A Problem is told from the user's side. Its title names the Capability users lack, or the Architecture that costs them over time, and its first idea says whom it stops and what that costs them. A Solution title names the Capability or the Architecture that changes, and its first idea says what the user can do after it.

Example:
  Problem: "A buyer can't retry a failed payment"
  Solution: "A failed payment stays open for a retry"
Never: "Payment issues", "Improvements to OrderService", "Solution: refactor", or a compressed chain such as "An item read as one pile, so you read every line to find its structure".

The goal is the outcome the user wants, in one short sentence, and nothing about how it is reached. Every item about the same work shares it.

Example: "You spend less time reviewing agents' work"
Never: "You spend less time reviewing: an item scans by its headings, and each claim sits next to a drawing".

Put the Problem whose Solution removes the most other Problems first. Nest each smaller Problem under the Solution that raises it.

## 3. Write one idea, then draw it

Each entry in `ideas` holds one idea and the drawing that shows it. The drawing goes under the idea it proves, never collected at the end.

Example: two ideas, each with its drawing.
  ```json
  [
    { "idea": "Only a team's owner can delete the team now. Admins could before.",
      "drawing": { "kind": "api", "path": "app/Teams/TeamService.php",
        "changes": [{ "name": "delete", "change": "edit", "signature": "#[Authorize(Role::Owner)] delete(Team $team): void", "note": "gains the owner check" }] } },
    { "idea": "A team's members go with it, so nothing else removes them.",
      "drawing": { "kind": "table", "table": "team_members",
        "columns": [{ "name": "team_id", "type": "bigint", "change": "edit", "note": "cascades on delete" }, { "name": "user_id", "type": "bigint" }] } }
  ]
  ```
Never: five ideas of prose followed by five drawings.

An idea holds at most 320 characters. A longer idea is two ideas.

## 4. Draw what the user reviews

The user reviews the Architecture and the Capabilities, and does not read code. A drawing proves the idea right above it, so draw only what that idea claims. Every Solution draws at least one thing.
Never: a file list under an idea about what the user sees, or a whole diff to show that one press went away.

Pick the drawing by what the idea claims:
- `files`: which files the change adds, edits, or removes. In a report, the inbox keeps each file's diff from git, and the user opens it from the file.
- `api`: a public signature that changes. The inbox draws the file's other declarations around it.
- `table`: stored data, a database table or a record the code stores. List every column or field, and give an edited one its old type as `was`, so the user sees both.
- `diff`: the few lines of one file that carry the behavior under review. The inbox finds the lines the file holds now, the old lines in a proposal and the new lines in a report, and draws the lines around them.
- `example`: the change in use, such as the JSON an endpoint returns, a caller's code, a command and what it prints, or Markdown as it reads.
- `diagram`: how parts connect or how state moves, in Mermaid. The inbox draws it as boxes and arrows, and refuses Mermaid it cannot draw.

Every path is relative to the repository the item is about. When that is not the folder your session started in, give the repository as `project`.

A drawing the code contradicts is refused with the reason. Fix the declaration and call again.

## 5. Never index, summarize, or repeat

Each idea says something the others do not.
Never: an opening idea that lists what follows, a list of Capabilities that repeats the ideas above it, a closing summary, or an idea that only names its drawing, such as "The change in use."

## 6. Keep a list short and for equals

A list holds up to 4 items of one kind and one importance, under a sentence that says what they are. The inbox refuses a longer one. Points that each need a reason get an idea each, so the user can note one of them. Steps that happen in order are a numbered list or a `diagram`, never bullets.

Example: a short list of equals.
  ```json
  { "idea": "A task waits on one of two things:\n- you, with a link to the inbox item\n- another task, named by its title" }
  ```
Never: six bullets of "You see…", or a process written as bullets.

## 7. Fill each kind

A proposal holds the goal and the Problems that block it, each with its Solution.

Example:
  ```json
  { "title": "Only a team's owner can delete it",
    "goal": "No admin deletes a team by mistake",
    "problems": [{ "title": "Any admin can delete a team",
      "ideas": [{ "idea": "Two teams were deleted by admins last month, and their members lost access." }],
      "solution": { "title": "Deleting a team needs its owner",
        "ideas": [{ "idea": "Only the owner's delete goes through. An admin's is refused.",
          "drawing": { "kind": "api", "path": "app/Teams/TeamService.php",
            "changes": [{ "name": "delete", "change": "edit", "signature": "#[Authorize(Role::Owner)] delete(Team $team): void", "note": "gains the owner check" }] } }] } }] }
  ```

A choice holds one Problem and two or more options. Each option is a whole Solution with its own drawings, so the user compares the same drawing across options. Say which you would ship in the first idea of that option.

A question holds the product question and why it matters: what the answer unlocks, and what waits without it.

A report lists `changes`: each thing that changed for the user, one entry each. The user decides whether the goal is reached. A change is one plain sentence, an optional drawing that shows it, and `evidence`: what you ran and whether it showed the change, at most 100 characters a line. Draw what the user will see or use: an `example` of the screen text or the command output, copied from the live run, a `diagram` of a new flow, or an `api` or `table` drawing for a changed API or stored data. Never draw a file list to show that work happened. Never invent a Problem and a Solution to hold a change, and never put two changes in one entry. `open` holds the Problems left open, each with the Solution you would ship next.

Example: one change.
  ```json
  { "title": "The page now opens on an item the moment this session files it",
    "evidence": ["Reproduced live: a filed proposal opened the Inbox page"] }
  ```
Never: evidence that retells the test, such as "The test \"a filed item opens on the page\" passes: after the call, the page shows the item and its link."

## 8. Revise a proposal, file a new report

After a correction to a proposal, choice, or question, call `revise` with the same id and the whole item again. The inbox marks every idea that changed since the user read it, shows what it said before, and folds what did not change.

A report is final, and `revise` refuses one. When the user requests changes to a report, fix them, then file a new report that holds only that round's changes.

## 9. An answer is not a rule

An answer is the user's call about that revision, with what it said in front of them. When a later Problem shows an earlier answer may be wrong, put a new item in the inbox on its merits.
