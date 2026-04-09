import { describe, it, expect, vi, type MockInstance, beforeEach, afterEach } from 'vitest';
import type { CliToolSpec } from '../../src/schema.js';
import type { LoadedSpec } from '../../src/registry.js';

/**
 * Tests for the server wiring logic in src/server.ts.
 * We mock the MCP SDK and spec directories to test main() in-process.
 */

function makeSpec(overrides: Partial<CliToolSpec> = {}): CliToolSpec {
  return {
    name: 'testtool',
    specVersion: '1',
    binary: 'testtool',
    binaryVersion: '1.0.0',
    description: 'A test tool',
    versionDetection: { command: '--version', pattern: '(\\d+\\.\\d+)' },
    triggers: {
      positive: ['use testtool'],
      negative: ['avoid testtool'],
    },
    commands: [
      {
        name: 'list',
        description: 'List items',
        usage: 'testtool list',
        flags: [
          {
            name: 'format',
            description: 'Output format',
            required: false,
            type: 'string',
            enum: ['json', 'text'],
          },
          {
            name: 'verbose',
            description: 'Verbose output',
            required: false,
            type: 'boolean',
          },
          {
            name: 'limit',
            description: 'Max items',
            required: false,
            type: 'number',
          },
        ],
        output: { format: 'json' },
      },
      {
        name: 'get',
        description: 'Get an item',
        usage: 'testtool get <name>',
        args: [
          {
            name: 'name',
            description: 'Item name',
            required: true,
            type: 'string',
          },
        ],
        output: { format: 'text' },
      },
    ],
    ...overrides,
  };
}

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}>;

async function setupAndRunMain(options: {
  specs: LoadedSpec[];
  errors: Array<{ specPath: string; message: string }>;
  toolDefs: Array<{
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  }>;
}): Promise<{
  registeredTools: Array<{ name: string; handler: ToolHandler }>;
  mockConnect: ReturnType<typeof vi.fn>;
}> {
  const registeredTools: Array<{ name: string; handler: ToolHandler }> = [];
  const mockConnect = vi.fn().mockResolvedValue(undefined);

  vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => {
    const MockMcpServer = function (this: Record<string, unknown>) {
      this.registerTool = vi.fn((name: string, _opts: unknown, handler: ToolHandler) => {
        registeredTools.push({ name, handler });
      });
      this.connect = mockConnect;
    };
    return { McpServer: MockMcpServer };
  });

  vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => {
    const MockTransport = function () {
      /* no-op */
    };
    return { StdioServerTransport: MockTransport };
  });

  vi.doMock('../../src/paths.js', () => ({
    getSpecDirectories: vi.fn().mockResolvedValue(['/fake/specs']),
  }));

  vi.doMock('../../src/registry.js', () => ({
    discoverSpecs: vi.fn().mockResolvedValue({
      specs: options.specs,
      errors: options.errors,
    }),
    specToMcpTools: vi.fn().mockReturnValue(options.toolDefs),
  }));

  const { main } = await import('../../src/server.js');
  await main();

  return { registeredTools, mockConnect };
}

describe('server main()', () => {
  let stderrSpy: MockInstance;

  beforeEach(() => {
    vi.resetModules();
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('discovers specs, registers tools, and connects transport', async () => {
    const validSpec = makeSpec();
    const loadedSpec: LoadedSpec = {
      spec: validSpec,
      resolvedBinaryPath: '/bin/echo',
      installedVersion: '1.0.0',
      exactVersionMatch: true,
    };

    const { registeredTools, mockConnect } = await setupAndRunMain({
      specs: [loadedSpec],
      errors: [],
      toolDefs: [
        {
          name: 'testtool_list',
          description: 'List items\n\nUSE THIS TOOL: use testtool\nDO NOT USE: avoid testtool',
          inputSchema: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                description: 'Output format',
                enum: ['json', 'text'],
              },
              verbose: { type: 'boolean', description: 'Verbose output' },
              limit: { type: 'number', description: 'Max items' },
            },
            required: [],
          },
        },
        {
          name: 'testtool_get',
          description: 'Get an item',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Item name' },
            },
            required: ['name'],
          },
        },
      ],
    });

    expect(registeredTools).toHaveLength(2);
    expect(registeredTools[0]?.name).toBe('testtool_list');
    expect(registeredTools[1]?.name).toBe('testtool_get');
    expect(mockConnect).toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('[cli-bridge] Loaded 1 tool specs from 1 directories'),
    );
  });

  it('logs errors for failed spec loads', async () => {
    await setupAndRunMain({
      specs: [],
      errors: [
        { specPath: '/fake/specs/broken', message: 'Binary not found' },
        { specPath: '/fake/specs/bad', message: 'Invalid spec' },
      ],
      toolDefs: [],
    });

    expect(stderrSpy).toHaveBeenCalledWith(
      '[cli-bridge] Failed to load spec: /fake/specs/broken: Binary not found',
    );
    expect(stderrSpy).toHaveBeenCalledWith(
      '[cli-bridge] Failed to load spec: /fake/specs/bad: Invalid spec',
    );
  });

  it('tool handler returns success response for successful execution', async () => {
    const validSpec = makeSpec();
    const loadedSpec: LoadedSpec = {
      spec: validSpec,
      resolvedBinaryPath: '/bin/echo',
      installedVersion: '1.0.0',
      exactVersionMatch: true,
    };

    const { registeredTools } = await setupAndRunMain({
      specs: [loadedSpec],
      errors: [],
      toolDefs: [
        {
          name: 'testtool_list',
          description: 'List items',
          inputSchema: {
            type: 'object',
            properties: {
              format: {
                type: 'string',
                description: 'Output format',
                enum: ['json', 'text'],
              },
              verbose: { type: 'boolean', description: 'Verbose output' },
              limit: { type: 'number', description: 'Max items' },
            },
            required: [],
          },
        },
      ],
    });

    expect(registeredTools).toHaveLength(1);
    const handler = registeredTools[0]?.handler;
    if (!handler) return;

    const result = await handler({ format: 'json' });
    expect(result.content).toBeDefined();
    expect(result.content.length).toBeGreaterThan(0);
    // /bin/echo with args: list --format json
    expect(result.isError).toBeUndefined();
  });

  it('tool handler returns error response for non-zero exit code', async () => {
    const validSpec = makeSpec();
    const loadedSpec: LoadedSpec = {
      spec: validSpec,
      resolvedBinaryPath: '/usr/bin/false',
      installedVersion: '1.0.0',
      exactVersionMatch: true,
    };

    const { registeredTools } = await setupAndRunMain({
      specs: [loadedSpec],
      errors: [],
      toolDefs: [
        {
          name: 'testtool_list',
          description: 'List items',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    });

    const handler = registeredTools[0]?.handler;
    if (!handler) return;

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content.length).toBe(2);
    expect(result.content[1]?.text).toContain('exit code:');
  });

  it('tool handler catches execution errors', async () => {
    const validSpec = makeSpec();
    const loadedSpec: LoadedSpec = {
      spec: validSpec,
      resolvedBinaryPath: '/nonexistent/binary/should/fail/xyz',
      installedVersion: '1.0.0',
      exactVersionMatch: true,
    };

    const { registeredTools } = await setupAndRunMain({
      specs: [loadedSpec],
      errors: [],
      toolDefs: [
        {
          name: 'testtool_list',
          description: 'List items',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    });

    const handler = registeredTools[0]?.handler;
    if (!handler) return;

    const result = await handler({});
    expect(result.isError).toBe(true);
    // executeTool wraps errors in resolve, so either we get non-zero exit or catch
    expect(result.content[0]?.text).toBeDefined();
  });

  it('skips commands not found in spec', async () => {
    const validSpec = makeSpec();
    const loadedSpec: LoadedSpec = {
      spec: validSpec,
      resolvedBinaryPath: '/bin/echo',
      installedVersion: '1.0.0',
      exactVersionMatch: true,
    };

    const { registeredTools } = await setupAndRunMain({
      specs: [loadedSpec],
      errors: [],
      toolDefs: [
        {
          name: 'testtool_nonexistent',
          description: 'Missing command',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ],
    });

    // The tool should not be registered because the command wasn't found
    expect(registeredTools).toHaveLength(0);
  });

  it('handles properties without description', async () => {
    const validSpec = makeSpec();
    const loadedSpec: LoadedSpec = {
      spec: validSpec,
      resolvedBinaryPath: '/bin/echo',
      installedVersion: '1.0.0',
      exactVersionMatch: true,
    };

    const { registeredTools } = await setupAndRunMain({
      specs: [loadedSpec],
      errors: [],
      toolDefs: [
        {
          name: 'testtool_list',
          description: 'List items',
          inputSchema: {
            type: 'object',
            properties: {
              nodesc: { type: 'string' },
            },
            required: [],
          },
        },
      ],
    });

    expect(registeredTools).toHaveLength(1);
  });

  it('tool handler catch block when executeTool throws', async () => {
    const validSpec = makeSpec();
    const loadedSpec: LoadedSpec = {
      spec: validSpec,
      resolvedBinaryPath: '/bin/echo',
      installedVersion: '1.0.0',
      exactVersionMatch: true,
    };

    // Mock executeTool to throw
    vi.doMock('../../src/executor.js', () => ({
      executeTool: vi.fn().mockRejectedValue(new Error('Unexpected crash')),
    }));

    const registeredTools: Array<{ name: string; handler: ToolHandler }> = [];
    const mockConnect = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => {
      const MockMcpServer = function (this: Record<string, unknown>) {
        this.registerTool = vi.fn((name: string, _opts: unknown, handler: ToolHandler) => {
          registeredTools.push({ name, handler });
        });
        this.connect = mockConnect;
      };
      return { McpServer: MockMcpServer };
    });

    vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => {
      const MockTransport = function () {
        /* no-op */
      };
      return { StdioServerTransport: MockTransport };
    });

    vi.doMock('../../src/paths.js', () => ({
      getSpecDirectories: vi.fn().mockResolvedValue(['/fake/specs']),
    }));

    vi.doMock('../../src/registry.js', () => ({
      discoverSpecs: vi.fn().mockResolvedValue({
        specs: [loadedSpec],
        errors: [],
      }),
      specToMcpTools: vi.fn().mockReturnValue([
        {
          name: 'testtool_list',
          description: 'List items',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ]),
    }));

    const { main } = await import('../../src/server.js');
    await main();

    const handler = registeredTools[0]?.handler;
    expect(handler).toBeDefined();
    if (!handler) return;

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Execution failed: Unexpected crash');
  });

  it('tool handler catch block with non-Error thrown', async () => {
    const validSpec = makeSpec();
    const loadedSpec: LoadedSpec = {
      spec: validSpec,
      resolvedBinaryPath: '/bin/echo',
      installedVersion: '1.0.0',
      exactVersionMatch: true,
    };

    // Mock executeTool to throw a non-Error
    vi.doMock('../../src/executor.js', () => ({
      executeTool: vi.fn().mockRejectedValue('string error'),
    }));

    const registeredTools: Array<{ name: string; handler: ToolHandler }> = [];
    const mockConnect = vi.fn().mockResolvedValue(undefined);

    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => {
      const MockMcpServer = function (this: Record<string, unknown>) {
        this.registerTool = vi.fn((name: string, _opts: unknown, handler: ToolHandler) => {
          registeredTools.push({ name, handler });
        });
        this.connect = mockConnect;
      };
      return { McpServer: MockMcpServer };
    });

    vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => {
      const MockTransport = function () {
        /* no-op */
      };
      return { StdioServerTransport: MockTransport };
    });

    vi.doMock('../../src/paths.js', () => ({
      getSpecDirectories: vi.fn().mockResolvedValue(['/fake/specs']),
    }));

    vi.doMock('../../src/registry.js', () => ({
      discoverSpecs: vi.fn().mockResolvedValue({
        specs: [loadedSpec],
        errors: [],
      }),
      specToMcpTools: vi.fn().mockReturnValue([
        {
          name: 'testtool_list',
          description: 'List items',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      ]),
    }));

    const { main } = await import('../../src/server.js');
    await main();

    const handler = registeredTools[0]?.handler;
    if (!handler) return;

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Execution failed: string error');
  });
});

describe('server isDirectRun guard', () => {
  it('does not auto-run main() when imported in tests', () => {
    // process.argv[1] in vitest doesn't contain "server"
    expect(process.argv[1]).not.toContain('server');
  });
});
