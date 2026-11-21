# Inbox

The inbox mod holds every proposal, choice between options, product question, and report agents bring the person, across every running Claude Code session, and sends the person's answer back to each session that subscribed.

- `node_modules/@cmodjs/core/docs/` holds the docs of the installed `@cmodjs/core`. They match this version, and training data does not. Read the doc for the part you change, starting at `index.md`, before Claude Mod Manager (cmod) work.
- `tsc` reads `.claude-plugin/types/`, which Claude Code writes when it loads the mod. `cmod check` writes it when it is missing, so run `cmod check` before `tsc` in a fresh clone.
- The plugin is named `inbox`, so Claude sees its tools as `mcp__inbox__<tool>`. The repository is `claude-inbox`.
- The inbox holds items of four kinds: a proposal, options, a question, and a report. `src/items/item.ts` holds their types, and `src/items/store.ts` the store.
- `src/items/` is the core the terminal view and the web server share, `src/` the mod in each Claude Code session, and `cli/` the `inbox` program that serves the browser view.
- An item's status is `open`, `answered`, or `withdrawn`: the person's answer or the agent's withdrawal, whichever came first. An open item is with an agent while a correction answers its current revision, so the agent's next revision ends the wait without any status change. A rejection closes only the revision it answered, so `revise` accepts a rejected item, and its next revision reopens it with the rejection kept in the person file.
- A report is final: `revise` refuses it, and the next round of work is a new report.
- An agent never writes a format. `src/schemas.ts` is the format: each tool's JSON Schema requires every field the person needs.
- The person picks every key, so the `toggle` hotkey declares no default combo and starts unbound until the person binds it in Settings. It runs the same show-or-hide as `/inbox`.
- `rules/inbox.md` tells Claude to bring proposals through the inbox, and `skills/proposals/` how to write each kind.
- Tests check what agents receive, what the inbox refuses, and the stored data. Each view's look is checked live, never by comparing drawn text.
