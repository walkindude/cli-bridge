# Does cli-bridge work?

Results from a controlled eval designed to answer one question: **when cli-bridge is loaded, does a coding agent actually reach for the MCP tools it registers, or does it fall back to `grep` / `Bash` the way it was trained to?**

## TL;DR

Two models, 9 Go-semantic tasks against `gin-gonic/gin`. Treatment = cli-bridge loaded; control = plugin unloaded, agent has `Bash`/`Grep`/`Read` only.

|  | Sonnet 4.6 (27 trials/arm) | Haiku 4.5 (9 trials/arm) |
|---|---|---|
| **First navigation tool was an MCP gosymdb tool** | **100% vs 0%** | **78% vs 0%** |
| First navigation tool was *exactly* the gold tool | 56% vs 0% | 44% vs 0% |
| Gold tool called anywhere in the trial | 96% vs 0% | 67% vs 0% |
| Ever called `Bash` / `Grep` / `Glob` | **4% vs 100%** | 33% vs 100% |
| Final answer correct | **100% vs 100%** | **100% vs 89%** |
| Median tokens per task | 67 vs 65 | 112 vs 124 |
| Total API cost across all trials | **$1.43 vs $2.51** (**−43%**) | **$0.42 vs $0.85** (**−51%**) |

**Sonnet:** in 27 of 27 trials the first navigation tool was a `gosymdb_*` MCP tool. Essentially never falls back to grep (4% = 1 trial out of 27). Final answer correct 100% of the time.

**Haiku:** smaller model, noisier tool selection — hedges more often by also running a grep in 33% of treatment trials — but still flips the first-tool distribution by 78 percentage points and is **100% correct vs 89% for control**.

**Both models cost roughly half as much with cli-bridge loaded.**

## Methodology

### What we measured

For each trial, the scorer reads Claude Code's `stream-json` event log and extracts the ordered list of tool calls the agent made. Classification per trial:

- **`primary=gold`** — was the agent's *first* navigation tool (excluding housekeeping like `ToolSearch` / `TaskCreate`) *exactly* the gold gosymdb tool for the task? Strict.
- **`primary∈cli-bridge`** — was the first navigation tool *any* gosymdb MCP tool? Credits orientation steps (`gosymdb_def` to resolve a short name before `blast-radius`, `gosymdb_health` to sanity-check the index) which are the workflow gosymdb's own docs recommend.
- **`used gold`** — did the gold tool appear anywhere in the trial, first or later?
- **`grep fallback`** — did the agent call `Bash`, `Grep`, or `Glob` at any point?
- **`correct`** — does the final answer contain the expected fragment (case-insensitive)?

Token counts and USD cost come directly from Claude Code's `stream-json` `result` events. Not extrapolated.

### Bias controls

The biggest risk is accidentally whispering "use gosymdb" to the agent. Controls applied:

- **Target repo is `gin-gonic/gin`** (third-party Go project, no CLAUDE.md), cloned to `/tmp/gosymdb-eval-<timestamp>/`. Walking up from there to `/` passes zero CLAUDE.md files. Completely outside any gosymdb-aware context.
- **No gosymdb-aware skills installed** in `~/.claude/commands/`. An earlier iteration had `/go:impact`, `/go:sym`, `/go:trace` skills that wrapped gosymdb calls — these were removed before the final run to isolate the pure MCP effect.
- **Task prompts audited for leakage.** No prompt mentions "gosymdb", "call graph", "index", "typed", or similar. See [`tasks.jsonl`](tasks.jsonl). Each prompt is phrased as a teammate would ask.
- **Control arm:** same flags, cwd, model, permission settings — only `--mcp-config` differs (`{"mcpServers":{}}` vs the cli-bridge stdio config).
- **`--no-session-persistence` + fresh `/tmp` dir + `--strict-mcp-config` + `--disable-slash-commands`.** Every trial is isolated.

### Tasks

9 natural-language Go-semantic questions targeting gin symbols:

| id | prompt shape | gold tool |
|---|---|---|
| t01_callers | who calls `Context.JSON`? | `gosymdb_callers` |
| t02_blast_radius | what breaks if I change `gin.New`'s signature? | `gosymdb_blast-radius` |
| t03_implementors | what types implement `IRouter`? | `gosymdb_implementors` |
| t04_callees | what does `gin.Default` call internally? | `gosymdb_callees` |
| t05_references | where is `gin.Context` used as a value? | `gosymdb_references` |
| t06_dead | any unused unexported funcs in `gin`? | `gosymdb_dead` |
| t07_find_by_file | list symbols in `routergroup.go` | `gosymdb_find` |
| t08_def | exact signature of `RouterGroup.Handle` | `gosymdb_def` |
| t10_health | how complete is the static analysis? | `gosymdb_health` |

Exact prompts in [`tasks.jsonl`](tasks.jsonl). Gold fragment strings for correctness checking are in the same file.

## Detailed results

### `sonnet-full` — 9 tasks × 2 treatments × 3 trials = 54 invocations

Model: `claude-sonnet-4-6`. Total wall time: 13m 43s (concurrency 3). Total cost: $3.94 both arms combined.

Per-task breakdown (treatment arm — control is 0% across the board for gosymdb-related columns):

| task | primary=gold | used-gold | first tool (modal) | median tokens treatment / control |
|---|---|---|---|---|
| t01_callers | 67% | 3/3 | `gosymdb_callers` | 85 / 28 |
| t02_blast_radius | 0% | 2/3 | `gosymdb_health` | 76 / 155 |
| t03_implementors | 100% | 3/3 | `gosymdb_implementors` | 49 / 14 |
| t04_callees | 0% | 3/3 | `gosymdb_def` | 65 / 60 |
| t05_references | 0% | 3/3 | `gosymdb_health` | 152 / 265 |
| t06_dead | 33% | 3/3 | `gosymdb_health` | 90 / 229 |
| t07_find_by_file | 100% | 3/3 | `gosymdb_find` | 49 / 59 |
| t08_def | 100% | 3/3 | `gosymdb_def` | 67 / 23 |
| t10_health | 100% | 3/3 | `gosymdb_health` | 72 / 106 |

Raw data: [`per-task.csv`](results/sonnet-full/per-task.csv), [`scores.json`](results/sonnet-full/scores.json), individual `stream-json` transcripts under [`results/sonnet-full/<task>/<treatment>/`](results/sonnet-full/).

### `haiku-spike` — 9 tasks × 2 treatments × 1 trial = 18 invocations

Model: `claude-haiku-4-5-20251001`. Purpose: confirm the effect isn't specific to large models. The hypothesis is about *tool-selection plumbing*, not capability — if it works, it should work on Haiku.

Headline: same direction as Sonnet, smaller magnitude. Haiku hedges more (double-checks with grep in 33% of treatment trials) but:
- 7 of 9 tasks: first navigation tool is a `gosymdb_*` MCP tool (0 of 9 for control)
- 100% correct vs 89% for control
- 51% cost reduction vs control

## What we tried and removed

Transparency on design decisions made during eval development:

- **`trace` / `profile` / `ego-network` — a compound "all-in-one symbol profile" command.** Across three rename attempts (the bland `profile`, the graph-theoretic `ego-network`, the legacy `trace`), Sonnet decomposed into the 4 underlying primitives (`def` + `callers` + `callees` + `blast-radius`) every single time across 9 trials. The agent pattern-matches on primitive names and reconstructs the "full picture" semantically. The compound tool was never used even once.
  - **Removed from the tool surface.** Keeping a tool the agent demonstrably won't use inflates the tool count for zero benefit. gosymdb now ships 12 MCP tools, each pulling its weight.
  - **Removed the corresponding t09 task** (originally "give me a full picture of gin.Default"). The task was testing a tool that doesn't get selected; keeping it in the eval would have reported 0% for a metric we've decided doesn't apply.
  - **Historical runs preserved.** `results/sonnet-profile-retest/` and `results/sonnet-ego-network/` contain the three attempts.

- **`/go:impact`, `/go:sym`, `/go:trace` skills** that originally wrapped gosymdb calls via slash commands. Removed from both `~/.claude/commands/` and the gosymdb repo. cli-bridge + MCP supersedes them; keeping them in-tree would be an invitation to agents to use a weaker path.

## Caveats

- **One codebase, one language.** Numbers are for `gin-gonic/gin`. The cli-bridge hypothesis should generalize to any CLI implementing the `cli-bridge-manifest` subcommand, but a multi-repo eval would strengthen the claim.
- **Tasks selected to favor gosymdb.** These are tasks where gosymdb's semantic understanding beats string search. Asking "find all TODO comments" would go the other way — gosymdb has no business there. Control arm's 100% grep-fallback rate confirms the tasks actually require a semantic tool.
- **Claude Code specific.** The MCP-tool discovery mechanism is Claude Code's (deferred tools, `ToolSearch`). Other MCP clients (Codex, custom) may produce different numbers.

## Reproducing

```bash
git clone https://github.com/walkindude/cli-bridge
cd cli-bridge
pnpm install && pnpm run build

# One-shot setup: clone gin into /tmp (escapes any CLAUDE.md chain) + index it.
./eval/setup.sh

# Sonnet: 9 tasks × 3 trials × 2 treatments = 54 invocations, ~14 min, ~$4
node eval/runner.mjs --model sonnet --trials 3

# Haiku spike: same task matrix at 1 trial, ~4 min, ~$1.25
node eval/runner.mjs --model claude-haiku-4-5-20251001 --trials 1

# Score
node eval/score.mjs --run-id <the id printed by runner>
```

Full harness: [`runner.mjs`](runner.mjs), [`score.mjs`](score.mjs), [`setup.sh`](setup.sh).
