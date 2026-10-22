import { defineMod, fs } from '../node_modules/@cmodjs/core/mod.js'
import { slashCommand } from '../node_modules/@cmodjs/core/jobs/slash-command.js'
import { load } from './actions.js'
import { storeIn } from './inbox.js'
import { filePage, showFile } from './pages/file.js'
import { inboxPage } from './pages/inbox.js'
import { initialState } from './state.js'
import { inboxTools } from './tools.js'
import { waitingWidget } from './widgets/waiting.js'

export const inbox = defineMod({
  name: 'inbox',
  state: initialState,
  hotkeys: {
    toggle: { title: 'Show or hide the inbox', default: 'meta+i' },
  },

  async setup(mod) {
    await load(mod)
    fs.onChange({ path: storeIn(mod.dataFolder).changed }, () => load(mod))

    const file = mod.sidebar.add(filePage)
    const page = mod.sidebar.add(inboxPage((current, project, path) => void showFile(current, file, { project, path })))
    mod.widgets.add(waitingWidget(() => void page.open({ focus: true })))
    mod.hotkeys.toggle.onPress(() => page.toggle({ focus: true }))
    mod.use(slashCommand({ name: 'inbox', description: 'Show the inbox: the proposals, options, and questions waiting for you', immediate: true, reply: () => void page.open({ focus: true }) }))
    for (const job of inboxTools()) mod.use(job)
  },
})
