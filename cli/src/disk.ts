import { lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Run } from '../../src/items/item.js'
import type { Disk } from '../../src/items/store.js'

export const disk: Disk = {
  read: (path) => readFile(path, 'utf8'),
  async write(path, text) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text)
  },
  exists: (path) =>
    stat(path).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return false
        throw error
      },
    ),
  async list(folder) {
    const entries = await readdir(folder, { withFileTypes: true })
    return Promise.all(
      entries.map(async (entry) => {
        const { size, mtimeMs } = await lstat(join(folder, entry.name))
        return { name: entry.name, isFile: entry.isFile(), size, modifiedAt: mtimeMs }
      }),
    )
  },
}

export const run: Run = async (argv) => {
  const child = Bun.spawn([...argv], { stdout: 'pipe', stderr: 'inherit' })
  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
  return { exitCode, stdout }
}
