declare module 'claude-code' {
  interface CmodInterfaces {
    'inbox/Goals': {
      methods: {
        goals(session: string): {
          goals?: {
            readonly format: 1
            readonly session: string
            readonly project: string
            readonly requirements: readonly {
              readonly id: string
              readonly capability: string
              readonly line: string
              readonly quotes: readonly { readonly words: string; readonly source: 'prompt' | 'answer' | 'view'; readonly id: string; readonly at: string }[]
            }[]
            readonly filings: readonly (
              | { readonly id: string; readonly source: 'prompt' | 'answer' | 'view'; readonly requirements: readonly string[] }
              | { readonly id: string; readonly source: 'prompt' | 'answer' | 'view'; readonly reason: string }
            )[]
            readonly tasks: readonly ({
              readonly id: string
              readonly title: string
              readonly serves: readonly string[]
              readonly after?: string
              readonly waitsOn?: string
              readonly cmodTask?: string
              readonly corrections: readonly { readonly words: string; readonly source: 'prompt' | 'answer' | 'view'; readonly id: string; readonly at: string }[]
            } & ({ readonly template?: string; readonly isRequired: false } | { readonly template: string; readonly isRequired: true }) &
              (
                | { readonly state: 'planned' }
                | { readonly state: 'active'; readonly owner: string; readonly startedAt: string }
                | { readonly state: 'done'; readonly owner: string; readonly startedAt: string; readonly evidence: readonly string[]; readonly endedAt: string }
                | { readonly state: 'dropped'; readonly owner?: string; readonly startedAt?: string; readonly reason: string; readonly endedAt: string }
              ))[]
            readonly updatedAt: string
          }
          progress?: {
            readonly session: string
            readonly blocks: readonly (
              | { readonly kind: 'bar'; readonly label: string; readonly done: number; readonly total: number }
              | { readonly kind: 'checklist'; readonly label: string; readonly items: readonly { readonly text: string; readonly done: boolean }[] }
              | { readonly kind: 'note'; readonly text: string }
              | { readonly kind: 'table'; readonly label?: string; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
              | { readonly preset: 'steps'; readonly label?: string; readonly steps: readonly string[]; readonly current: number }
              | { readonly preset: 'tasks'; readonly label?: string; readonly tasks: readonly { readonly text: string; readonly state: 'planned' | 'active' | 'done' }[] }
            )[]
            readonly at: string
          }
        }
        sessions(): string[]
      }
      events: {
        Change: { readonly session: string; readonly part: 'goals' | 'progress' | 'goal' }
      }
    }
  }
}
