/** Run the repository's CLI with local Web bundle setup. */
import { fileURLToPath } from 'node:url'
import { runCli } from '../apps/cli/src/bin.ts'
import { pnpmInvocation } from './pnpm-invocation.ts'

await runCli({
  async prepareSourceWeb() {
    const { prepareLocalWebPlugins } = await import('../apps/cli/src/local-web-plugins.ts')
    const root = fileURLToPath(new URL('..', import.meta.url))
    const pnpm = process.env.npm_execpath ? pnpmInvocation([]) : { command: 'pnpm', args: [] }
    await prepareLocalWebPlugins(root, pnpm)
  },
})
