import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CliToolSpec } from '../../src/schema.js';

function makeValidSpec(overrides: Partial<CliToolSpec> = {}): CliToolSpec {
  return {
    name: 'mytool',
    specVersion: '1',
    binary: 'mytool',
    binaryVersion: '1.0.0',
    description: 'Test tool',
    versionDetection: {
      command: '--version',
      pattern: 'v?(\\d+\\.\\d+)',
    },
    triggers: {
      positive: ['use mytool for this task'],
      negative: ['do not use mytool for writes'],
    },
    commands: [
      {
        name: 'list',
        description: 'List all items',
        usage: 'mytool list [--filter pattern]',
        output: { format: 'json' },
      },
      {
        name: 'get',
        description: 'Get an item',
        usage: 'mytool get <name>',
        args: [{ name: 'name', description: 'Item name', required: true, type: 'string' }],
        output: { format: 'text' },
      },
    ],
    ...overrides,
  };
}

describe('specToMcpTools', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('converts spec commands to tool definitions', async () => {
    const { specToMcpTools } = await import('../../src/registry.js');
    const spec = makeValidSpec();
    const tools = specToMcpTools(spec);
    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe('mytool_list');
    expect(tools[1]?.name).toBe('mytool_get');
  });

  it('includes trigger text in description', async () => {
    const { specToMcpTools } = await import('../../src/registry.js');
    const spec = makeValidSpec();
    const tools = specToMcpTools(spec);
    expect(tools[0]?.description).toContain('USE THIS TOOL');
    expect(tools[0]?.description).toContain('DO NOT USE');
    expect(tools[0]?.description).toContain('use mytool for this task');
  });

  it('maps command description correctly', async () => {
    const { specToMcpTools } = await import('../../src/registry.js');
    const spec = makeValidSpec();
    const tools = specToMcpTools(spec);
    expect(tools[0]?.description).toContain('List all items');
  });

  it('includes required args in required array', async () => {
    const { specToMcpTools } = await import('../../src/registry.js');
    const spec = makeValidSpec();
    const tools = specToMcpTools(spec);
    const getTool = tools[1];
    expect(getTool?.inputSchema.required).toContain('name');
  });

  it('merges globalFlags with command flags', async () => {
    const { specToMcpTools } = await import('../../src/registry.js');
    const spec = makeValidSpec({
      globalFlags: [
        { name: 'verbose', description: 'Verbose', required: false, type: 'boolean' },
      ],
      commands: [
        {
          name: 'list',
          description: 'List items',
          usage: 'mytool list',
          flags: [
            { name: 'filter', description: 'Filter', required: false, type: 'string' },
          ],
          output: { format: 'json' },
        },
      ],
    });
    const tools = specToMcpTools(spec);
    const props = tools[0]?.inputSchema.properties ?? {};
    expect(props).toHaveProperty('verbose');
    expect(props).toHaveProperty('filter');
  });

  it('maps "path" type to "string" in inputSchema', async () => {
    const { specToMcpTools } = await import('../../src/registry.js');
    const spec = makeValidSpec({
      commands: [
        {
          name: 'run',
          description: 'Run script',
          usage: 'mytool run <script>',
          args: [{ name: 'script', description: 'Script path', required: true, type: 'path' }],
          output: { format: 'text' },
        },
      ],
    });
    const tools = specToMcpTools(spec);
    const props = tools[0]?.inputSchema.properties ?? {};
    expect((props['script'] as Record<string, string>)['type']).toBe('string');
  });

  it('includes enum and default in property definition', async () => {
    const { specToMcpTools } = await import('../../src/registry.js');
    const spec = makeValidSpec({
      globalFlags: [
        {
          name: 'format',
          description: 'Output format',
          required: false,
          type: 'string',
          enum: ['json', 'text'],
          default: 'text',
        },
      ],
    });
    const tools = specToMcpTools(spec);
    const formatProp = tools[0]?.inputSchema.properties['format'] as Record<string, unknown>;
    expect(formatProp?.['enum']).toEqual(['json', 'text']);
    expect(formatProp?.['default']).toBe('text');
  });

  it('sets type to object in inputSchema', async () => {
    const { specToMcpTools } = await import('../../src/registry.js');
    const spec = makeValidSpec();
    const tools = specToMcpTools(spec);
    expect(tools[0]?.inputSchema.type).toBe('object');
  });
});

describe('discoverSpecs', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns empty specs and no errors for empty directories list', async () => {
    const { discoverSpecs } = await import('../../src/registry.js');
    const result = await discoverSpecs([]);
    expect(result.specs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles nonexistent directories gracefully', async () => {
    const { discoverSpecs } = await import('../../src/registry.js');
    const result = await discoverSpecs(['/nonexistent/path/xyz']);
    expect(result.specs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
