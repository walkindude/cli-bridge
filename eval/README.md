# cli-bridge eval harness

Objective: measure whether a fresh Claude Code session, with cli-bridge
loaded and **no other nudges**, reaches for `gosymdb_*` tools on Go-semantic
questions vs falling back to `grep`/`Bash`.

The headline number is **primary hit rate**: fraction of trials where the
agent's first tool call is the "gold" gosymdb tool for that task.

## Layout

- `tasks.jsonl` — 10 natural-language tasks targeting gin. Each has an
  `id`, `prompt`, `gold_tool`, and optional `gold_answer_fragment`.
- `runner.mjs` — spawns `claude -p --bare --output-format stream-json` per
  (task × treatment × trial), writes JSONL to `results/<run-id>/...`.
- `score.mjs` — parses JSONL, emits `per-task.csv`, `summary.md`, `scores.json`.
- `mcp-treatment.json` — loads cli-bridge MCP server (dist/server.js).
- `mcp-control.json` — empty MCP config (agent has Bash/Grep/Read only).
- `targets/gin/` — clone of gin-gonic/gin with `gosymdb.sqlite` pre-built. Gitignored.
- `results/` — per-run output. Gitignored.

## Setup

```bash
cd ~/src/cli-bridge
pnpm install && pnpm run build   # build dist/server.js for treatment arm

# Clone gin and index it OUTSIDE any CLAUDE.md chain — critical for isolation.
# (gin itself is CLAUDE.md-free, but the cli-bridge repo tree above has one
# we don't want auto-loaded by the eval agent.)
./eval/setup.sh
```

## Treatment-arm MCP config

`mcp-treatment.json` (committed) assumes `cli-bridge` is on PATH — the
production install path (`npm install -g cli-bridge`). For local dev,
copy the included template:

```bash
cp eval/mcp-treatment.local.json.example eval/mcp-treatment.local.json
# edit the absolute path to match your checkout
```

The runner prefers `mcp-treatment.local.json` when it exists (gitignored).

## Smoke test (1 task × 1 treatment × 1 trial)

```bash
node eval/runner.mjs --trials 1 --treatments treatment --task-filter t01
node eval/score.mjs --run-id <run-id printed above>
```

Open the emitted `summary.md` and confirm the trial has `primary=gold=100%`
(it should — the task is a clean match).

## Full run

```bash
# Sonnet primary: 10 tasks × 2 treatments × 3 trials = 60 invocations
node eval/runner.mjs --model sonnet --trials 3

# Haiku spike: 10 × 2 × 1 = 20 invocations, much cheaper
node eval/runner.mjs --model claude-haiku-4-5-20251001 --trials 1 --run-id haiku-spike
```

Each invocation is budget-capped at `$0.50` via `--max-budget-usd`.

## Bias controls baked in

- `--bare` — disables CLAUDE.md auto-discovery, hooks, memory, prefetch, plugin sync.
  The single most important control: nothing whispers "use gosymdb" to the agent.
- `--strict-mcp-config` + separate treatment/control configs — treatment
  loads cli-bridge; control has `{"mcpServers":{}}`.
- `--no-session-persistence` — trials are isolated.
- Target dir is gin (third-party repo, no CLAUDE.md). Not gosymdb itself.
- Task prompts are phrased naively: no mention of "gosymdb", "call graph",
  "index", "typed". A teammate would ask them this way.

## Decision thresholds (draft)

- **Primary** (Sonnet, treatment): `primary=gold >= 70%`. Ships if met.
- **Secondary**: treatment median tokens < control median tokens.
- **Sanity**: control `grep fallback > 50%` (otherwise the tasks weren't hard enough).
- **Haiku spike**: treatment should beat its own control by ≥ 30 percentage points.
  Proves MCP fixes tool selection even for small models.

If the primary threshold isn't met, the iteration lever is the gosymdb spec's
`triggers.positive` and per-command `description` fields — hand-tune and
re-run. That's the product loop.
