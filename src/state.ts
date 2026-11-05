import type { Heard } from './items/heard.js'
import type { Item, PersonFiles, Scope, Senders } from './items/item.js'

export type FileView = { readonly status: 'read'; readonly text: string; readonly isDiff: boolean } | { readonly status: 'failed'; readonly error: string }

export type ShownFile = { readonly project: string; readonly path: string; readonly view: FileView }

export type InboxState = {
  memory: {
    items: readonly Item[]
    person: PersonFiles
    repositories: Readonly<Record<string, string>>
    senders: Senders
  }
  session: {
    scope: Scope
    viewing: string | null
    folds: Readonly<Record<string, boolean>>
    editing: string | null
    typed: Readonly<Record<string, string>>
    isArchiveOpen: boolean
    file: ShownFile | null
    heard: Heard
  }
}

export const initialState: InboxState = {
  memory: { items: [], person: {}, repositories: {}, senders: {} },
  session: { scope: 'session', viewing: null, folds: {}, editing: null, typed: {}, isArchiveOpen: false, file: null, heard: {} },
}
