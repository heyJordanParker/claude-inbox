---
name: proposals
description: Builds an inbox item the user can act on without asking anything back. Use before calling propose, propose_options, ask_question, or revise.
---

# Build an inbox item

The user reads each item hours later, with none of your context, and answers it from the item alone. Their test is whether they can answer without asking you to clarify.

## Pick the kind by what the user can do

- `propose`: you know the Solution you would ship. The user approves it or corrects it.
- `propose_options`: two or more Solutions you would each ship, and only the user's product judgment separates them. Never pad a choice with an option you do not believe in.
- `ask_question`: a product or Capability question only the user can answer. Answer every technical question yourself.

## Order the Problems

Put the Problem whose Solution removes the most other Problems first. Nest each smaller Problem under the Problem that causes it. Every title and summary must read clearly on its own, because the user opens only what they need.

## Declare the Architecture and let the inbox draw it

Declare every file, signature, line, and column the Solution changes as a drawing. The inbox reads the rest from the code. A drawing the code contradicts is refused with the reason, so fix the declaration and call again.

## Revise, never re-file

After a correction, call `revise` with the same id and the whole item again. The inbox marks what changed since the user last read it.

## An answer is not a rule

An answer is the user's call about that revision, with what it said in front of them. When a later Problem shows an earlier answer may be wrong, put a new item in the inbox on its merits.
