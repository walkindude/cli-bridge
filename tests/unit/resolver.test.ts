import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('resolveBinary', () => {
    it('returns ok for "node" which should be in PATH', async () => {
      const { resolveBinary } = await import('../../src/resolver.js');
      const result = await resolveBinary('node');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('node');
      }
    });

    it('returns err for a nonexistent binary', async () => {
      const { resolveBinary } = await import('../../src/resolver.js');
      const result = await resolveBinary('nonexistent-binary-xyz-abc-123');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Binary not found');
      }
    });
  });

  describe('detectVersion', () => {
    it('detects version from node --version', async () => {
      const { resolveBinary, detectVersion } = await import('../../src/resolver.js');
      const resolved = await resolveBinary('node');
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;

      const result = await detectVersion(resolved.value);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatch(/\d+\.\d+/);
      }
    });

    it('uses custom detection command when provided', async () => {
      const { resolveBinary, detectVersion } = await import('../../src/resolver.js');
      const resolved = await resolveBinary('node');
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;

      const result = await detectVersion(resolved.value, {
        command: '--version',
        pattern: 'v(\\d+\\.\\d+\\.\\d+)',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toMatch(/^\d+\.\d+\.\d+$/);
      }
    });

    it('returns err for binary that produces no version output', async () => {
      const { detectVersion } = await import('../../src/resolver.js');
      // Use a nonexistent path to trigger error
      const result = await detectVersion('/nonexistent/path/binary');
      expect(result.ok).toBe(false);
    });
  });

  describe('resolveSpecVersion', () => {
    it('returns exact match when version file exists', async () => {
      const { resolveSpecVersion } = await import('../../src/resolver.js');
      // Create temp directory with a spec file
      const tmpDir = join(tmpdir(), `cli-bridge-test-${Date.now()}`);
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(join(tmpDir, '1.2.3.json'), '{}');

      try {
        const result = await resolveSpecVersion(tmpDir, '1.2.3');
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.exactMatch).toBe(true);
          expect(result.value.specPath).toContain('1.2.3.json');
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true });
      }
    });

    it('returns best match when exact version not found', async () => {
      const { resolveSpecVersion } = await import('../../src/resolver.js');
      const tmpDir = join(tmpdir(), `cli-bridge-test-${Date.now()}`);
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(join(tmpDir, '1.0.0.json'), '{}');
      await fs.writeFile(join(tmpDir, '1.2.0.json'), '{}');

      try {
        const result = await resolveSpecVersion(tmpDir, '1.5.0');
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.exactMatch).toBe(false);
          // Should pick highest version (1.2.0)
          expect(result.value.specPath).toContain('1.2.0.json');
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true });
      }
    });

    it('returns err for nonexistent directory', async () => {
      const { resolveSpecVersion } = await import('../../src/resolver.js');
      const result = await resolveSpecVersion('/nonexistent/dir', '1.0.0');
      expect(result.ok).toBe(false);
    });

    it('returns err for empty directory', async () => {
      const { resolveSpecVersion } = await import('../../src/resolver.js');
      const tmpDir = join(tmpdir(), `cli-bridge-test-${Date.now()}`);
      await fs.mkdir(tmpDir, { recursive: true });

      try {
        const result = await resolveSpecVersion(tmpDir, '1.0.0');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('No spec files');
        }
      } finally {
        await fs.rm(tmpDir, { recursive: true });
      }
    });
  });
});
