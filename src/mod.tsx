import { defineMod, device, fs, http, messageOf, process, sessions, ToolCall, ToolGroup, ToolResult, type Mod, type View } from '../node_modules/@cmodjs/core/mod.js'
import { program } from '../node_modules/@cmodjs/core/jobs/program.js'
import { slashCommand } from '../node_modules/@cmodjs/core/jobs/slash-command.js'
import { Box } from '../node_modules/@cmodjs/core/ui/elements.js'
import { List, Paragraph } from '../node_modules/@cmodjs/core/ui/markdown.js'
import { followProgress, hearGoalChanges, learnSessions, load, loadAll, shownIn, startDelivery, storeOf, widenTo } from './actions.js'
import { isWriting, markRead, setEditing, view } from './answers.js'
import { installGates, toastWaiting } from './gates.js'
import { current as contentOf, type Item } from './items/item.js'
import { rereadMs, savedServer, serverPath, type Server } from './items/store.js'
import { LinkedBlock } from './links.js'
import { closeField } from './requirements.js'
import { fileView, showFile } from './views/file.js'
import { goalView } from './views/goal.js'
import { inboxView } from './views/inbox.js'
import { tasksView } from './views/tasks.js'
import { initialState, type InboxState } from './state.js'
import { inboxTools } from './tools.js'
import { goalWidget } from './widgets/goal.js'
import { sessionsWidget } from './widgets/sessions.js'
import { taskWidget } from './widgets/task.js'
import { waitingWidget } from './widgets/waiting.js'

const titleOf = (item: Item) => contentOf(item).title

const progressTool = 'mcp__inbox__progress'

function UnlessProgress({ tool, isExpanded, Default }: { readonly tool: string; readonly isExpanded?: boolean; readonly Default: (props: Record<never, never>) => JSX.Element }): JSX.Element {
  return tool === progressTool && isExpanded !== true ? <Box /> : <Default />
}

export const inbox = defineMod({
  name: 'inbox',
  state: initialState,
  hotkeys: {
    toggle: { title: 'Show or hide the inbox' },
    goal: { title: "Show or hide the session's goal and your requirements" },
    tasks: { title: "Show or hide the session's tasks and progress" },
  },

  setup(mod) {
    const store = storeOf(mod)
    const answering = async (server: Server | undefined): Promise<string | undefined> => {
      if (server === undefined) return undefined
      const url = `http://127.0.0.1:${server.port}`
      const answer = await http.fetch(url).catch(() => undefined)
      return answer?.ok === true ? url : undefined
    }
    const openInBrowser = async (current: Mod<InboxState>, id: string | null): Promise<void> => {
      try {
        const url = (await answering(await savedServer(store))) ?? (await answering(await web.ready().then(() => savedServer(store))))
        if (url === undefined) throw new Error(`No inbox server answered at the address in ${serverPath(store)}.`)
        const scope = new URLSearchParams({ session: sessions.current.id, project: sessions.current.project })
        const opener = (await device.read()).os === 'darwin' ? 'open' : 'xdg-open'
        const opened = await process.run([opener, `${url}${id === null ? '/' : `/items/${encodeURIComponent(id)}`}?${scope}`])
        if (opened.exitCode !== 0) throw new Error(`${opener} exited with ${opened.exitCode}: ${opened.stderr.trim()}`)
      } catch (error) {
        current.toast.error('The inbox did not open in the browser', { description: messageOf(error) })
      }
    }
    const file = mod.views.add(fileView)
    const page = mod.views.add(inboxView((current, project, path, diff) => showFile(current, file, project, path, diff), openInBrowser, (key): Promise<void> => page.focus(key)))
    const show = async (current: Mod<InboxState>, id: string, byPerson: boolean): Promise<void> => {
      widenTo(current, id)
      await Promise.all([view(current, id, byPerson && page.isShown), byPerson ? page.open({ focus: true }) : page.open()])
    }
    const open = () => page.open({ focus: true })
    const toggle = async (current: Mod<InboxState>): Promise<void> => {
      if (!page.isShown) return open()
      const left = shownIn(current)
      setEditing(current, null)
      await Promise.all([page.close(), ...(left === undefined ? [] : [markRead(current, left)])])
    }
    const filed = (current: Mod<InboxState>, id: string) => {
      const item = current.state.memory.items.find((each) => each.id === id)
      if (!isWriting(current) || item === undefined) return void show(current, id, false)
      current.toast.info(`"${titleOf(item)}" is in the inbox`, { action: { label: 'Open', onClick: () => show(current, id, true) } })
    }
    const linked = (current: Mod<InboxState>, id: string) => {
      const item = current.state.memory.items.find((each) => each.id === id)
      if (item === undefined) return current.toast.warning(`The inbox has no item ${id}`)
      return show(current, id, true)
    }
    const goal = mod.views.add(goalView((key): Promise<void> => goal.focus(key)))
    const tasks = mod.views.add(tasksView(linked, (key): Promise<void> => tasks.focus(key)))
    const openGoal = () => goal.open({ focus: true })
    const openTasks = () => tasks.open({ focus: true })
    const toggleView = async (current: Mod<InboxState>, shown: View, open: () => Promise<void>): Promise<void> => {
      if (!shown.isShown) return open()
      closeField(current)
      await shown.close()
    }

    const reload = () => load(mod).then(() => toastWaiting(mod, linked))
    const loaded = startDelivery(mod)
      .then(() => load(mod))
      .then(() => toastWaiting(mod, linked, true))
    fs.onChange({ path: store.changed }, reload)
    void followProgress(mod)
    mod.every(rereadMs, () => Promise.all([reload(), learnSessions(mod)]))
    sessions.current.onSessionStart(() => Promise.all([loadAll(mod).then(() => toastWaiting(mod, linked, true)), learnSessions(mod)]))
    void learnSessions(mod)
    installGates(mod, loaded)
    for (const job of inboxTools(loaded, filed)) mod.use(job)
    const web = mod.use(program({ command: ['inbox', 'serve', '--data', mod.dataFolder], isService: true, isWebApp: true }))
    void hearGoalChanges(mod, web)

    mod.widgets.add(waitingWidget(open))
    mod.widgets.add(goalWidget(openGoal))
    mod.widgets.add(taskWidget(openTasks))
    mod.widgets.add(sessionsWidget)
    mod.hotkeys.toggle.onPress(() => toggle(mod))
    mod.hotkeys.goal.onPress(() => toggleView(mod, goal, openGoal))
    mod.hotkeys.tasks.onPress(() => toggleView(mod, tasks, openTasks))
    mod.use(slashCommand({ name: 'inbox', description: 'Show or hide the inbox: the proposals, options, questions, and reports agents bring you', immediate: true, reply: (_, current) => toggle(current) }))
    mod.styles.add({ kind: Paragraph, render: (current, props) => <LinkedBlock props={props} items={store.items} onOpen={(id) => linked(current, id)} /> })
    mod.styles.add({ kind: List, render: (current, props) => <LinkedBlock props={props} items={store.items} onOpen={(id) => linked(current, id)} /> })
    mod.styles.add({ kind: ToolCall, render: (_, props) => <UnlessProgress {...props} /> })
    mod.styles.add({ kind: ToolResult, render: (_, props) => <UnlessProgress {...props} /> })
    mod.styles.add({ kind: ToolGroup, render: (_, { calls, Default }) => (calls.some((call) => call.tool === progressTool) ? <Default isExpanded /> : <Default />) })
  },
})
