import type { Declaration, Item } from './inbox.js'

export type FileView = { readonly status: 'loading' } | { readonly status: 'ready'; readonly declarations: readonly Declaration[] } | { readonly status: 'failed'; readonly error: string }

export type InboxState = {
  memory: {
    items: readonly Item[]
    viewing: string | null
    opened: readonly string[]
    correcting: string | null
    files: Readonly<Record<string, FileView>>
  }
}

export const initialState: InboxState = {
  memory: { items: [], viewing: null, opened: [], correcting: null, files: {} },
}
