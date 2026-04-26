import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { tryAutoRefreshSpec } from '../../src/refresh.js';
import type { CliToolSpec } from '../../src/schema.js';

// Builds a fake binary that emits a fixed manifest on `cli-bridge-manifest`
// and exits 1 for everything else. Returns the absolute path. Tests reuse
// this so they exercise the real execFile path, not a mock.
async function makeFakeBinary(dir: string, name: string, manifestStdout: string): Promise<string> {
  const path = join(dir, name);
  const script = `#!/bin/sh
case "$1" in
  cli-bridge-manifest)
    cat <<'MANIFEST_EOF'
${manifestStdout}
MANIFEST_EOF
    ;;
  *)
    exit 1
    ;;
esac
`;
  await fs.writeFile(path, script, { mode: 0o755 });
  return path;
}

function validManifest(version: string): string {
  const spec: CliToolSpec = {
    name: 'fakebin',
    specVersion: '1',
    binary: 'fakebin',
    binaryVersion: version,
    description: 'Fake binary used in tests',
    versionDetection: { command: '--version', pattern: 'v(\\d+\\.\\d+\\.\\d+)' },
    triggers: {
      positive: ['use fakebin for testing the refresh path'],
      negative: ['do not use fakebin in production'],
    },
    commands: [
      {
        name: 'list',
        description: 'List items',
        usage: 'fakebin list',
        output: { format: 'json' },
      },
    ],
  };
  return JSON.stringify(spec, null, 2);
}

describe('tryAutoRefreshSpec', () => {
  let tmpRoot: string;
  let toolDir: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(join(tmpdir(), 'cli-bridge-refresh-'));
    toolDir = join(tmpRoot, 'specs', 'fakebin');
    await fs.mkdir(toolDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('writes the fresh spec to <toolDir>/<installedVersion>.json on success', async () => {
    const binPath = await makeFakeBinary(tmpRoot, 'fakebin', validManifest('1.2.3'));

    const result = await tryAutoRefreshSpec('fakebin', binPath, '1.2.3', toolDir);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.writtenPath).toBe(join(toolDir, '1.2.3.json'));
      expect(result.value.spec.binaryVersion).toBe('1.2.3');
      const written = await fs.readFile(result.value.writtenPath, 'utf-8');
      expect(JSON.parse(written) as CliToolSpec).toMatchObject({
        name: 'fakebin',
        binaryVersion: '1.2.3',
      });
    }
  });

  it('returns an error when the binary lacks cli-bridge-manifest', async () => {
    const binPath = join(tmpRoot, 'noop');
    await fs.writeFile(binPath, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

    const result = await tryAutoRefreshSpec('noop', binPath, '0.1.0', toolDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cli-bridge-manifest/);
    }
    // No spec file should have been written.
    const entries = await fs.readdir(toolDir);
    expect(entries).toEqual([]);
  });

  it('returns an error when manifest stdout is not valid JSON', async () => {
    const binPath = await makeFakeBinary(tmpRoot, 'badjson', 'not json at all');

    const result = await tryAutoRefreshSpec('badjson', binPath, '1.0.0', toolDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not valid JSON/);
    }
    const entries = await fs.readdir(toolDir);
    expect(entries).toEqual([]);
  });

  it('returns an error when manifest fails spec validation', async () => {
    // Valid JSON, but missing required fields like commands/triggers.
    const binPath = await makeFakeBinary(tmpRoot, 'partialbin', '{"name":"partialbin"}');

    const result = await tryAutoRefreshSpec('partialbin', binPath, '1.0.0', toolDir);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/spec validation/);
    }
    const entries = await fs.readdir(toolDir);
    expect(entries).toEqual([]);
  });

  it('does not crash when the binary path is missing', async () => {
    const result = await tryAutoRefreshSpec(
      'ghost',
      join(tmpRoot, 'does-not-exist'),
      '0.0.0',
      toolDir,
    );

    expect(result.ok).toBe(false);
  });
});
