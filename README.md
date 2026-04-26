# cli-bridge

[![npm version](https://img.shields.io/npm/v/cli-bridge.svg)](https://www.npmjs.com/package/cli-bridge)
[![CI](https://github.com/walkindude/cli-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/walkindude/cli-bridge/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2)](https://modelcontextprotocol.io)

**If you want agents to actually use your CLI, this is the missing piece.**

You wrote the CLI, you mentioned it in `CLAUDE.md`, the agent used it twice and then went back to `Bash`. cli-bridge solves that by registering your tool's commands as real MCP tools that live in the agent's tool registry — outside the context window, where they don't decay under conversation pressure.

## The problem

You built a CLI that does something useful. Maybe it queries a database, lints code, or manages infrastructure. You tell the agent about it in CLAUDE.md or your system prompt. It works for a while, then the agent quietly goes back to `grep` and `Bash`.

This happens because text instructions sit in the context window, and context is a lossy channel. When the conversation gets long or the task gets complex, the agent forgets your tool exists. It falls back to what it knows: shell commands.

MCP tools don't have this problem. They live outside the context window, in the tool registry. The agent sees them every time it decides which tool to call, regardless of how long the conversation is or how much pressure the context is under.

## What cli-bridge does

cli-bridge lets you describe your CLI's interface in a JSON spec file. On startup, it reads the spec and registers each subcommand as a real MCP tool. The agent sees `tool_foo` and `tool_bar` in its tool list, not buried in a CLAUDE.md paragraph it might skip.

When the agent calls one of these tools, cli-bridge runs your binary via `execFile` (no shell), parses the output according to the spec, and returns structured content. Your CLI stays a CLI. It just also happens to be an MCP tool now.

This works with Claude Code, Codex, and anything else that speaks MCP.

## Install

There are two paths. Pick one — they're not sequential.

### Path A — Plugin (Claude Code, recommended)

One command, gets you the binary + MCP server registration + the `/cli-bridge:register` slash command:

```
/plugin marketplace add walkindude/cli-bridge
/plugin install cli-bridge@cli-bridge
```

Skip the rest of this section.

### Path B — Standalone (npm / Codex / other MCP clients)

If you're not on Claude Code, or you want the binary without the plugin scaffolding:

**1. Install the binary.** Pick whichever fits:

```bash
npm install -g cli-bridge          # or pnpm / yarn / bun
mise use -g npm:cli-bridge@latest  # via mise
nix profile install github:walkindude/cli-bridge  # via nix
```

For source builds: `git clone … && pnpm install && pnpm run build && npm link`.

**2. Register as an MCP server.** For Claude Code, the canonical command is one line:

```bash
claude mcp add cli-bridge -s user -- cli-bridge
```

Or by hand — add to `~/.claude.json` (user scope) or your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "cli-bridge": {
      "type": "stdio",
      "command": "cli-bridge"
    }
  }
}
```

For Codex — add to `~/.codex/config.toml`:

```toml
[mcp_servers.cli-bridge]
command = "cli-bridge"
```

**3. Restart your MCP client.** Tools register at startup; new MCP servers don't appear in an already-running session.

## Register a tool

A registered tool means cli-bridge knows where its spec is and what binary version it targets.

### If you installed via Path A (plugin)

Use the slash command from inside Claude Code:

```
/cli-bridge:register <binary>
```

It tries the canonical path first, falls back to scraping `--help` if needed. Both paths write to `~/.config/cli-bridge/specs/<tool>/<version>.json`.

### If you installed via Path B (standalone)

You don't have the slash command. Two options:

- **Canonical path (preferred for CLI authors who follow the convention).** If your tool exposes `<binary> cli-bridge-manifest` (this is the convention — [gosymdb](https://github.com/walkindude/gosymdb) is the reference), write the spec directly:

  ```bash
  mkdir -p ~/.config/cli-bridge/specs/<tool>
  <tool> cli-bridge-manifest > ~/.config/cli-bridge/specs/<tool>/$(<tool> --version | awk '{print $NF}').json
  ```

  After this, **cli-bridge auto-refreshes** the spec whenever the binary version changes. You'll see a `[cli-bridge] auto-refreshed spec for <tool> to v<new>` log line on the next startup. No manual re-registration needed for canonical-convention tools.

- **Heuristic fallback.** If the tool doesn't have `cli-bridge-manifest`, install the plugin (Path A) once just to get the slash command's `--help` scraping logic, then run `/cli-bridge:register <binary>`. Hand-tune the triggers afterwards.

### Spec layout

Specs land at `~/.config/cli-bridge/specs/<tool>/<version>.json`. See [Spec Format](#spec-format) below.

## Spec format stability

The spec schema (`specVersion: "1"`) is **additive-only**. New optional fields can appear in v1; existing fields will not be renamed, removed, or have their semantics changed within v1. A breaking schema change would mint `specVersion: "2"` alongside, and cli-bridge would continue to load v1 specs indefinitely.

In practice this means a spec written today against gosymdb v0.1.2 (or [cairn](https://github.com/walkindude/cairn), or any other tool that ships `<binary> cli-bridge-manifest`) will keep working as cli-bridge evolves. The contract is the JSON shape, not the package version.

## How it works

1. On startup, the MCP server discovers specs from three locations (highest priority first):
   - `.cli-bridge/specs/` in the current project (team-shared)
   - `~/.config/cli-bridge/specs/` (user-local, `XDG_CONFIG_HOME` respected)
   - `specs/` in the plugin directory (bundled, empty by default)

2. For each spec, it resolves the binary via `which`, detects the installed version, and picks the best-matching spec file.

3. Each command in the spec becomes an MCP tool named `{tool}_{command}` (e.g. `tool_foo`, `tool_bar`).

4. When Claude calls a tool, cli-bridge runs the binary via `execFile` (no shell), parses stdout according to the spec's output format, and returns structured MCP content.

## Spec format

Specs live at `~/.config/cli-bridge/specs/<tool>/<version>.json`.

```json
{
  "name": "jq",
  "specVersion": "1",
  "binary": "jq",
  "binaryVersion": "1.7.1",
  "description": "Command-line JSON processor",
  "versionDetection": {
    "command": "--version",
    "pattern": "jq-(\\d+\\.\\d+[.\\d+]*)"
  },
  "triggers": {
    "positive": ["JSON parsing or filter pipelines", "applying a transformation to a JSON document"],
    "negative": ["non-JSON input formats (XML, CSV, raw text)"]
  },
  "commands": [
    {
      "name": "run",
      "description": "Apply a jq filter to JSON input",
      "usage": "jq <filter> [file]",
      "args": [
        { "name": "filter", "description": "jq filter expression", "required": true, "type": "string" }
      ],
      "flags": [
        { "name": "raw-output", "short": "r", "description": "Output raw strings", "required": false, "type": "boolean" }
      ],
      "output": { "format": "json" }
    }
  ]
}
```

Key fields:

| Field | Purpose |
|-------|---------|
| `triggers.positive` | Situations where this tool is the right answer |
| `triggers.negative` | Situations where it doesn't fit |
| `output.format` | How to parse stdout: `json`, `jsonl`, `text`, `csv`, `tsv` |
| `versionDetection` | How to detect the installed binary version on startup |
| `globalFlags` | Flags available on every command |

Trigger phrases land in the agent's MCP tool catalog at server startup, so they're prompt-adjacent by construction. Descriptive register ("JSON parsing tasks", "non-Go codebases") works the same as imperatives ("BEFORE you parse JSON", "Do NOT use for non-Go") for tool selection but doesn't carry directive weight into runtime contexts. The convention here is descriptive.

Teams can share specs by checking them into `.cli-bridge/specs/` in their repo. Project-level specs take priority over user-level specs.

## Security model

cli-bridge executes real binaries on your machine. A spec is effectively a shortcut to running a CLI command. Loading a spec grants the same permissions as running the binary directly.

**Spec sources and trust:**

| Source | Trust level | Who controls it |
|--------|------------|-----------------|
| `.cli-bridge/specs/` in repo | Same as cloning the repo | Repo maintainers |
| `~/.config/cli-bridge/specs/` | User-controlled | You |
| `specs/` in plugin dir | Bundled with cli-bridge | cli-bridge maintainers |

Project-local specs (`.cli-bridge/specs/`) load automatically when you open a project, the same trust model as `Makefile`, `.vscode/tasks.json`, or `package.json` scripts. **Review specs from untrusted repos before use.**

**Execution safety:**
- All commands run via `execFile` (no shell), no metacharacter expansion
- Output is capped at 10 MB per invocation
- Timeouts enforced (default 30s, max 5 min)
- Trigger phrases are length-limited to prevent prompt injection via tool descriptions

## Development

```bash
pnpm run build          # compile + bundle
pnpm test               # vitest
pnpm run test:coverage  # coverage report
pnpm run lint           # eslint
pnpm run typecheck      # tsc --noEmit
pnpm run format         # prettier --write
pnpm run format:check   # prettier --check
```

## Architecture

| Module | Purpose |
|--------|---------|
| `src/server.ts` | MCP stdio server. Loads specs, registers tools, handles calls |
| `src/registry.ts` | Spec discovery, version resolution, MCP tool generation |
| `src/executor.ts` | Runs CLI via `execFile`. No shell. Timeout enforcement |
| `src/schema.ts` | `CliToolSpec` types + JSON Schema + `validateSpec()` |
| `src/parser.ts` | Parses stdout (json/text/csv/tsv/jsonl) into MCP content |
| `src/resolver.ts` | Binary resolution (`which`), version detection, semver matching |
| `src/paths.ts` | Spec directory resolution with XDG support |
| `src/types.ts` | `Result<T,E>`, error types |

## For agents reading this repo

See [AGENTS.md](./AGENTS.md) for the convention, when to use cli-bridge tools versus `Bash`, and which sibling projects in this family already follow the manifest convention.

## Versioning

Releases are cut via git tags (`v0.1.0`, `v0.2.0`, etc.). Pushing a tag triggers a GitHub Release with auto-generated release notes.

Plugin updates: bump the `version` field in `.claude-plugin/plugin.json` and `package.json`. Users on the marketplace will pick up the new version on next session start (if auto-update is enabled) or via `/plugin update`.

## License

Apache-2.0
