import { homedir } from 'node:os'
import { provide } from '../../node_modules/@cmodjs/core/mod.js'
import { connect } from '../../node_modules/@cmodjs/core/rpc.js'
import { sendersOf, type Senders } from '../../src/items/item.js'
import { run } from './disk.js'
import { relayGoalChanges, type Provide } from './goals.js'

export const cmodStore = `${process.env['XDG_DATA_HOME'] || `${homedir()}/.local/share`}/cmod`

const cmod = `${cmodStore}/programs/cmod`

export async function sessionSenders(): Promise<Senders> {
  const { exitCode, stdout } = await run([cmod, 'sessions', 'list', '--every-project', '--json'])
  if (exitCode !== 0) throw new Error(`${cmod} sessions list --every-project --json exited with ${exitCode}, so the inbox cannot name the sessions.`)
  return sendersOf(JSON.parse(stdout) as Parameters<typeof sendersOf>[0])
}

export const provideGoals: Provide = async (methods) => {
  const connection = await connect()
  return relayGoalChanges(connection, provide('inbox/Goals', methods))
}
