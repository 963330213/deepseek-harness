/** Install checkout-local bundles before launching the source Web profile. */
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readProfileManifest, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import { runPlugin } from './plugin.ts'

/**
 * Install bundles from immediate subdirectories of the repository's plugins directory.
 * Missing directories and packages without bundle metadata require no preparation.
 * Installation uses the normal profile lock, compatibility checks and bundle selection;
 * a failure stops Web startup without bypassing the plugin manager's diagnostics.
 * @param root - Repository root containing the optional plugins directory.
 * @param packageManager - Executable and prefix arguments for the source launcher's pnpm.
 * @returns Resolves after all discovered bundles have been installed together.
 */
export async function prepareLocalWebPlugins(
  root: string,
  packageManager: ProfileContext['packageManager'],
): Promise<void> {
  const directory = resolve(root, 'plugins')
  if (!existsSync(directory)) return
  const bundles = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name))
    .sort()
    .filter(
      path =>
        existsSync(join(path, 'package.json')) && readProfileManifest('dsh', path).dsh?.bundle?.patch !== undefined,
    )
  if (bundles.length === 0) return
  const exitCode = await runPlugin('web', ['add', ...bundles], packageManager)
  if (exitCode !== 0) {
    throw new Error('dsh: local Web plugin installation failed; resolve the plugin diagnostics above before restarting')
  }
}
