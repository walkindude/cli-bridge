#!/usr/bin/env node
// check-versions.mjs — guards against package.json / plugin.json version skew.
//
// The plugin manifest at .claude-plugin/plugin.json must carry the same
// version as package.json. The two were silently out of sync between v0.1.0
// and v0.1.2 and the only thing that caught it was eyeballing the file.
// This script catches it deterministically.
//
// Run via `pnpm run check:versions` (CI), or as a lefthook pre-commit hook
// when either file is staged. Exit 0 on match, exit 1 on mismatch with a
// human-readable diff.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = [
  { path: 'package.json', label: 'package.json' },
  { path: '.claude-plugin/plugin.json', label: '.claude-plugin/plugin.json' },
];

const observed = TARGETS.map(({ path, label }) => {
  const text = readFileSync(resolve(ROOT, path), 'utf8');
  const json = JSON.parse(text);
  if (typeof json.version !== 'string' || json.version.length === 0) {
    console.error(`check-versions: ${label} has no usable "version" field.`);
    process.exit(1);
  }
  return { label, version: json.version };
});

const versions = new Set(observed.map((o) => o.version));
if (versions.size === 1) {
  console.log(`check-versions: ok (${observed[0].version})`);
  process.exit(0);
}

console.error('check-versions: version mismatch.');
for (const { label, version } of observed) {
  console.error(`  ${label}: ${version}`);
}
console.error(
  '\nBump both files to the same value before committing. ' +
    'They are released as a single artifact (the npm package and the ' +
    'Claude Code plugin manifest), so divergence ships a confused release.'
);
process.exit(1);
