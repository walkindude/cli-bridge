# cli-bridge

Turn any CLI into an MCP tool that agents actually use.

## The problem

You built a CLI that does something useful. Maybe it queries a database, lints code, or manages infrastructure. You tell the agent about it in CLAUDE.md or your system prompt. It works for a while, then the agent quietly goes back to `grep` and `Bash`.

This happens because text instructions sit in the context window, and context is a lossy channel. When the conversation gets long or the task gets complex, the agent forgets your tool exists. It falls back to what it knows: shell commands.

MCP tools don't have this problem. They live outside the context window, in the tool registry. The agent sees them every time it decides which tool to call, regardless of how long the conversation is or how much pressure the context is under.

## What cli-bridge does

cli-bridge lets you describe your CLI's interface in a JSON spec file. On startup, it reads the spec and registers each subcommand as a real MCP tool. The agent sees `tool_foo` and `tool_bar` in its tool list, not buried in a CLAUDE.md paragraph it might skip.

When the agent calls one of these tools, cli-bridge runs your binary via `execFile` (no shell), parses the output according to the spec, and returns structured content. Your CLI stays a CLI. It just also happens to be an MCP tool now.

This works with Claude Code, Codex, and anything else that speaks MCP.

## Install

### From the marketplace (Claude Code)

```
/plugin marketplace add walkindude/cli-bridge
/plugin install cli-bridge@cli-bridge
```

### From npm (or any compatible package manager)

```bash
npm install -g cli-bridge
# or
pnpm add -g cli-bridge
# or
yarn global add cli-bridge
# or
bun add -g cli-bridge
```

### With mise

```bash
mise use -g npm:cli-bridge@latest
```

### With Nix (flakes)

```bash
nix profile install github:walkindude/cli-bridge
# or for a one-off:
nix run github:walkindude/cli-bridge
# or drop into a dev shell with node + pnpm:
nix develop github:walkindude/cli-bridge
```

### Configure the MCP client

Then add to your project's `.mcp.json`:

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

### For Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.cli-bridge]
command = "cli-bridge"
```

### From source

```bash
git clone https://github.com/walkindude/cli-bridge
cd cli-bridge
pnpm install && pnpm run build
npm link
```

## Register a tool

```
/cli-bridge:register <binary>
```

Two paths, tried in order:

**Canonical path (preferred).** If the tool exposes a `<binary> cli-bridge-manifest` subcommand, the skill uses its output verbatim. The tool owns its own spec — zero drift, always in lockstep with the installed binary. This is the convention for CLI authors who want first-class cli-bridge support: [gosymdb](https://github.com/walkindude/gosymdb) is the reference implementation.

**Heuristic fallback.** If the tool doesn't expose a manifest, the skill scrapes `--help` output to synthesize a spec. Lower quality — you'll probably want to hand-tune the triggers.

Specs land at `~/.config/cli-bridge/specs/<tool>/<version>.json`. See [Spec Format](#spec-format) below.

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
    "positive": ["BEFORE processing or filtering JSON data"],
    "negative": ["Do NOT use for non-JSON formats"]
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
| `triggers.positive` | When the model SHOULD consider this tool |
| `triggers.negative` | When the model should NOT use this tool |
| `output.format` | How to parse stdout: `json`, `jsonl`, `text`, `csv`, `tsv` |
| `versionDetection` | How to detect the installed binary version on startup |
| `globalFlags` | Flags available on every command |

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

## Versioning

Releases are cut via git tags (`v0.1.0`, `v0.2.0`, etc.). Pushing a tag triggers a GitHub Release with auto-generated release notes.

Plugin updates: bump the `version` field in `.claude-plugin/plugin.json` and `package.json`. Users on the marketplace will pick up the new version on next session start (if auto-update is enabled) or via `/plugin update`.

## License

Apache-2.0
