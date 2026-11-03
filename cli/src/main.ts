#!/usr/bin/env bun
import { randomBytes } from 'node:crypto'
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import plugin from '../../.claude-plugin/plugin.json'
import { repositoryOf } from '../../src/items/item.js'
import { savedServer, serverPath, storeIn, type Server } from '../../src/items/store.js'
import { runningSessions, sessionSenders } from './cmod.js'
import { disk, run } from './disk.js'
import { serve, type Options, type Serving } from './server.js'

const usage = 'Usage: inbox serve --data <folder>\n       inbox --version'

function save(path: string, saved: Server): void {
  const partial = `${path}.${process.pid}.tmp`
  writeFileSync(partial, `${JSON.stringify(saved)}\n`, { mode: 0o600 })
  try {
    renameSync(partial, path)
  } catch (error) {
    rmSync(partial, { force: true })
    throw error
  }
}

function isPortTaken(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE'
}

const [command, flag, data, ...rest] = Bun.argv.slice(2)
if (command === '--version' && flag === undefined) {
  console.log(plugin.version)
  process.exit(0)
}
if (command !== 'serve' || flag !== '--data' || data === undefined || rest.length > 0) {
  console.error(usage)
  process.exit(2)
}
if (!statSync(data, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`inbox serve: ${data} is not a folder.\n${usage}`)
  process.exit(2)
}

async function start(folder: string): Promise<Serving> {
  const store = storeIn(folder, disk)
  const saved = await savedServer(store)
  const options: Omit<Options, 'port'> = {
    store,
    token: saved?.token ?? randomBytes(32).toString('base64url'),
    runningSessions,
    senders: sessionSenders,
    repositoryOf: (project) => repositoryOf(run, project, (line) => console.error(`inbox serve: ${line}`)),
  }
  const started = await serve({ ...options, port: saved?.port ?? 0 }).catch((error: unknown) => {
    if (saved === undefined || !isPortTaken(error)) throw error
    return serve({ ...options, port: 0 })
  })
  if (saved?.port !== started.port || saved.token !== options.token) save(serverPath(store), { port: started.port, token: options.token })
  return started
}

const serving = await start(data).catch((error: unknown) => {
  console.error(`inbox serve could not start: ${error instanceof Error ? error.message : String(error)}`)
  return process.exit(1)
})
console.log(`127.0.0.1:${serving.port}`)

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void serving.stop().then(() => process.exit(0))
  })
}
