/** Build the Host entry and the standard DSH browser module. */
import { clientBundle } from '../../packages/client/tsdown.client.ts'
import { fileURLToPath } from 'node:url'

const build = clientBundle(import.meta.dirname, ['src/index.ts'])

export default (options: Parameters<typeof build>[0]) => build(options).map(config =>
  config.name === 'dsh-xlx-agent-team/client'
    ? { ...config, alias: { yaml: fileURLToPath(new URL('./node_modules/yaml/browser/index.js', import.meta.url)) } }
    : config)
