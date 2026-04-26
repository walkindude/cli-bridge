import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { validateSpec } from './schema.js';
import { ok, err } from './types.js';
import type { CliToolSpec } from './schema.js';
import type { Result } from './types.js';

/**
 * Result of a successful auto-refresh: the freshly-validated spec and the path
 * we wrote it to. Callers swap the stale spec for {@link spec} in-place.
 */
export interface RefreshSuccess {
  spec: CliToolSpec;
  writtenPath: string;
}

/**
 * Attempts to refresh a stale spec by asking the binary itself for its current
 * manifest via the canonical `<binary> cli-bridge-manifest` convention.
 *
 * The convention is opt-in: tools that follow it (e.g. gosymdb, cairn) can
 * keep cli-bridge in sync across version bumps without users having to
 * re-run /cli-bridge:register every time. Tools that don't expose the
 * subcommand fall through and the caller logs the original drift warning.
 *
 * Best-effort: any failure returns a Result with the reason and leaves the
 * stale spec in place. Refresh must never break a working setup.
 */
export async function tryAutoRefreshSpec(
  toolName: string,
  binaryPath: string,
  installedVersion: string,
  toolSpecDir: string,
): Promise<Result<RefreshSuccess, string>> {
  // Step 1: ask the binary for its manifest. Short timeout — manifest
  // emission should be near-instant for any tool following the convention.
  const manifestResult = await runManifest(binaryPath);
  if (!manifestResult.ok) {
    return manifestResult;
  }

  // Step 2: parse + validate before we trust anything from stdout.
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestResult.value) as unknown;
  } catch {
    return err(`${toolName} cli-bridge-manifest output is not valid JSON`);
  }

  const validation = validateSpec(parsed);
  if (!validation.ok) {
    const summary = validation.error.map((e) => `${e.path}: ${e.message}`).join(', ');
    return err(`${toolName} cli-bridge-manifest output failed spec validation: ${summary}`);
  }

  // Step 3: write the fresh spec next to the stale one. Filename is the
  // installed version so the existing version-resolution logic picks it up.
  const writtenPath = join(toolSpecDir, `${installedVersion}.json`);
  try {
    await fs.writeFile(writtenPath, manifestResult.value, 'utf-8');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to write refreshed spec to ${writtenPath}: ${message}`);
  }

  return ok({ spec: validation.value, writtenPath });
}

/** Runs `<binary> cli-bridge-manifest` and returns stdout, or an error. */
function runManifest(binaryPath: string): Promise<Result<string, string>> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['cli-bridge-manifest'],
      { timeout: 5000, maxBuffer: 5 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve(err(`cli-bridge-manifest invocation failed: ${error.message}`));
          return;
        }
        if (!stdout || stdout.trim().length === 0) {
          resolve(err('cli-bridge-manifest produced no output'));
          return;
        }
        resolve(ok(stdout));
      },
    );
  });
}
