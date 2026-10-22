const change = { type: 'string', enum: ['add', 'remove', 'edit'] } as const

const line = (description: string) => ({ type: 'string', minLength: 1, description }) as const

const drawing = {
  oneOf: [
    {
      type: 'object',
      description: 'A file tree: the files the Solution adds, removes, or edits. The inbox reads every public declaration of each file from the code and draws them beside your changes.',
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
      description: 'A change to lines of one file. The inbox finds the old lines in the file and draws the lines around them.',
      properties: {
        kind: { const: 'diff' },
        path: line('Relative to the project.'),
        old: line('Whole lines, exactly as the file holds them now.'),
        new: { type: 'string', description: 'The lines that replace them.' },
      },
      required: ['kind', 'path', 'old', 'new'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'A database table change. List every column of the table, unchanged ones included.',
      properties: {
        kind: { const: 'table' },
        table: line('The table name.'),
        columns: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: { name: line('The column name.'), type: line('Its type and constraints.'), change, note: { type: 'string', description: 'Why it changes.' } },
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
      description: 'An Architecture diagram in Mermaid.',
      properties: { kind: { const: 'diagram' }, mermaid: line('Mermaid source.') },
      required: ['kind', 'mermaid'],
      additionalProperties: false,
    },
    {
      type: 'object',
      description: 'The change in use: the output a caller gets, or a caller written against the new API.',
      properties: { kind: { const: 'example' }, language: line('A highlighter language, such as ts or json.'), code: line('The example.') },
      required: ['kind', 'language', 'code'],
      additionalProperties: false,
    },
  ],
} as const

const headline = {
  title: line('Clear on its own, read without anything around it.'),
  summary: line('One line, shown while it is closed.'),
}

const defs = {
  drawing,
  solution: {
    type: 'object',
    properties: {
      ...headline,
      idea: line('The idea of the Solution in plain words. Markdown.'),
      precedent: { type: 'string', description: 'The established tool or language that does it this way.' },
      capabilities: { type: 'array', minItems: 1, items: line('Something the product can do for its users that this changes.'), description: 'Every Capability the Solution adds, changes, or removes.' },
      drawings: { type: 'array', items: { $ref: '#/$defs/drawing' }, description: 'The Architecture the Solution changes, declared so the inbox draws it from the code.' },
      problems: { type: 'array', items: { $ref: '#/$defs/problem' }, description: 'Smaller Problems this Solution raises, each with its own Solution.' },
    },
    required: ['title', 'summary', 'idea', 'capabilities'],
    additionalProperties: false,
  },
  problem: {
    type: 'object',
    properties: {
      ...headline,
      impact: line('What it blocks: the users or the Capability it affects.'),
      solution: { $ref: '#/$defs/solution' },
      problems: { type: 'array', items: { $ref: '#/$defs/problem' }, description: 'The smaller Problems this one causes, biggest first.' },
    },
    required: ['title', 'summary', 'impact', 'solution'],
    additionalProperties: false,
  },
  question: {
    type: 'object',
    properties: {
      title: line('One product or Capability question. Never a technical one.'),
      why: line('What the answer unlocks, and what waits without it.'),
    },
    required: ['title', 'why'],
    additionalProperties: false,
  },
} as const

export const proposalSchema = {
  type: 'object',
  properties: {
    title: line('The proposal in one line, clear on its own.'),
    goal: line('The outcome the proposal serves.'),
    problems: { type: 'array', minItems: 1, items: { $ref: '#/$defs/problem' }, description: 'The Problems that block the goal, biggest first.' },
  },
  required: ['title', 'goal', 'problems'],
  additionalProperties: false,
} as const

export const optionsSchema = {
  type: 'object',
  properties: {
    title: line('The choice in one line, clear on its own.'),
    goal: line('The outcome the choice serves.'),
    problem: {
      type: 'object',
      properties: { ...headline, impact: line('What it blocks: the users or the Capability it affects.') },
      required: ['title', 'summary', 'impact'],
      additionalProperties: false,
    },
    options: { type: 'array', minItems: 2, items: { $ref: '#/$defs/solution' }, description: 'Each a specific, good Solution you would ship. Never one you do not believe in.' },
  },
  required: ['title', 'goal', 'problem', 'options'],
  additionalProperties: false,
} as const

const id = line('The id the inbox gave when it was filed.')

export const schemas = {
  propose: { ...proposalSchema, $defs: defs },
  propose_options: { ...optionsSchema, $defs: defs },
  ask_question: { ...defs.question },
  revise: {
    type: 'object',
    $defs: defs,
    properties: {
      id,
      proposal: proposalSchema,
      options: optionsSchema,
      question: defs.question,
    },
    required: ['id'],
    additionalProperties: false,
  },
  withdraw: { type: 'object', properties: { id, reason: line('Why it no longer needs an answer.') }, required: ['id', 'reason'], additionalProperties: false },
  subscribe: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false },
  unsubscribe: { type: 'object', properties: { id }, required: ['id'], additionalProperties: false },
  read: { type: 'object', properties: { id: { type: 'string', description: 'One item. Leave it out to list every open item.' } }, additionalProperties: false },
} as const
