#!/usr/bin/env node
// Eval runner for cli-bridge × gosymdb.
// For each (task × treatment × trial), spawns `claude -p` with the bias
// controls listed in eval/README.md (no session persistence, strict MCP
// config, no slash commands, /tmp isolate) and streams JSONL output to disk.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EVAL_DIR = __dirname;
// Target dir is the /tmp isolate written by eval/setup (escapes any CLAUDE.md
// chain). Setup writes the absolute path into current-isolate.txt; the runner
// just reads it.
const ISOLATE_PATH = resolve(EVAL_DIR, 'current-isolate.txt');
const TARGET_DIR = readFileSync(ISOLATE_PATH, 'utf8').trim();
if (!TARGET_DIR) {
  throw new Error(`${ISOLATE_PATH} is empty — run eval/setup.sh or write an absolute target-dir path.`);
}
// Prefer a gitignored local override if present. This lets contributors point
// treatment at a locally-built dist/server.js without editing the committed
// config that uses the `cli-bridge` on PATH.
import { existsSync } from 'node:fs';
const MCP_TREATMENT_DEFAULT = resolve(EVAL_DIR, 'mcp-treatment.json');
const MCP_TREATMENT_LOCAL = resolve(EVAL_DIR, 'mcp-treatment.local.json');
const MCP_TREATMENT = existsSync(MCP_TREATMENT_LOCAL) ? MCP_TREATMENT_LOCAL : MCP_TREATMENT_DEFAULT;
const MCP_CONTROL = resolve(EVAL_DIR, 'mcp-control.json');
const RESULTS_DIR = resolve(EVAL_DIR, 'results');

const { values } = parseArgs({
  options: {
    model: { type: 'string', default: 'sonnet' },
    trials: { type: 'string', default: '3' },
    'run-id': { type: 'string', default: new Date().toISOString().replace(/[:.]/g, '-') },
    concurrency: { type: 'string', default: '3' },
    'tasks-file': { type: 'string', default: resolve(EVAL_DIR, 'tasks.jsonl') },
    treatments: { type: 'string', default: 'treatment,control' },
    'max-budget': { type: 'string', default: '0.50' },
    'dry-run': { type: 'boolean', default: false },
    'task-filter': { type: 'string' },
  },
});

const trials = parseInt(values.trials, 10);
const concurrency = parseInt(values.concurrency, 10);
const runId = values['run-id'];
const runDir = join(RESULTS_DIR, runId);
const treatments = values.treatments.split(',').map((s) => s.trim());

const tasks = readFileSync(values['tasks-file'], 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const filtered = values['task-filter']
  ? tasks.filter((t) => t.id.includes(values['task-filter']))
  : tasks;

console.log(
  `[runner] run-id=${runId} model=${values.model} trials=${trials} tasks=${filtered.length} treatments=${treatments.join(',')} concurrency=${concurrency} target=${TARGET_DIR}`,
);

mkdirSync(runDir, { recursive: true });
writeFileSync(
  join(runDir, 'manifest.json'),
  JSON.stringify(
    {
      runId,
      model: values.model,
      trials,
      tasks: filtered.map((t) => t.id),
      treatments,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);

/** @returns {Promise<{durationMs:number, exitCode:number|null, outputPath:string}>} */
function runOne({ task, treatment, trial }) {
  const taskDir = join(runDir, task.id, treatment);
  mkdirSync(taskDir, { recursive: true });
  const outPath = join(taskDir, `trial-${trial}.jsonl`);
  const errPath = join(taskDir, `trial-${trial}.stderr.log`);

  const mcpConfig = treatment === 'treatment' ? MCP_TREATMENT : MCP_CONTROL;

  const args = [
    '-p',
    task.prompt,
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model',
    values.model,
    '--no-session-persistence',
    '--permission-mode',
    'bypassPermissions',
    '--max-budget-usd',
    values['max-budget'],
    '--mcp-config',
    mcpConfig,
    '--strict-mcp-config',
    // Kill user-level slash-command skills (e.g., /go:impact) so the eval
    // measures pure MCP tool selection. Without this, the agent can reach
    // gosymdb indirectly via skills that wrap it, confounding the signal.
    '--disable-slash-commands',
  ];

  if (values['dry-run']) {
    console.log(`[dry] claude ${args.map((a) => JSON.stringify(a)).join(' ')}  (cwd=${TARGET_DIR})  → ${outPath}`);
    return Promise.resolve({ durationMs: 0, exitCode: 0, outputPath: outPath });
  }

  return new Promise((resolvePromise) => {
    const start = Date.now();
    const child = spawn('claude', args, {
      cwd: TARGET_DIR,
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.local/share/mise/shims:${process.env.PATH}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const outStream = createWriteStream(outPath);
    const errStream = createWriteStream(errPath);
    child.stdout.pipe(outStream);
    child.stderr.pipe(errStream);

    // Hard wall-clock cap: 5 min per invocation.
    const killer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5 * 60 * 1000);

    child.on('exit', (code) => {
      clearTimeout(killer);
      const durationMs = Date.now() - start;
      console.log(
        `[runner] ${task.id}/${treatment}/trial-${trial} exit=${code} dur=${Math.round(durationMs / 1000)}s → ${outPath}`,
      );
      resolvePromise({ durationMs, exitCode: code, outputPath: outPath });
    });
  });
}

// Build the full matrix.
const work = [];
for (const task of filtered) {
  for (const treatment of treatments) {
    for (let trial = 1; trial <= trials; trial++) {
      work.push({ task, treatment, trial });
    }
  }
}

console.log(`[runner] ${work.length} invocations total`);

// Simple concurrency pool.
async function pool(items, limit, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const started = Date.now();
const results = await pool(work, concurrency, runOne);
const elapsed = Math.round((Date.now() - started) / 1000);

writeFileSync(
  join(runDir, 'manifest.json'),
  JSON.stringify(
    {
      runId,
      model: values.model,
      trials,
      tasks: filtered.map((t) => t.id),
      treatments,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date().toISOString(),
      wallTimeSec: elapsed,
      invocations: results.length,
    },
    null,
    2,
  ),
);

console.log(`[runner] done in ${elapsed}s. results at ${runDir}`);
