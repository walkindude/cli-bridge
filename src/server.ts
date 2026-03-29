import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getSpecDirectories } from './paths.js';
import { discoverSpecs, specToMcpTools } from './registry.js';
import { executeTool } from './executor.js';
import { parseOutput } from './parser.js';
import type { LoadedSpec } from './registry.js';
import type { CommandDef } from './schema.js';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main(): Promise<void> {
  const specDirs = await getSpecDirectories(process.cwd(), __dirname);

  const { specs, errors } = await discoverSpecs(specDirs);

  for (const error of errors) {
    console.error(`[cli-bridge] Failed to load spec: ${error.specPath}: ${error.message}`);
  }

  console.error(`[cli-bridge] Loaded ${specs.length} tool specs from ${specDirs.length} directories`);

  const server = new McpServer({
    name: 'cli-bridge',
    version: '0.1.0',
  });

  // Build a map from tool name → { loadedSpec, command }
  const toolMap = new Map<string, { loadedSpec: LoadedSpec; command: CommandDef }>();

  for (const loadedSpec of specs) {
    const toolDefs = specToMcpTools(loadedSpec.spec);
    for (const toolDef of toolDefs) {
      // Find the command for this tool
      const commandName = toolDef.name.slice(loadedSpec.spec.name.length + 1);
      const command = loadedSpec.spec.commands.find((c) => c.name === commandName);
      if (!command) continue;
      toolMap.set(toolDef.name, { loadedSpec, command });

      // Build zod schema from inputSchema
      const zodProps: Record<string, z.ZodTypeAny> = {};
      for (const [propName, propDef] of Object.entries(toolDef.inputSchema.properties)) {
        const def = propDef as Record<string, unknown>;
        const isRequired = toolDef.inputSchema.required.includes(propName);
        let zodType: z.ZodTypeAny;
        switch (def['type']) {
          case 'number':
            zodType = z.number();
            break;
          case 'boolean':
            zodType = z.boolean();
            break;
          default:
            if (def['enum'] && Array.isArray(def['enum']) && def['enum'].length >= 1) {
              const enumVals = def['enum'] as [string, ...string[]];
              zodType = z.enum(enumVals);
            } else {
              zodType = z.string();
            }
        }
        if (def['description'] && typeof def['description'] === 'string') {
          zodType = zodType.describe(def['description']);
        }
        zodProps[propName] = isRequired ? zodType : zodType.optional();
      }

      server.registerTool(
        toolDef.name,
        {
          description: toolDef.description,
          inputSchema: zodProps,
        },
        async (params: Record<string, unknown>) => {
          const entry = toolMap.get(toolDef.name);
          if (!entry) {
            return {
              content: [{ type: 'text' as const, text: `Tool ${toolDef.name} not found` }],
              isError: true,
            };
          }

          try {
            const result = await executeTool(entry.loadedSpec, entry.command, params);
            const content = parseOutput(result.stdout, entry.command.output);

            if (result.exitCode !== 0) {
              return {
                content: [
                  { type: 'text' as const, text: content.text },
                  { type: 'text' as const, text: `[exit code: ${result.exitCode}]\n${result.stderr}` },
                ],
                isError: true,
              };
            }

            return { content: [{ type: 'text' as const, text: content.text }] };
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return {
              content: [{ type: 'text' as const, text: `Execution failed: ${message}` }],
              isError: true,
            };
          }
        }
      );
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e: unknown) => {
  console.error('[cli-bridge] Fatal error:', e);
  process.exit(1);
});
