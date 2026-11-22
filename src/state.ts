import type { Goals, Unfiled } from './goals/goal.js'
import type { Progress } from './goals/progress.js'
import type { Heard } from './items/heard.js'
import type { Item, Kind, PersonFiles, Scope, Senders } from './items/item.js'

export type FileView = { readonly status: 'read'; readonly text: string; readonly isDiff: boolean } | { readonly status: 'failed'; readonly error: string }

export type ShownFile = { readonly project: string; readonly path: string; readonly view: FileView }

export type InboxState = {
  memory: {
    items: readonly Item[]
    person: PersonFiles
    repositories: Readonly<Record<string, string>>
    senders: Senders
    progress: Progress | null
    goals: Readonly<Record<string, Goals>>
    goalTexts: Readonly<Record<string, string>>
  }
  session: {
    scope: Scope
    kind: Kind | null
    viewing: string | null
    selected: readonly string[]
    folds: Readonly<Record<string, boolean>>
    editing: string | null
    typed: Readonly<Record<string, string>>
    isArchiveOpen: boolean
    file: ShownFile | null
    heard: Heard
    unfiled: readonly Unfiled[]
    takenFrom: readonly string[]
    goalsSession: string | null
    unfolded: readonly string[]
    openField: string | null
  }
}

export const initialState: InboxState = {
  memory: { items: [], person: {}, repositories: {}, senders: {}, progress: null, goals: {}, goalTexts: {} },
  session: { scope: 'session', kind: null, viewing: null, selected: [], folds: {}, editing: null, typed: {}, isArchiveOpen: false, file: null, heard: {}, unfiled: [], takenFrom: [], goalsSession: null, unfolded: [], openField: null },
}
