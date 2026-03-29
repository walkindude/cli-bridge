import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ok, err } from './types.js';
import type { Result, ResolveError, VersionDetectError } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Resolves a binary name to an absolute path using `which`.
 */
export async function resolveBinary(binary: string): Promise<Result<string, ResolveError>> {
  try {
    const { stdout } = await execFileAsync('which', [binary]);
    return ok(stdout.trim());
  } catch {
    return err({ binary, message: `Binary not found in PATH: ${binary}` });
  }
}

/**
 * Detects the installed version of a binary.
 */
export async function detectVersion(
  binaryPath: string,
  detection?: { command: string; pattern: string }
): Promise<Result<string, VersionDetectError>> {
  const commands = detection
    ? [detection.command]
    : ['--version', 'version', '-v', '-V'];
  const pattern = detection?.pattern ?? 'v?(\\d+\\.\\d+[.\\d+]*)';
  const attemptedCommands: string[] = [];

  for (const cmd of commands) {
    const args = cmd.split(' ').filter(Boolean);
    attemptedCommands.push(cmd);
    try {
      const { stdout, stderr } = await execFileAsync(binaryPath, args, { timeout: 5000 }).catch(
        async (e: unknown) => {
          if (e && typeof e === 'object' && 'stdout' in e) {
            return e as { stdout: string; stderr: string };
          }
          throw e;
        }
      );
      const output = stdout + stderr;
      const regex = new RegExp(pattern);
      const match = regex.exec(output);
      if (match?.[1]) {
        return ok(match[1]);
      }
    } catch {
      // try next
    }
  }

  return err({
    binary: binaryPath,
    attemptedCommands,
    message: `Could not detect version for ${binaryPath}`,
  });
}

/**
 * Given a tool directory, returns the best matching spec file for the installed version.
 */
export async function resolveSpecVersion(
  toolDir: string,
  installedVersion: string
): Promise<Result<{ specPath: string; exactMatch: boolean }, ResolveError>> {
  let entries: string[];
  try {
    const dirents = await fs.readdir(toolDir);
    entries = dirents.filter((f) => f.endsWith('.json'));
  } catch {
    return err({ binary: toolDir, message: `Could not read directory: ${toolDir}` });
  }

  if (entries.length === 0) {
    return err({ binary: toolDir, message: `No spec files found in ${toolDir}` });
  }

  const versions = entries.map((f) => f.replace(/\.json$/, ''));

  // Exact match
  if (versions.includes(installedVersion)) {
    return ok({
      specPath: join(toolDir, `${installedVersion}.json`),
      exactMatch: true,
    });
  }

  // Highest semver
  const sorted = versions.sort((a, b) => compareSemver(b, a));
  const best = sorted[0];
  if (!best) {
    return err({ binary: toolDir, message: `No valid spec versions in ${toolDir}` });
  }
  return ok({
    specPath: join(toolDir, `${best}.json`),
    exactMatch: false,
  });
}

function compareSemver(a: string, b: string): number {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
