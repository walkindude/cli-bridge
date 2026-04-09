import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';

// We'll mock the fs module
vi.mock('node:fs', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import() type
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn().mockResolvedValue(undefined),
      access: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe('paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('getUserSpecDir', () => {
    it('uses XDG_CONFIG_HOME when set', async () => {
      vi.stubEnv('XDG_CONFIG_HOME', '/custom/config');
      const { getUserSpecDir } = await import('../../src/paths.js');
      const result = await getUserSpecDir();
      expect(result).toBe('/custom/config/cli-bridge/specs');
    });

    it('falls back to ~/.config when XDG_CONFIG_HOME not set', async () => {
      vi.stubEnv('XDG_CONFIG_HOME', '');
      const { getUserSpecDir } = await import('../../src/paths.js');
      const result = await getUserSpecDir();
      const expected = join(homedir(), '.config', 'cli-bridge', 'specs');
      expect(result).toBe(expected);
    });

    it('calls fs.mkdir with recursive true', async () => {
      const fsMod = await import('node:fs');
      const mkdirMock = vi.spyOn(fsMod.promises, 'mkdir').mockResolvedValue(undefined);
      const { getUserSpecDir } = await import('../../src/paths.js');
      await getUserSpecDir();
      expect(mkdirMock).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
    });
  });

  describe('getUserSpecPath', () => {
    it('returns correct path for tool and version', async () => {
      vi.stubEnv('XDG_CONFIG_HOME', '/test/config');
      const { getUserSpecPath } = await import('../../src/paths.js');
      const result = await getUserSpecPath('mytool', '1.2.3');
      expect(result).toBe('/test/config/cli-bridge/specs/mytool/1.2.3.json');
    });
  });

  describe('getSpecDirectories', () => {
    it('includes directories that exist', async () => {
      const fsMod = await import('node:fs');
      vi.spyOn(fsMod.promises, 'access').mockResolvedValue(undefined);
      vi.stubEnv('XDG_CONFIG_HOME', '/test/config');
      const { getSpecDirectories } = await import('../../src/paths.js');
      const dirs = await getSpecDirectories('/project', '/plugin');
      expect(dirs.length).toBeGreaterThan(0);
    });

    it('excludes directories that do not exist', async () => {
      const fsMod = await import('node:fs');
      vi.spyOn(fsMod.promises, 'access').mockRejectedValue(new Error('ENOENT'));
      vi.stubEnv('XDG_CONFIG_HOME', '/test/config');
      const { getSpecDirectories } = await import('../../src/paths.js');
      const dirs = await getSpecDirectories('/project', '/plugin');
      expect(dirs).toHaveLength(0);
    });

    it('returns dirs in priority order: project > user > bundled', async () => {
      const fsMod = await import('node:fs');
      vi.spyOn(fsMod.promises, 'access').mockResolvedValue(undefined);
      vi.stubEnv('XDG_CONFIG_HOME', '/xdg');
      const { getSpecDirectories } = await import('../../src/paths.js');
      const dirs = await getSpecDirectories('/project', '/plugin');
      // project dir should be first
      expect(dirs[0]).toBe('/project/.cli-bridge/specs');
      // user dir
      expect(dirs[1]).toBe('/xdg/cli-bridge/specs');
      // bundled
      expect(dirs[2]).toBe('/plugin/specs');
    });
  });
});
