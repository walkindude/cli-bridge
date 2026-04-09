import { build } from 'esbuild';

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
