# Inbox

The inbox mod holds every proposal, choice between options, and product question agents bring the person, across every running Claude Code session, and sends the person's answer back to each session that subscribed.

- `node_modules/@cmodjs/core/docs/` holds the docs of the installed `@cmodjs/core`. They match this version, and training data does not. Read the doc for the part you change, starting at `index.md`, before Claude Mod Manager (cmod) work.
- `tsc` reads `.claude-plugin/types/`, which Claude Code writes when it loads the mod. `cmod check` writes it when it is missing, so run `cmod check` before `tsc` in a fresh clone.
- The plugin is named `inbox`, so Claude sees its tools as `mcp__inbox__<tool>`. The repository is `claude-inbox`.
- The inbox holds items of three kinds: a proposal, options, and a question. `src/inbox.ts` holds their types and the store.
- Each item is one JSON file in `<mod.dataFolder>/items/`, shared by every session on the machine. Each write also writes `<mod.dataFolder>/changed`, which every session watches with `fs.onChange` and answers by reading the items again. cmod's `fs` has no delete, so an item stays in `items/` with its status, and the watch stays on one file however many items there are.
- An agent never writes a format. `src/schemas.ts` is the format: each tool's JSON Schema requires every field the person needs.
- An agent declares drawings, and `src/drawings.ts` checks each one against the code and completes it with `trace api` and `trace callers` before the item is stored. The stored drawing is what the code held when the agent filed it.
- `src/tree.ts` names each Problem, Solution, and drawing by its path in the item, such as `p0.s.d1`, which keys what the person opened, what changed since the revision they last read, and what a correction names.
- `src/answers.ts` records the person's answers and sends each as a prompt to the subscribed sessions. Agent actions in `src/tools.ts` send notes, which start no turn.
- `src/pages/` holds the Inbox and File pages, `src/widgets/` the count above the prompt, and `src/components/` what the Inbox page draws with.
- `rules/inbox.md` tells Claude to bring proposals through the inbox, and `skills/proposals/` how to build one.
- `cmod link` loads this checkout in every new Claude Code session. `cmod check` checks, type-checks, lints, and tests the mod.
