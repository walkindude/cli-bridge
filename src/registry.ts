import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { validateSpec } from './schema.js';
import { resolveBinary, detectVersion, resolveSpecVersion } from './resolver.js';
import { tryAutoRefreshSpec } from './refresh.js';
import type { CliToolSpec, CommandDef, FlagDef } from './schema.js';
import type { Result, SpecLoadError, VersionDetectError } from './types.js';

export interface LoadedSpec {
  spec: CliToolSpec;
  resolvedBinaryPath: string;
  installedVersion: string;
  exactVersionMatch: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Discovers and loads all valid specs from all spec directories.
 */
export async function discoverSpecs(
  specDirs: string[],
): Promise<{ specs: LoadedSpec[]; errors: SpecLoadError[] }> {
  const specs: LoadedSpec[] = [];
  const errors: SpecLoadError[] = [];
  const seenTools = new Set<string>();

  for (const specDir of specDirs) {
    let toolDirs: string[];
    try {
      const entries = await fs.readdir(specDir, { withFileTypes: true });
      toolDirs = entries.filter((e) => e.isDirectory()).map((e) => join(specDir, e.name));
    } catch {
      continue;
    }

    for (const toolDir of toolDirs) {
      const toolName = toolDir.split('/').pop() ?? toolDir;

      if (seenTools.has(toolName)) continue;

      // Resolve binary
      const binaryResult = await resolveBinary(toolName);
      if (!binaryResult.ok) {
        errors.push({
          specPath: toolDir,
          message: `Binary not found: ${binaryResult.error.message}`,
        });
        continue;
      }

      // Detect version — first try default detection, then fall back to
      // patterns from candidate spec files (handles freeform versions like "dev")
      let versionResult = await detectVersion(binaryResult.value);
      if (!versionResult.ok) {
        versionResult = await detectVersionFromSpecs(binaryResult.value, toolDir);
      }
      if (!versionResult.ok) {
        errors.push({
          specPath: toolDir,
          message: `Version detection failed: ${versionResult.error.message}`,
        });
        continue;
      }

      // Resolve spec version
      const specVersionResult = await resolveSpecVersion(toolDir, versionResult.value);
      if (!specVersionResult.ok) {
        errors.push({
          specPath: toolDir,
          message: `Spec resolution failed: ${specVersionResult.error.message}`,
        });
        continue;
      }

      const { specPath, exactMatch } = specVersionResult.value;

      // Load and validate spec
      let raw: string;
      try {
        raw = await fs.readFile(specPath, 'utf-8');
      } catch {
        errors.push({ specPath, message: 'Could not read spec file' });
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        errors.push({ specPath, message: 'Invalid JSON in spec file' });
        continue;
      }

      const validation = validateSpec(parsed);
      if (!validation.ok) {
        errors.push({
          specPath,
          message: `Spec validation failed: ${validation.error.map((e) => `${e.path}: ${e.message}`).join(', ')}`,
        });
        continue;
      }

      let activeSpec = validation.value;
      let activeExactMatch = exactMatch;

      if (!exactMatch) {
        // Try the canonical auto-refresh path: ask the binary itself for its
        // current manifest. Tools following the convention stay in lockstep
        // across version bumps without manual re-registration.
        const refreshed = await tryAutoRefreshSpec(
          toolName,
          binaryResult.value,
          versionResult.value,
          toolDir,
        );

        if (refreshed.ok) {
          console.error(
            `[cli-bridge] auto-refreshed spec for ${toolName} to v${versionResult.value} (was v${activeSpec.binaryVersion})`,
          );
          activeSpec = refreshed.value.spec;
          activeExactMatch = true;
        } else {
          console.error(
            `[cli-bridge] spec for ${toolName} was generated against v${activeSpec.binaryVersion}, installed binary is v${versionResult.value}`,
          );
          console.error(
            `[cli-bridge]   auto-refresh unavailable (${refreshed.error}); re-run /cli-bridge:register ${toolName} or write ${toolDir}/${versionResult.value}.json by hand`,
          );
        }
      }

      seenTools.add(toolName);
      specs.push({
        spec: activeSpec,
        resolvedBinaryPath: binaryResult.value,
        installedVersion: versionResult.value,
        exactVersionMatch: activeExactMatch,
      });
    }
  }

  return { specs, errors };
}

/**
 * Converts a validated spec into MCP tool definitions.
 *
 * Per-tool descriptions carry only the command's own description. Spec-level
 * routing guidance (triggers) is exposed once via {@link renderTriggers} and
 * carried in the MCP server's `instructions` field — see src/server.ts.
 */
export function specToMcpTools(spec: CliToolSpec): ToolDefinition[] {
  return spec.commands.map((command) => {
    const description = command.description;

    const allFlags: FlagDef[] = [...(spec.globalFlags ?? []), ...(command.flags ?? [])];

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    // Args
    for (const arg of command.args ?? []) {
      properties[arg.name] = {
        type: mapType(arg.type),
        description: arg.description,
      };
      if (arg.required) {
        required.push(arg.name);
      }
    }

    // Flags
    for (const flag of allFlags) {
      const prop: Record<string, unknown> = {
        type: mapType(flag.type),
        description: flag.description,
      };
      if (flag.enum) {
        prop['enum'] = flag.enum;
      }
      if (flag.default !== undefined) {
        prop['default'] = flag.default;
      }
      properties[flag.name] = prop;
      if (flag.required) {
        required.push(flag.name);
      }
    }

    return {
      name: `${spec.name}_${command.name}`,
      description,
      inputSchema: {
        type: 'object',
        properties,
        required,
      },
    };
  });
}

function mapType(t: 'string' | 'number' | 'boolean' | 'path'): string {
  if (t === 'path') return 'string';
  return t;
}

/**
 * Renders a spec's routing triggers as a single block. Used by the server to
 * assemble the MCP `instructions` field — one block per loaded spec, instead
 * of inlining the same text into every tool's description.
 */
export function renderTriggers(spec: CliToolSpec): string {
  const positive = spec.triggers.positive.join(' ');
  const negative = spec.triggers.negative.join(' ');
  return `USE: ${positive}\nDO NOT USE: ${negative}`;
}

/**
 * Fallback version detection: reads spec files from the tool directory and
 * retries detectVersion with each spec's versionDetection config. Handles
 * tools with freeform versions (e.g. "dev") that don't match the default pattern.
 */
async function detectVersionFromSpecs(
  binaryPath: string,
  toolDir: string,
): Promise<Result<string, VersionDetectError>> {
  let files: string[];
  try {
    files = (await fs.readdir(toolDir)).filter((f) => f.endsWith('.json'));
  } catch {
    return {
      ok: false,
      error: {
        binary: binaryPath,
        attemptedCommands: [],
        message: 'Could not read tool directory',
      },
    };
  }

  for (const file of files) {
    try {
      const raw = await fs.readFile(join(toolDir, file), 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const vd = parsed['versionDetection'] as { command?: string; pattern?: string } | undefined;
      if (vd?.command && vd.pattern) {
        const result = await detectVersion(binaryPath, {
          command: vd.command,
          pattern: vd.pattern,
        });
        if (result.ok) return result;
      }
    } catch {
      // try next
    }
  }

  return {
    ok: false,
    error: {
      binary: binaryPath,
      attemptedCommands: [],
      message: 'No spec versionDetection pattern matched',
    },
  };
}

/**
 * Loads a spec from a specific command definition (for use in executor).
 */
export function findCommand(spec: CliToolSpec, commandName: string): CommandDef | undefined {
  return spec.commands.find((c) => c.name === commandName);
}
