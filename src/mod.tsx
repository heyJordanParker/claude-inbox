import { defineMod, device, fs, http, messageOf, process, sessions, type Mod } from '../node_modules/@cmodjs/core/mod.js'
import { program } from '../node_modules/@cmodjs/core/jobs/program.js'
import { slashCommand } from '../node_modules/@cmodjs/core/jobs/slash-command.js'
import { List, Paragraph } from '../node_modules/@cmodjs/core/ui/markdown.js'
import { deliveriesIn, learnSenders, load, loadAll, personIn, scoped, startDelivery, storeOf, widenTo } from './actions.js'
import { isWriting, markRead, setEditing, view } from './answers.js'
import { current as contentOf, shownOf, statusOf, type Item } from './items/item.js'
import { rereadMs, savedServer, serverPath, type Server } from './items/store.js'
import { LinkedBlock } from './links.js'
import { filePage, showFile } from './pages/file.js'
import { inboxPage } from './pages/inbox.js'
import { initialState, type InboxState } from './state.js'
import { inboxTools } from './tools.js'
import { waitingWidget } from './widgets/waiting.js'

const titleOf = (item: Item) => contentOf(item).title

type Minted = { readonly url: string; readonly code: string }

export const inbox = defineMod({
  name: 'inbox',
  state: initialState,
  hotkeys: {
    toggle: { title: 'Show or hide the inbox' },
  },

  setup(mod) {
    const store = storeOf(mod)
    const mintedBy = async (server: Server | undefined): Promise<Minted | undefined> => {
      if (server === undefined) return undefined
      const url = `http://127.0.0.1:${server.port}`
      const answer = await http.fetch(`${url}/api/codes`, { method: 'POST', headers: { authorization: `Bearer ${server.token}` } }).catch(() => undefined)
      return answer?.ok === true ? { url, code: (JSON.parse(answer.text) as { readonly code: string }).code } : undefined
    }
    const openInBrowser = async (current: Mod<InboxState>, id: string): Promise<void> => {
      try {
        const minted = (await mintedBy(await savedServer(store))) ?? (await mintedBy(await web.ready().then(() => savedServer(store))))
        if (minted === undefined) throw new Error(`No inbox server answered at the address in ${serverPath(store)}.`)
        const scope = new URLSearchParams({ session: sessions.current.id, project: sessions.current.project })
        const opener = (await device.read()).os === 'darwin' ? 'open' : 'xdg-open'
        const opened = await process.run([opener, `${minted.url}/items/${encodeURIComponent(id)}?${scope}#code=${minted.code}`])
        if (opened.exitCode !== 0) throw new Error(`${opener} exited with ${opened.exitCode}: ${opened.stderr.trim()}`)
      } catch (error) {
        current.toast.error('The item did not open in the browser', { description: messageOf(error) })
      }
    }
    const file = mod.sidebar.add(filePage)
    const page = mod.sidebar.add(inboxPage((current, project, path, diff) => showFile(current, file, project, path, diff), openInBrowser, (key): Promise<void> => page.focus(key)))
    const show = async (current: Mod<InboxState>, id: string, byPerson: boolean): Promise<void> => {
      widenTo(current, id)
      await Promise.all([view(current, id, byPerson && page.isShown), byPerson ? page.open({ focus: true }) : page.open()])
    }
    const open = () => page.open({ focus: true })
    const toggle = async (current: Mod<InboxState>): Promise<void> => {
      if (!page.isShown) return open()
      const left = shownOf(scoped(current), current.state.memory.person, current.state.memory.senders, deliveriesIn(current), current.state.session.viewing)
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

    const loaded = startDelivery(mod).then(() => load(mod))
    fs.onChange({ path: store.changed }, () => load(mod))
    mod.every(rereadMs, () => Promise.all([load(mod), learnSenders(mod)]))
    sessions.current.onSessionStart(() => loadAll(mod))
    for (const job of inboxTools(loaded, filed)) mod.use(job)
    const web = mod.use(program({ command: ['inbox', 'serve', '--data', mod.dataFolder], isService: true }))

    mod.widgets.add(waitingWidget(open))
    mod.hotkeys.toggle.onPress(() => toggle(mod))
    mod.use(slashCommand({ name: 'inbox', description: 'Show or hide the inbox: the proposals, options, questions, and reports agents bring you', immediate: true, reply: (_, current) => toggle(current) }))
    mod.styles.add({ kind: Paragraph, render: (current, props) => <LinkedBlock props={props} items={store.items} onOpen={(id) => linked(current, id)} /> })
    mod.styles.add({ kind: List, render: (current, props) => <LinkedBlock props={props} items={store.items} onOpen={(id) => linked(current, id)} /> })
  },
})
