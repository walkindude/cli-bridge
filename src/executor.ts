import { execFile } from 'node:child_process';
import type { CommandDef } from './schema.js';
import type { LoadedSpec } from './registry.js';
import type { ToolResult } from './types.js';

/**
 * Executes a CLI command based on a spec and user-provided input.
 */
export async function executeTool(
  loadedSpec: LoadedSpec,
  command: CommandDef,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const args: string[] = [];

  // Append command name (unless "run")
  if (command.name !== 'run') {
    args.push(command.name);
  }

  // Global flags
  for (const flag of loadedSpec.spec.globalFlags ?? []) {
    const value = input[flag.name];
    if (value === undefined) continue;
    appendFlag(args, flag.name, flag.type, value);
  }

  // Command-specific flags
  for (const flag of command.flags ?? []) {
    const value = input[flag.name];
    if (value === undefined) continue;
    appendFlag(args, flag.name, flag.type, value);
  }

  // Positional args
  for (const arg of command.args ?? []) {
    const value = input[arg.name];
    if (value !== undefined) {
      args.push(typeof value === 'string' ? value : JSON.stringify(value));
    }
  }

  const timeout = command.timeoutMs ?? 30000;
  const maxBuffer = 10 * 1024 * 1024; // 10 MB
  const start = Date.now();

  return new Promise<ToolResult>((resolve) => {
    const child = execFile(
      loadedSpec.resolvedBinaryPath,
      args,
      { timeout, maxBuffer },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        const exitCode =
          error && 'code' in error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({
          stdout,
          stderr,
          exitCode,
          durationMs,
        });
      },
    );
    // Ensure timeout is treated correctly
    void child;
  });
}

function appendFlag(
  args: string[],
  name: string,
  type: 'string' | 'number' | 'boolean' | 'path',
  value: unknown,
): void {
  if (type === 'boolean') {
    if (value === true) {
      args.push(`--${name}`);
    }
    // false: omit
  } else {
    args.push(`--${name}`, String(value));
  }
}
