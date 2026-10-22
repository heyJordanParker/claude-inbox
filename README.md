# Inbox

One inbox for every proposal, choice, and question your Claude Code agents bring you.

An agent's proposal in a reply gets buried under the next tool call, and by the time you read it the context is gone. The inbox keeps every open item from every running session in one Sidebar page. You answer each one from the item alone, and your answer goes back to every session that follows it.

## What the inbox holds

- **Proposals.** The Problems that block a goal, biggest first, each with the Solution the agent would ship. You approve one, or correct it.
- **Options.** One Problem and two or more Solutions the agent would each ship. You pick one.
- **Questions.** One product or Capability question. You answer it in your own words.

## Agents fill fields, and the inbox draws the code

Agents never write a proposal's format. Each tool's input is the format: a proposal cannot leave out its goal, a Problem cannot leave out what it blocks, and a Solution cannot leave out the Capabilities it changes.

An agent declares the Architecture a Solution changes: the files, the signatures, the lines, and the table columns. The inbox reads the code with [tracer](https://github.com/heyJordanParker/tracer) and then:

- refuses a file, signature, or line the code does not hold, with the reason, before you ever see it
- draws every public declaration of each changed file, changed or not
- draws every caller of a changed or removed signature
- draws the lines around a changed block

## What you see

`meta+i`, `/inbox`, or the count above the prompt opens the Inbox page:

```text
Exhaustive match needs no default
php# · options · 1 of 3 · changed since you read it

Goal: Enums ship without boilerplate defaults

Problem: A full match still demands a default
▸ Option 1: No default (Rust, C#) — The compiler proves every case is handled
▸ Option 2: Default required (Kotlin) — Every match names its fallback  · changed

Subscribed: php#, reviewer

[ Option 1 ] [ Option 2 ] [ Correct… ] [ Later ] [ Withdraw ]
```

Every Problem, Solution, and drawing opens and closes, so you read only as deep as you need. Each title and summary reads clearly on its own. `Correct this` under any opened part sends your words with the part they correct.

## What agents call

| Tool | What it does |
| --- | --- |
| `propose` | Files a proposal |
| `propose_options` | Files a choice between two or more Solutions |
| `ask_question` | Files one product or Capability question |
| `revise` | Replaces an item with a new revision, from any session |
| `withdraw` | Takes an item out of the inbox |
| `subscribe`, `unsubscribe` | Starts or stops hearing an item's changes in this session |
| `read` | Lists the open items, or reads one with every answer |

Claude sees each as `mcp__inbox__<tool>`. A project adds its own checks as ordinary `PreToolUse` hooks with the matcher `mcp__inbox__.*`. A hook that exits with code 2 refuses the call, and its stderr reaches the agent.

## Install

The inbox is a [Claude Mod Manager](https://claudemodmanager.com) mod. It needs `trace` on the machine.

```bash
cmod install heyJordanParker/claude-inbox
```

## Develop

```bash
cmod link        # load this checkout in every new Claude Code session
cmod check       # check, type-check, lint, and test the mod
```
