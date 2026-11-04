const change = { type: 'string', enum: ['add', 'remove', 'edit'] } as const

const line = (description: string) => ({ type: 'string', pattern: '\\S', description }) as const

const heading = (description: string) => line(`${description} It cannot hold a line break, or a space followed by {", which starts a heading's attributes in the stored Markdown.`)

const drawing = {
  oneOf: [
    {
      type: 'object',
      description: "A file tree: the files the Solution adds, removes, or edits. In a report, the inbox keeps each file's diff from git, and the user opens it from the file.",
      properties: {
        kind: { const: 'files' },
        files: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { path: line('Relative to the project.'), change, note: line('Why the file changes, under nine words.') },
            required: ['path', 'change', 'note'],
            additionalProperties: false,
          },
        },
      },
      required: ['kind', 'files'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: "A public API change in one file. The inbox draws the file's other public declarations and every caller a changed or removed one has, from the code.",
      properties: {
        kind: { const: 'api' },
        path: line('Relative to the project.'),
        changes: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: line('The declaration as the code names it.'),
              change,
              signature: line('The whole new signature. Required unless the declaration is removed.'),
              note: line('What the change does, under nine words.'),
            },
            required: ['name', 'change', 'note'],
            additionalProperties: false,
          },
        },
      },
      required: ['kind', 'path', 'changes'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A change to lines of one file. The inbox finds the lines the file holds now and draws the lines around them: the old lines in a proposal, the new lines in a report.',
      properties: {
        kind: { const: 'diff' },
        path: line('Relative to the project.'),
        old: line('Whole lines, exactly as the file held them before the change.'),
        new: { type: 'string', description: 'The whole lines that replace them, exactly as the file holds them after the change.' },
      },
      required: ['kind', 'path', 'old', 'new'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'Stored data: a database table, or a record the code stores, such as a JSON file. List every column or field, unchanged ones included.',
      properties: {
        kind: { const: 'table' },
        table: line('The table, or the record and where it is stored.'),
        columns: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              name: line('The column or field name.'),
              type: line('Its type and constraints.'),
              change,
              was: line('Its type and constraints before the change. Required when the column is edited.'),
              note: { type: 'string', description: 'Why it changes.' },
            },
            required: ['name', 'type'],
            additionalProperties: false,
          },
        },
      },
      required: ['kind', 'table', 'columns'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'How parts connect or how state moves, in Mermaid. The inbox draws it as boxes and arrows: a flowchart, sequence, state, class, or ER diagram.',
      properties: { kind: { const: 'diagram' }, mermaid: line('Mermaid source, such as graph TD or stateDiagram-v2.') },
      required: ['kind', 'mermaid'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'The change in use: the output a caller gets, a caller written against the new API, a command and what it prints, or Markdown as it reads.',
      properties: { kind: { const: 'example' }, language: line('A highlighter language, such as ts, json, sh, md, or text: one word that does not start with ~ or {.'), code: line('The example.') },
      required: ['kind', 'language', 'code'],
      additionalProperties: false,
    },
  ],
} as const

const longestIdea = 320

const longestGoal = 100

const longestEvidence = 100

const ideas = (description: string) => ({ type: 'array', minItems: 1, items: { $ref: '#/$defs/idea' }, description }) as const

const goal = (description: string) => ({ type: 'string', pattern: '\\S', maxLength: longestGoal, description: `${description} One plain sentence on one line, of at most ${longestGoal} characters, such as "You spend less time reviewing agents' work". Never how it is reached.` }) as const

const problemTitle = heading('The Problem in one plain sentence, as you would say it to a colleague, such as "A buyer can\'t retry a failed payment". Never a chain such as "X, so you Y".')

const problemIdeas = ideas('The Problem from the user’s side, one idea at a time. The first idea is the big idea: whom it stops and what it costs them, through a Capability or the Architecture. Then what breaks today, with the code or output that shows it.')

const defs = {
  drawing,
  idea: {
    type: 'object',
    properties: {
      idea: { type: 'string', pattern: '\\S', maxLength: longestIdea, description: `One idea in short, plain sentences, at most ${longestIdea} characters. Markdown. It says what the drawing under it means. A list holds at most 4 items of one kind, and steps in order are numbered or a diagram. It cannot start or end with a line break, and no line starts with ~~~. Fence code with \`\`\` and close each block. Outside a code block, no line starts with # and a space, and no two blank lines come in a row.` },
      drawing: { $ref: '#/$defs/drawing' },
    },
    required: ['idea'],
    additionalProperties: false,
  },
  change: {
    type: 'object',
    properties: {
      title: heading('What changed for the user, in one plain sentence, such as "A failed payment now stays open for a retry".'),
      drawing: { $ref: '#/$defs/drawing' },
      evidence: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: { type: 'string', pattern: '\\S', maxLength: longestEvidence, description: `What you ran and whether it showed the change, on one line of at most ${longestEvidence} characters, such as "Reproduced live: one press opens the Solution".` },
        description: 'How you know it works.',
      },
    },
    required: ['title', 'evidence'],
    additionalProperties: false,
  },
  solution: {
    type: 'object',
    properties: {
      title: heading('The Solution in one plain sentence, such as "A failed payment stays open for a retry".'),
      precedent: { type: 'string', description: 'The established tool or language that does it this way.' },
      ideas: ideas('The Solution, one idea at a time, each with the drawing that shows it. The first idea is the big idea: what the user can do after it. Never an idea that lists or repeats the others.'),
      problems: { type: 'array', items: { $ref: '#/$defs/problem' }, description: 'Smaller Problems this Solution raises, each with its own Solution.' },
    },
    required: ['title', 'ideas'],
    additionalProperties: false,
  },
  problem: {
    type: 'object',
    properties: {
      title: problemTitle,
      ideas: problemIdeas,
      solution: { $ref: '#/$defs/solution' },
      problems: { type: 'array', items: { $ref: '#/$defs/problem' }, description: 'The smaller Problems this one causes, biggest first.' },
    },
    required: ['title', 'ideas', 'solution'],
    additionalProperties: false,
  },
  question: {
    type: 'object',
    properties: {
      title: heading('One product or Capability question. Never a technical one.'),
      why: line('What the answer unlocks, and what waits without it.'),
    },
    required: ['title', 'why'],
    additionalProperties: false,
  },
} as const

export const proposalSchema = {
  type: 'object',
  properties: {
    title: heading('The proposal in one line, clear on its own.'),
    goal: goal('The outcome the user wants.'),
    problems: { type: 'array', minItems: 1, items: { $ref: '#/$defs/problem' }, description: 'The Problems that block the goal, biggest first.' },
  },
  required: ['title', 'goal', 'problems'],
  additionalProperties: false,
} as const

export const optionsSchema = {
  type: 'object',
  properties: {
    title: heading('The choice in one line, clear on its own.'),
    goal: goal('The outcome the user wants.'),
    problem: {
      type: 'object',
      properties: { title: problemTitle, ideas: problemIdeas },
      required: ['title', 'ideas'],
      additionalProperties: false,
    },
    options: { type: 'array', minItems: 2, items: { $ref: '#/$defs/solution' }, description: 'Each a specific, good Solution you would ship. Never one you do not believe in.' },
  },
  required: ['title', 'goal', 'problem', 'options'],
  additionalProperties: false,
} as const

export const reportSchema = {
  type: 'object',
  properties: {
    title: heading('What was done, in one line, clear on its own.'),
    goal: goal('The outcome the user wanted.'),
    changes: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/change' },
      description: 'Each thing that changed for the user, one entry each, the one that matters most first. Never several changes in one entry.',
    },
    open: { type: 'array', items: { $ref: '#/$defs/problem' }, description: 'Problems the work found and left open, each with the Solution you would ship next.' },
  },
  required: ['title', 'goal', 'changes'],
  additionalProperties: false,
} as const

const id = line('The id the inbox gave when it was filed.')

const project = {
  type: 'string',
  pattern: '^/',
  description: 'The repository the item is about, as an absolute path, when it is not the folder this session started in. Every path in a drawing is relative to it.',
} as const

const filed = <Schema extends { readonly properties: object }>(schema: Schema) => ({ ...schema, properties: { project, ...schema.properties }, $defs: defs })

export const schemas = {
  propose: filed(proposalSchema),
  propose_options: filed(optionsSchema),
  ask_question: filed(defs.question),
  report: filed(reportSchema),
  revise: {
    type: 'object',
    $defs: defs,
    properties: {
      id,
      proposal: proposalSchema,
      options: optionsSchema,
      question: defs.question,
      report: reportSchema,
    },
    required: ['id'],
    additionalProperties: false,
  },
  withdraw: { type: 'object', properties: { id, reason: line('Why it no longer needs an answer.') }, required: ['id', 'reason'], additionalProperties: false },
  subscribe: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false },
  unsubscribe: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false },
  read: { type: 'object', properties: { id: { type: 'string', description: 'One item. Leave it out to list every open item.' } }, additionalProperties: false },
} as const
