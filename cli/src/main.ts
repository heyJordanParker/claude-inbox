#!/usr/bin/env bun
import { renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import plugin from '../../.claude-plugin/plugin.json'
import { setProgress } from '../../src/goals/progress.js'
import { Invalid } from '../../src/goals/store.js'
import { repositoryOf } from '../../src/items/item.js'
import { reasonOf, savedServer, serverPath, storeIn, type Server } from '../../src/items/store.js'
import { cmodStore, provideGoals, sessionSenders } from './cmod.js'
import { disk, run } from './disk.js'
import { serve, type Options, type Serving } from './server.js'

const usage = 'Usage: inbox serve --data <folder>\n       inbox progress [--data <folder>] [--session <id>] [<blocks JSON>]\n       inbox --version'

function refuse(command: string, reason: string): never {
  console.error(`inbox ${command}: ${reason}\n${usage}`)
  return process.exit(2)
}

function orRefused<Value>(command: string, read: () => Value): Value {
  try {
    return read()
  } catch (error) {
    return refuse(command, reasonOf(error))
  }
}

async function setProgressFrom(given: readonly string[]): Promise<void> {
  const { values, positionals } = orRefused('progress', () => parseArgs({ args: [...given], options: { data: { type: 'string' }, session: { type: 'string' } }, allowPositionals: true }))
  if (positionals.length > 1) refuse('progress', 'it takes the blocks as one argument, so quote the JSON.')
  const named = values.session ?? process.env['CLAUDE_CODE_SESSION_ID']
  if (named === undefined) refuse('progress', 'give --session, because CLAUDE_CODE_SESSION_ID is not set.')
  const folder = values.data ?? `${cmodStore}/data/inbox`
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) refuse('progress', `${folder} is not a folder.`)
  if (positionals[0] === undefined && process.stdin.isTTY) refuse('progress', 'give the blocks as an argument or on stdin.')
  const text = positionals[0] ?? (await Bun.stdin.text())
  const blocks: unknown = orRefused('progress', () => JSON.parse(text))
  await setProgress(storeIn(folder, disk), rename, named, blocks).catch((error: unknown) => {
    if (error instanceof Invalid) refuse('progress', error.message)
    throw error
  })
}

function save(path: string, saved: Server): void {
  const partial = `${path}.${process.pid}.tmp`
  writeFileSync(partial, `${JSON.stringify(saved)}\n`)
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
if (command === 'progress') {
  await setProgressFrom(Bun.argv.slice(3)).catch((error: unknown) => {
    console.error(`inbox progress could not set the progress: ${reasonOf(error)}`)
    process.exit(1)
  })
  process.exit(0)
}
if (command !== 'serve' || flag !== '--data' || data === undefined || rest.length > 0) {
  console.error(usage)
  process.exit(2)
}
if (!statSync(data, { throwIfNoEntry: false })?.isDirectory()) refuse('serve', `${data} is not a folder.`)

async function start(folder: string): Promise<Serving> {
  const store = storeIn(folder, disk)
  const saved = await savedServer(store)
  const options: Omit<Options, 'port'> = {
    store,
    senders: sessionSenders,
    repositoryOf: (project) => repositoryOf(run, project, (line) => console.error(`inbox serve: ${line}`)),
    ...(process.env['CMOD_MOD'] ? { provide: provideGoals } : {}),
  }
  const started = await serve({ ...options, port: saved?.port ?? 0 }).catch((error: unknown) => {
    if (saved === undefined || !isPortTaken(error)) throw error
    return serve({ ...options, port: 0 })
  })
  save(serverPath(store), { port: started.port })
  return started
}

const serving = await start(data).catch((error: unknown) => {
  console.error(`inbox serve could not start: ${reasonOf(error)}`)
  return process.exit(1)
})
console.log(`127.0.0.1:${serving.port}`)

function stopServing(): void {
  void serving.stop().then(() => process.exit(0))
}

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, stopServing)
