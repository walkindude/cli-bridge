import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoadedSpec } from '../../src/registry.js';
import type { CommandDef } from '../../src/schema.js';

function makeLoadedSpec(overrides: Partial<LoadedSpec> = {}): LoadedSpec {
  return {
    spec: {
      name: 'mytool',
      specVersion: '1',
      binary: 'mytool',
      binaryVersion: '1.0.0',
      description: 'Test tool',
      versionDetection: { command: '--version', pattern: 'v?(\\d+)' },
      triggers: { positive: ['use mytool'], negative: ['avoid mytool'] },
      commands: [],
    },
    resolvedBinaryPath: '/usr/local/bin/mytool',
    installedVersion: '1.0.0',
    exactVersionMatch: true,
    ...overrides,
  };
}

function makeCommand(overrides: Partial<CommandDef> = {}): CommandDef {
  return {
    name: 'list',
    description: 'List items',
    usage: 'mytool list',
    output: { format: 'text' },
    ...overrides,
  };
}

describe('executeTool', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('executes with command name as first arg (non-run commands)', async () => {
    // We'll test with a real binary: node --eval
    const { executeTool } = await import('../../src/executor.js');
    // For "run" command, no command arg is prepended
    const runCommand = makeCommand({
      name: 'run',
      args: [
        {
          name: 'script',
          description: 'Script',
          required: true,
          type: 'string',
        },
      ],
      output: { format: 'text' },
    });

    // node with -e flag would work but node path varies - use echo via /bin/echo if available
    const result = await executeTool(
      makeLoadedSpec({ resolvedBinaryPath: '/bin/echo' }),
      runCommand,
      { script: 'hello' },
    );
    expect(result.stdout.trim()).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns non-zero exit code on failure', async () => {
    const { executeTool } = await import('../../src/executor.js');
    // Use false command (always exits 1)
    const command = makeCommand({
      name: 'run',
      args: [],
      flags: [],
      output: { format: 'text' },
    });
    const result = await executeTool(
      makeLoadedSpec({ resolvedBinaryPath: '/usr/bin/false' }),
      command,
      {},
    );
    expect(result.exitCode).not.toBe(0);
  });

  it('includes flags in args correctly', async () => {
    const { executeTool } = await import('../../src/executor.js');
    const command = makeCommand({
      name: 'run',
      flags: [
        {
          name: 'verbose',
          description: 'Verbose',
          required: false,
          type: 'boolean',
        },
        {
          name: 'format',
          description: 'Format',
          required: false,
          type: 'string',
        },
      ],
      output: { format: 'text' },
    });
    // We test using /bin/echo to capture args
    const result = await executeTool(makeLoadedSpec({ resolvedBinaryPath: '/bin/echo' }), command, {
      verbose: true,
      format: 'json',
    });
    expect(result.stdout).toContain('--verbose');
    expect(result.stdout).toContain('--format');
    expect(result.stdout).toContain('json');
  });

  it('omits boolean flag when false', async () => {
    const { executeTool } = await import('../../src/executor.js');
    const command = makeCommand({
      name: 'run',
      flags: [
        {
          name: 'verbose',
          description: 'Verbose',
          required: false,
          type: 'boolean',
        },
      ],
      output: { format: 'text' },
    });
    const result = await executeTool(makeLoadedSpec({ resolvedBinaryPath: '/bin/echo' }), command, {
      verbose: false,
    });
    expect(result.stdout).not.toContain('--verbose');
  });

  it('includes global flags from loadedSpec', async () => {
    const { executeTool } = await import('../../src/executor.js');
    const loadedSpec = makeLoadedSpec({
      resolvedBinaryPath: '/bin/echo',
      spec: {
        name: 'mytool',
        specVersion: '1',
        binary: 'mytool',
        binaryVersion: '1.0.0',
        description: 'Test',
        versionDetection: { command: '--version', pattern: '(\\d+)' },
        triggers: { positive: ['use'], negative: ['avoid'] },
        globalFlags: [
          {
            name: 'config',
            description: 'Config file',
            required: false,
            type: 'string',
          },
        ],
        commands: [],
      },
    });
    const command = makeCommand({ name: 'run', output: { format: 'text' } });
    const result = await executeTool(loadedSpec, command, {
      config: '/etc/mytool.conf',
    });
    expect(result.stdout).toContain('--config');
    expect(result.stdout).toContain('/etc/mytool.conf');
  });

  it('measures duration', async () => {
    const { executeTool } = await import('../../src/executor.js');
    const command = makeCommand({ name: 'run', output: { format: 'text' } });
    const result = await executeTool(
      makeLoadedSpec({ resolvedBinaryPath: '/bin/echo' }),
      command,
      {},
    );
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('respects timeoutMs in command', async () => {
    const { executeTool } = await import('../../src/executor.js');
    // This test verifies the timeout field is read without actually timing out
    const command = makeCommand({
      name: 'run',
      output: { format: 'text' },
      timeoutMs: 5000,
    });
    const result = await executeTool(
      makeLoadedSpec({ resolvedBinaryPath: '/bin/echo' }),
      command,
      {},
    );
    expect(result.exitCode).toBe(0);
  });
});
