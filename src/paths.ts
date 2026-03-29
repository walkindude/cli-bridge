import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Returns the user-level spec directory, creating it if needed.
 * Respects XDG_CONFIG_HOME if set.
 */
export async function getUserSpecDir(): Promise<string> {
  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg || join(homedir(), '.config');
  const dir = join(base, 'cli-bridge', 'specs');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Returns the path for a specific tool+version spec in the user config directory.
 */
export async function getUserSpecPath(toolName: string, version: string): Promise<string> {
  const base = await getUserSpecDir();
  const dir = join(base, toolName);
  await fs.mkdir(dir, { recursive: true });
  return join(dir, `${version}.json`);
}

/**
 * Returns all spec directories that exist, in priority order:
 * project > user > bundled plugin.
 */
export async function getSpecDirectories(cwd: string, pluginDir: string): Promise<string[]> {
  const candidates = [
    join(cwd, '.cli-bridge', 'specs'),
    await getUserSpecDir(),
    join(pluginDir, 'specs'),
  ];
  const results: string[] = [];
  for (const dir of candidates) {
    try {
      await fs.access(dir);
      results.push(dir);
    } catch {
      // skip nonexistent
    }
  }
  return results;
}
