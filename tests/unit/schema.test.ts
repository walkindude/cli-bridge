import { describe, it, expect } from 'vitest';
import { validateSpec, CLI_TOOL_SPEC_SCHEMA } from '../../src/schema.js';
import type { CliToolSpec } from '../../src/schema.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function loadFixture(name: string): unknown {
  const raw = readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');
  return JSON.parse(raw) as unknown;
}

function makeMinimalSpec(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: 'mytool',
    specVersion: '1',
    binary: 'mytool',
    binaryVersion: '1.0.0',
    description: 'A test tool',
    versionDetection: {
      command: '--version',
      pattern: 'v?(\\d+\\.\\d+)',
    },
    triggers: {
      positive: ['use mytool'],
      negative: ['avoid mytool'],
    },
    commands: [
      {
        name: 'run',
        description: 'Run something',
        usage: 'mytool run',
        output: { format: 'text' },
      },
    ],
    ...overrides,
  };
}

describe('validateSpec', () => {
  describe('valid specs', () => {
    it('accepts a valid minimal spec', () => {
      const result = validateSpec(makeMinimalSpec());
      expect(result.ok).toBe(true);
    });

    it('accepts the valid-spec.json fixture', () => {
      const fixture = loadFixture('valid-spec.json');
      const result = validateSpec(fixture);
      expect(result.ok).toBe(true);
    });

    it('accepts spec with all optional fields', () => {
      const spec = makeMinimalSpec({
        registration: {
          resolvedPath: '/usr/bin/mytool',
          registeredAt: '2026-01-01T00:00:00Z',
          helpOutput: 'Usage: mytool [options]',
        },
        globalFlags: [
          {
            name: 'verbose',
            short: 'v',
            description: 'Enable verbose output',
            required: false,
            type: 'boolean',
          },
        ],
        commands: [
          {
            name: 'list',
            description: 'List items',
            usage: 'mytool list',
            args: [
              {
                name: 'pattern',
                description: 'Filter pattern',
                required: false,
                type: 'string',
              },
            ],
            flags: [
              {
                name: 'format',
                description: 'Output format',
                required: false,
                type: 'string',
                default: 'json',
                enum: ['json', 'text'],
              },
            ],
            output: { format: 'json', jsonPath: 'data', successPattern: 'ok' },
            timeoutMs: 5000,
          },
        ],
      });
      const result = validateSpec(spec);
      expect(result.ok).toBe(true);
    });
  });

  describe('non-object inputs', () => {
    it('rejects null', () => {
      const result = validateSpec(null);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0]?.message).toContain('object');
      }
    });

    it('rejects array', () => {
      const result = validateSpec([]);
      expect(result.ok).toBe(false);
    });

    it('rejects string', () => {
      const result = validateSpec('not an object');
      expect(result.ok).toBe(false);
    });
  });

  describe('name field', () => {
    it('rejects missing name', () => {
      const spec = loadFixture('invalid-specs/missing-name.json');
      const result = validateSpec(spec);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const nameError = result.error.find((e) => e.path === 'name');
        expect(nameError).toBeDefined();
      }
    });

    it('rejects uppercase name', () => {
      const spec = loadFixture('invalid-specs/invalid-name.json');
      const result = validateSpec(spec);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const nameError = result.error.find((e) => e.path === 'name');
        expect(nameError).toBeDefined();
      }
    });

    it('rejects name starting with number', () => {
      const result = validateSpec(makeMinimalSpec({ name: '1tool' }));
      expect(result.ok).toBe(false);
    });

    it('rejects name with special chars', () => {
      const result = validateSpec(makeMinimalSpec({ name: 'my_tool' }));
      expect(result.ok).toBe(false);
    });

    it('accepts lowercase with dashes', () => {
      const result = validateSpec(makeMinimalSpec({ name: 'my-tool' }));
      expect(result.ok).toBe(true);
    });

    it('accepts lowercase with numbers', () => {
      const result = validateSpec(makeMinimalSpec({ name: 'tool2' }));
      expect(result.ok).toBe(true);
    });
  });

  describe('specVersion field', () => {
    it('rejects specVersion "2"', () => {
      const result = validateSpec(makeMinimalSpec({ specVersion: '2' }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error.find((e) => e.path === 'specVersion');
        expect(err).toBeDefined();
      }
    });

    it('rejects numeric specVersion 1', () => {
      const result = validateSpec(makeMinimalSpec({ specVersion: 1 }));
      expect(result.ok).toBe(false);
    });

    it('rejects missing specVersion', () => {
      const spec = makeMinimalSpec();
      const obj = spec as Record<string, unknown>;
      delete obj['specVersion'];
      const result = validateSpec(spec);
      expect(result.ok).toBe(false);
    });
  });

  describe('binary and binaryVersion', () => {
    it('rejects empty binary', () => {
      const result = validateSpec(makeMinimalSpec({ binary: '' }));
      expect(result.ok).toBe(false);
    });

    it('rejects missing binary', () => {
      const spec = makeMinimalSpec();
      delete (spec as Record<string, unknown>)['binary'];
      const result = validateSpec(spec);
      expect(result.ok).toBe(false);
    });

    it('rejects empty binaryVersion', () => {
      const result = validateSpec(makeMinimalSpec({ binaryVersion: '' }));
      expect(result.ok).toBe(false);
    });
  });

  describe('description field', () => {
    it('rejects empty description', () => {
      const result = validateSpec(makeMinimalSpec({ description: '' }));
      expect(result.ok).toBe(false);
    });

    it('rejects description > 500 chars', () => {
      const result = validateSpec(makeMinimalSpec({ description: 'x'.repeat(501) }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error.find((e) => e.path === 'description');
        expect(err?.message).toContain('500');
      }
    });

    it('accepts description at exactly 500 chars', () => {
      const result = validateSpec(makeMinimalSpec({ description: 'x'.repeat(500) }));
      expect(result.ok).toBe(true);
    });
  });

  describe('versionDetection', () => {
    it('rejects missing versionDetection', () => {
      const spec = makeMinimalSpec();
      delete (spec as Record<string, unknown>)['versionDetection'];
      const result = validateSpec(spec);
      expect(result.ok).toBe(false);
    });

    it('rejects invalid regex pattern', () => {
      const result = validateSpec(makeMinimalSpec({
        versionDetection: { command: '--version', pattern: '[invalid(' },
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error.find((e) => e.path === 'versionDetection.pattern');
        expect(err).toBeDefined();
      }
    });

    it('rejects pattern without capture group', () => {
      const result = validateSpec(makeMinimalSpec({
        versionDetection: { command: '--version', pattern: '\\d+\\.\\d+' },
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error.find((e) => e.path === 'versionDetection.pattern');
        expect(err?.message).toContain('capture group');
      }
    });

    it('rejects empty command', () => {
      const result = validateSpec(makeMinimalSpec({
        versionDetection: { command: '', pattern: '(\\d+)' },
      }));
      expect(result.ok).toBe(false);
    });
  });

  describe('triggers', () => {
    it('rejects empty positive array', () => {
      const result = validateSpec(makeMinimalSpec({
        triggers: { positive: [], negative: ['no'] },
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error.find((e) => e.path === 'triggers.positive');
        expect(err).toBeDefined();
      }
    });

    it('rejects empty negative array', () => {
      const result = validateSpec(makeMinimalSpec({
        triggers: { positive: ['yes'], negative: [] },
      }));
      expect(result.ok).toBe(false);
    });

    it('rejects empty string in positive array', () => {
      const result = validateSpec(makeMinimalSpec({
        triggers: { positive: [''], negative: ['no'] },
      }));
      expect(result.ok).toBe(false);
    });
  });

  describe('commands', () => {
    it('rejects empty commands array', () => {
      const spec = loadFixture('invalid-specs/empty-commands.json');
      const result = validateSpec(spec);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error.find((e) => e.path === 'commands');
        expect(err).toBeDefined();
      }
    });

    it('rejects missing commands', () => {
      const spec = makeMinimalSpec();
      delete (spec as Record<string, unknown>)['commands'];
      const result = validateSpec(spec);
      expect(result.ok).toBe(false);
    });

    it('rejects command with timeoutMs below 1000', () => {
      const result = validateSpec(makeMinimalSpec({
        commands: [{
          name: 'run', description: 'Run', usage: 'run',
          output: { format: 'text' }, timeoutMs: 999,
        }],
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error.find((e) => e.path.includes('timeoutMs'));
        expect(err).toBeDefined();
      }
    });

    it('rejects command with timeoutMs above 300000', () => {
      const result = validateSpec(makeMinimalSpec({
        commands: [{
          name: 'run', description: 'Run', usage: 'run',
          output: { format: 'text' }, timeoutMs: 300001,
        }],
      }));
      expect(result.ok).toBe(false);
    });

    it('accepts timeoutMs at boundary values', () => {
      const result1 = validateSpec(makeMinimalSpec({
        commands: [{ name: 'run', description: 'Run', usage: 'run', output: { format: 'text' }, timeoutMs: 1000 }],
      }));
      expect(result1.ok).toBe(true);
      const result2 = validateSpec(makeMinimalSpec({
        commands: [{ name: 'run', description: 'Run', usage: 'run', output: { format: 'text' }, timeoutMs: 300000 }],
      }));
      expect(result2.ok).toBe(true);
    });
  });

  describe('FlagDef validation', () => {
    it('rejects flag with uppercase name', () => {
      const result = validateSpec(makeMinimalSpec({
        globalFlags: [{
          name: 'Verbose',
          description: 'enable verbose',
          required: false,
          type: 'boolean',
        }],
      }));
      expect(result.ok).toBe(false);
    });

    it('rejects flag.short with multiple chars', () => {
      const result = validateSpec(makeMinimalSpec({
        globalFlags: [{
          name: 'verbose',
          short: 'vv',
          description: 'enable verbose',
          required: false,
          type: 'boolean',
        }],
      }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const err = result.error.find((e) => e.path.includes('short'));
        expect(err).toBeDefined();
      }
    });

    it('rejects flag.short with uppercase', () => {
      const result = validateSpec(makeMinimalSpec({
        globalFlags: [{
          name: 'verbose',
          short: 'V',
          description: 'enable verbose',
          required: false,
          type: 'boolean',
        }],
      }));
      expect(result.ok).toBe(false);
    });

    it('accepts valid flag with all fields', () => {
      const result = validateSpec(makeMinimalSpec({
        globalFlags: [{
          name: 'output',
          short: 'o',
          description: 'Output format',
          required: false,
          type: 'string',
          default: 'text',
          enum: ['json', 'text'],
        }],
      }));
      expect(result.ok).toBe(true);
    });
  });

  describe('registration (optional)', () => {
    it('rejects registration with empty resolvedPath', () => {
      const result = validateSpec(makeMinimalSpec({
        registration: { resolvedPath: '', registeredAt: '2026-01-01', helpOutput: 'help' },
      }));
      expect(result.ok).toBe(false);
    });

    it('rejects registration.helpOutput > 2000 chars', () => {
      const result = validateSpec(makeMinimalSpec({
        registration: {
          resolvedPath: '/usr/bin/mytool',
          registeredAt: '2026-01-01',
          helpOutput: 'x'.repeat(2001),
        },
      }));
      expect(result.ok).toBe(false);
    });

    it('accepts registration with valid fields', () => {
      const result = validateSpec(makeMinimalSpec({
        registration: {
          resolvedPath: '/usr/bin/mytool',
          registeredAt: '2026-01-01T00:00:00Z',
          helpOutput: 'Usage: mytool [options]',
        },
      }));
      expect(result.ok).toBe(true);
    });
  });

  describe('TypeScript type and JSON Schema agreement', () => {
    it('a valid TypeScript CliToolSpec object passes validateSpec', () => {
      // Construct a valid object using TypeScript types, then validate
      const spec: CliToolSpec = {
        name: 'typed-tool',
        specVersion: '1',
        binary: 'typed-tool',
        binaryVersion: '2.0.0',
        description: 'A typed spec for cross-validation',
        versionDetection: {
          command: '--version',
          pattern: 'version (\\d+\\.\\d+)',
        },
        triggers: {
          positive: ['use typed-tool for queries'],
          negative: ['do not use typed-tool for writes'],
        },
        commands: [
          {
            name: 'query',
            description: 'Execute a query',
            usage: 'typed-tool query <sql>',
            args: [
              { name: 'sql', description: 'SQL query to run', required: true, type: 'string' },
            ],
            output: { format: 'json' },
          },
        ],
      };
      const result = validateSpec(spec);
      expect(result.ok).toBe(true);
    });

    it('CLI_TOOL_SPEC_SCHEMA has expected required fields', () => {
      const required = CLI_TOOL_SPEC_SCHEMA.required as readonly string[];
      expect(required).toContain('name');
      expect(required).toContain('specVersion');
      expect(required).toContain('binary');
      expect(required).toContain('binaryVersion');
      expect(required).toContain('description');
      expect(required).toContain('versionDetection');
      expect(required).toContain('triggers');
      expect(required).toContain('commands');
    });
  });

  describe('output format validation', () => {
    const formats = ['json', 'text', 'csv', 'tsv', 'jsonl'] as const;
    for (const format of formats) {
      it(`accepts output format "${format}"`, () => {
        const result = validateSpec(makeMinimalSpec({
          commands: [{ name: 'run', description: 'Run', usage: 'run', output: { format } }],
        }));
        expect(result.ok).toBe(true);
      });
    }

    it('rejects invalid output format', () => {
      const result = validateSpec(makeMinimalSpec({
        commands: [{ name: 'run', description: 'Run', usage: 'run', output: { format: 'xml' } }],
      }));
      expect(result.ok).toBe(false);
    });
  });
});
