# cli-bridge

A Claude Code plugin that promotes CLI tools to first-class MCP tools via declarative JSON specs.

## Why

Claude Code reaches for `grep` and `Bash` by default. CLAUDE.md instructions degrade under context pressure. Skills don't reliably trigger. MCP tools do — they participate in tool selection at the protocol level, before context pressure applies.

cli-bridge lets you describe any CLI tool's interface in a JSON spec. The plugin exposes each subcommand as a real MCP tool that Claude (and Codex) can call directly.

## Install

### From the marketplace (Claude Code)

```
/plugin marketplace add walkindude/cli-bridge
/plugin install cli-bridge@cli-bridge
```

### From npm

```bash
npm install -g cli-bridge
```

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

Use the built-in skill to auto-generate a spec from any CLI binary:

```
/cli-bridge:register kubectl
```

This inspects `--help` output, detects subcommands, and writes a spec to `~/.config/cli-bridge/specs/kubectl/<version>.json`.

Or write specs by hand — see [Spec Format](#spec-format) below.

## How it works

1. On startup, the MCP server discovers specs from three locations (highest priority first):
   - `.cli-bridge/specs/` in the current project (team-shared)
   - `~/.config/cli-bridge/specs/` (user-local, `XDG_CONFIG_HOME` respected)
   - `specs/` in the plugin directory (bundled, empty by default)

2. For each spec, it resolves the binary via `which`, detects the installed version, and picks the best-matching spec file.

3. Each command in the spec becomes an MCP tool named `{tool}_{command}` (e.g. `kubectl_get`, `gosymdb_callers`).

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

cli-bridge executes real binaries on your machine. A spec is effectively a shortcut to running a CLI command — loading a spec grants the same permissions as running the binary directly.

**Spec sources and trust:**

| Source | Trust level | Who controls it |
|--------|------------|-----------------|
| `.cli-bridge/specs/` in repo | Same as cloning the repo | Repo maintainers |
| `~/.config/cli-bridge/specs/` | User-controlled | You |
| `specs/` in plugin dir | Bundled with cli-bridge | cli-bridge maintainers |

Project-local specs (`.cli-bridge/specs/`) load automatically when you open a project — the same trust model as `Makefile`, `.vscode/tasks.json`, or `package.json` scripts. **Review specs from untrusted repos before use.**

**Execution safety:**
- All commands run via `execFile` (no shell) — no metacharacter expansion
- Output is capped at 10 MB per invocation
- Timeouts enforced (default 30s, max 5 min)
- Trigger phrases are length-limited to prevent prompt injection via tool descriptions

## Development

```bash
pnpm run build          # compile + bundle
pnpm test               # vitest (180 tests)
pnpm run test:coverage  # coverage report (target: 90%+)
pnpm run lint           # eslint (strict + prettier)
pnpm run typecheck      # tsc --noEmit
pnpm run format         # prettier --write
pnpm run format:check   # prettier --check (CI)
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
