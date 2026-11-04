import { homedir } from 'node:os'
import { sendersOf, type Senders } from '../../src/items/item.js'
import { run } from './disk.js'

const cmod = `${process.env['XDG_DATA_HOME'] || `${homedir()}/.local/share`}/cmod/programs/cmod`

export async function sessionSenders(): Promise<Senders> {
  const { exitCode, stdout } = await run([cmod, 'history', 'sessions', '--all', '--json'])
  if (exitCode !== 0) throw new Error(`${cmod} history sessions --all --json exited with ${exitCode}, so the inbox cannot name the sessions.`)
  return sendersOf(JSON.parse(stdout) as Parameters<typeof sendersOf>[0])
}
