import { defineConfig } from '@cmodjs/rulebook'

const dataHome = process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`

export default defineConfig({
  messages: {
    inbox: {
      tools: ['mcp__inbox__*'],
      folder: `${dataHome}/cmod/data/inbox/items`,
    },
  },
})
