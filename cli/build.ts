import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

const app = `${import.meta.dir}/src/app`

export const built = `${import.meta.dir}/build`

const named: Readonly<Record<string, string>> = { 'text/javascript;charset=utf-8': 'script.txt', 'text/css;charset=utf-8': 'style.txt' }

export async function buildApp(): Promise<void> {
  const result = await Bun.build({ entrypoints: [`${app}/main.tsx`], target: 'browser', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
  if (!result.success) throw new AggregateError(result.logs, 'The inbox web app did not build.')
  await mkdir(built, { recursive: true })
  const build = createHash('sha256')
  for (const output of result.outputs) {
    const name = named[output.type]
    if (name === undefined) throw new Error(`The inbox web app built ${output.path}, a ${output.type} the server does not serve.`)
    build.update(new Uint8Array(await output.arrayBuffer()))
    await Bun.write(`${built}/${name}`, output)
  }
  const page = await Bun.file(`${app}/index.html`).text()
  const shell = page.replace('<meta name="inbox-build" content="" />', `<meta name="inbox-build" content="${build.digest('hex')}" />`)
  if (shell === page) throw new Error('src/app/index.html has no inbox-build meta for the build to fill.')
  await Bun.write(`${built}/shell.txt`, shell)
}

if (import.meta.main) await buildApp()
