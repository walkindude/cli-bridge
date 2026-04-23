#!/usr/bin/env node
// Score eval runs. Parses stream-json JSONL per trial and emits summary.md + per-task.csv.
//
// Usage: node score.mjs --run-id <id>
//        node score.mjs --run-dir /path/to/results/<id>

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    'run-id': { type: 'string' },
    'run-dir': { type: 'string' },
    'tasks-file': { type: 'string', default: resolve(__dirname, 'tasks.jsonl') },
  },
});

const runDir =
  values['run-dir'] ?? (values['run-id'] ? resolve(__dirname, 'results', values['run-id']) : null);
if (!runDir) {
  console.error('--run-id or --run-dir required');
  process.exit(2);
}

const tasksById = new Map(
  readFileSync(values['tasks-file'], 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .map((t) => [t.id, t]),
);

const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8'));

// MCP tool names in stream-json look like: mcp__<server>__<tool>
// Our server is "cli-bridge", so gosymdb tools are prefixed mcp__cli-bridge__gosymdb_
const CLI_BRIDGE_PREFIX = 'mcp__cli-bridge__';
const GREP_LIKE = new Set(['Bash', 'Grep', 'Glob']);
// Tools we treat as housekeeping rather than answering the question. A
// "primary tool" score should reflect the agent's *navigation* choice, not
// the orientation step. Skill stays in the substantive set — choosing a
// generic skill instead of the gold tool is a real tool-selection miss.
const NON_SUBSTANTIVE = new Set([
  'ToolSearch',
  'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',
]);

/**
 * Parse one trial JSONL file. Returns a per-trial score object.
 */
function scoreTrial({ taskId, treatment, trial, jsonlPath }) {
  let toolUses = [];
  let finalText = '';
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;
  let firstEventTs = null;
  let lastEventTs = null;
  let resultEvent = null;

  let raw;
  try {
    raw = readFileSync(jsonlPath, 'utf8');
  } catch (e) {
    return {
      taskId, treatment, trial,
      error: `read: ${e.message}`,
    };
  }

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try {
      ev = JSON.parse(t);
    } catch {
      continue;
    }
    // Claude Code stream-json events vary by schema version. Handle flexibly.
    if (firstEventTs == null) firstEventTs = Date.now();
    lastEventTs = Date.now();

    // assistant message events carry tool_use content blocks
    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_use') {
          toolUses.push({ name: block.name, input: block.input });
        } else if (block.type === 'text' && typeof block.text === 'string') {
          finalText += block.text;
        }
      }
      const usage = ev.message?.usage;
      if (usage) {
        totalInputTokens += usage.input_tokens ?? 0;
        totalOutputTokens += usage.output_tokens ?? 0;
      }
    }
    // result event at end (from --output-format json or at end of stream-json)
    if (ev.type === 'result') {
      resultEvent = ev;
      if (ev.total_cost_usd != null) totalCostUsd = ev.total_cost_usd;
      if (ev.result && typeof ev.result === 'string' && !finalText) {
        finalText = ev.result;
      }
    }
  }

  const task = tasksById.get(taskId);
  const gold = task?.gold_tool ?? null;
  const goldMcpName = gold ? CLI_BRIDGE_PREFIX + gold : null;

  const toolSequence = toolUses.map((u) => u.name);
  const substantiveSequence = toolSequence.filter((n) => !NON_SUBSTANTIVE.has(n));
  const firstTool = substantiveSequence[0] ?? null;

  const usedGold = goldMcpName ? toolSequence.includes(goldMcpName) : false;
  const primaryIsGold = goldMcpName ? firstTool === goldMcpName : false;
  const primaryIsCliBridge = firstTool != null && firstTool.startsWith(CLI_BRIDGE_PREFIX);
  const usedAnyCliBridge = toolSequence.some((n) => n.startsWith(CLI_BRIDGE_PREFIX));
  const fellBackToGrep = toolSequence.some((n) => GREP_LIKE.has(n) || n === 'Bash');

  // correctness: fragment in final text (case-insensitive)
  let correct = null;
  if (task?.gold_answer_fragment && finalText) {
    correct = finalText.toLowerCase().includes(task.gold_answer_fragment.toLowerCase());
  }

  return {
    taskId,
    treatment,
    trial,
    firstTool,
    toolCount: toolSequence.length,
    usedGold,
    primaryIsGold,
    primaryIsCliBridge,
    usedAnyCliBridge,
    fellBackToGrep,
    correct,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    costUsd: totalCostUsd,
    toolSequence,
    finalTextSnippet: finalText.slice(0, 200),
  };
}

// walk runDir: <runDir>/<taskId>/<treatment>/trial-<n>.jsonl
// Skip task dirs whose id is no longer present in tasks.jsonl (e.g. tasks
// that were removed between the run and the score). Keeps historical runs
// comparable against the current suite without hand-deleting directories.
const scores = [];
for (const taskId of readdirSync(runDir)) {
  const taskDir = join(runDir, taskId);
  if (!statSync(taskDir).isDirectory()) continue;
  if (!tasksById.has(taskId)) continue;
  for (const treatment of readdirSync(taskDir)) {
    const treatmentDir = join(taskDir, treatment);
    if (!statSync(treatmentDir).isDirectory()) continue;
    for (const file of readdirSync(treatmentDir)) {
      const m = file.match(/^trial-(\d+)\.jsonl$/);
      if (!m) continue;
      const trial = parseInt(m[1], 10);
      const jsonlPath = join(treatmentDir, file);
      scores.push(scoreTrial({ taskId, treatment, trial, jsonlPath }));
    }
  }
}

// --- CSV ---
const csvHeader = [
  'task_id', 'treatment', 'trial', 'first_tool', 'tool_count',
  'used_gold', 'primary_is_gold', 'used_any_cli_bridge', 'fell_back_to_grep',
  'correct', 'input_tokens', 'output_tokens', 'cost_usd',
];
const csvLines = [csvHeader.join(',')];
for (const s of scores) {
  csvLines.push([
    s.taskId, s.treatment, s.trial,
    JSON.stringify(s.firstTool ?? ''),
    s.toolCount,
    s.usedGold, s.primaryIsGold, s.usedAnyCliBridge, s.fellBackToGrep,
    s.correct ?? '',
    s.inputTokens, s.outputTokens, s.costUsd?.toFixed(6) ?? '',
  ].join(','));
}
writeFileSync(join(runDir, 'per-task.csv'), csvLines.join('\n'));

// --- summary.md ---
function pct(n, d) {
  if (d === 0) return 'n/a';
  return `${((n / d) * 100).toFixed(0)}%`;
}
function agg(filter) {
  const rows = scores.filter(filter);
  const n = rows.length;
  const usedGold = rows.filter((s) => s.usedGold).length;
  const primaryGold = rows.filter((s) => s.primaryIsGold).length;
  const primaryCliBridge = rows.filter((s) => s.primaryIsCliBridge).length;
  const grepFallback = rows.filter((s) => s.fellBackToGrep).length;
  const correct = rows.filter((s) => s.correct === true).length;
  const correctable = rows.filter((s) => s.correct !== null).length;
  const medianTokens = median(rows.map((s) => s.inputTokens + s.outputTokens));
  const sumCost = rows.reduce((a, s) => a + (s.costUsd ?? 0), 0);
  return {
    n,
    usedGold: pct(usedGold, n),
    primaryGold: pct(primaryGold, n),
    primaryCliBridge: pct(primaryCliBridge, n),
    grepFallback: pct(grepFallback, n),
    correct: correctable > 0 ? pct(correct, correctable) : 'n/a',
    medianTokens,
    sumCost: sumCost.toFixed(4),
  };
}
function median(arr) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const treatments = [...new Set(scores.map((s) => s.treatment))];
const lines = [];
lines.push(`# Eval summary — ${manifest.runId}`);
lines.push('');
lines.push(`- Model: \`${manifest.model}\``);
lines.push(`- Trials per cell: ${manifest.trials}`);
lines.push(`- Tasks: ${manifest.tasks.length} (${manifest.tasks.join(', ')})`);
lines.push(`- Started: ${manifest.startedAt}`);
if (manifest.finishedAt) lines.push(`- Finished: ${manifest.finishedAt} (${manifest.wallTimeSec}s)`);
lines.push('');
lines.push('## Overall (per treatment)');
lines.push('');
lines.push('| treatment | n | primary=gold | primary∈cli-bridge | used gold | grep fallback | correct | median tokens | total $ |');
lines.push('|-----------|---|--------------|-------------------|-----------|---------------|---------|---------------|---------|');
for (const tr of treatments) {
  const a = agg((s) => s.treatment === tr);
  lines.push(`| ${tr} | ${a.n} | ${a.primaryGold} | ${a.primaryCliBridge} | ${a.usedGold} | ${a.grepFallback} | ${a.correct} | ${a.medianTokens} | $${a.sumCost} |`);
}
lines.push('');
lines.push('## Per task');
lines.push('');
lines.push('| task | treatment | primary=gold | first tool (modal) | tokens (median) |');
lines.push('|------|-----------|--------------|--------------------|-----------------|');
for (const taskId of manifest.tasks) {
  for (const tr of treatments) {
    const rows = scores.filter((s) => s.taskId === taskId && s.treatment === tr);
    if (!rows.length) continue;
    const primaryGold = rows.filter((s) => s.primaryIsGold).length;
    const firstTools = rows.map((s) => s.firstTool).filter(Boolean);
    const modal = firstTools.length
      ? [...firstTools.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map()).entries()].sort((a, b) => b[1] - a[1])[0][0]
      : 'n/a';
    const medToks = median(rows.map((s) => s.inputTokens + s.outputTokens));
    lines.push(`| ${taskId} | ${tr} | ${pct(primaryGold, rows.length)} | \`${modal}\` | ${medToks} |`);
  }
}

lines.push('');
lines.push('## Metric definitions');
lines.push('- **primary=gold**: first navigation tool was *exactly* the gold gosymdb tool for the task (strict).');
lines.push('- **primary∈cli-bridge**: first navigation tool was *any* `mcp__cli-bridge__gosymdb_*` tool — credits orientation steps like `health`/`find` before the real query.');
lines.push('- **used gold**: gold tool appeared somewhere in the trial. Tells us whether the agent ever reached it.');
lines.push('- **grep fallback**: agent called `Bash`, `Grep`, or `Glob` at any point.');
lines.push('- **correct**: final answer contains the gold fragment substring (case-insensitive).');
lines.push('- Housekeeping tools (`ToolSearch`, `TaskCreate`, etc.) are excluded when computing "first tool".');
lines.push('');
lines.push('## Decision thresholds (draft)');
lines.push('- Primary (treatment, Sonnet): `primary=gold >= 70%` OR `primary∈cli-bridge >= 90%`');
lines.push('- Secondary: treatment median tokens < control median tokens');
lines.push('- Sanity: control `grep fallback > 50%`');

writeFileSync(join(runDir, 'summary.md'), lines.join('\n') + '\n');

// also dump raw scores for debugging
writeFileSync(join(runDir, 'scores.json'), JSON.stringify(scores, null, 2));

console.log(`wrote ${join(runDir, 'summary.md')}`);
console.log(`wrote ${join(runDir, 'per-task.csv')}`);
console.log(`wrote ${join(runDir, 'scores.json')}`);
