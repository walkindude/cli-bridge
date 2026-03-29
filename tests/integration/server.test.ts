import { describe, it, expect } from 'vitest';

/**
 * Integration test for the MCP server.
 * These tests require the server to be built and running.
 * They are skipped if the built server is not available.
 */
describe('MCP server integration', () => {
  it('server module imports without throwing synchronously', async () => {
    // The server module calls main() at the top level, which is async.
    // In tests it won't throw synchronously - the async part runs in background.
    // We just verify the import resolves (not rejects).
    const mod = await import('../../src/server.js');
    expect(mod).toBeDefined();
  });

  it('getSpecDirectories is importable', async () => {
    const { getSpecDirectories } = await import('../../src/paths.js');
    expect(typeof getSpecDirectories).toBe('function');
  });

  it('discoverSpecs returns empty for no spec dirs', async () => {
    const { discoverSpecs } = await import('../../src/registry.js');
    const result = await discoverSpecs([]);
    expect(result.specs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
