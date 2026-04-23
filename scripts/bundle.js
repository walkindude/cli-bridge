import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * Resolve the build-time version string.
 *   1. If HEAD is at an annotated tag: use the tag (strip leading v).
 *   2. Otherwise: dev-<short-sha>.
 *   3. Fallback: "0.1.0-dev" if not in a git checkout.
 */
function resolveVersion() {
  try {
    const tag = execSync('git describe --tags --exact-match HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (tag) return tag.replace(/^v/, '');
  } catch {}
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (sha) return `dev-${sha}`;
  } catch {}
  return '0.1.0-dev';
}

const version = resolveVersion();

// Patch dist/server.js to replace the version placeholder BEFORE esbuild
// bundles it. server.ts uses the literal string "__CLI_BRIDGE_VERSION__"
// which is preserved through tsc and substituted here.
const serverPath = 'dist/server.js';
const src = readFileSync(serverPath, 'utf8');
const patched = src.replaceAll('__CLI_BRIDGE_VERSION__', version);
writeFileSync(serverPath, patched);

console.log(`[bundle] version = ${version}`);

await build({
  entryPoints: ['dist/server.js'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/cli-bridge.js',
  banner: { js: '#!/usr/bin/env node' },
  external: [],
});
