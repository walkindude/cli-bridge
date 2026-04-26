# AGENTS.md — cli-bridge

Documentation for AI agents (and anyone else) reading this repo.

## What cli-bridge is

cli-bridge is an MCP stdio server. On startup it reads spec JSON files from a few well-known directories and registers each command in each spec as a separate MCP tool named `<binary>_<command>`. It then runs the underlying binary via `execFile` (no shell) when the tool is called, parsing stdout per the spec.

It is not itself a CLI tool you call from a shell — calling `cli-bridge` directly starts the MCP server in stdio mode, which expects to be spoken to over stdin/stdout by an MCP client.

## The manifest convention

Any CLI tool can opt in to being a first-class cli-bridge tool by exposing one subcommand:

```
<binary> cli-bridge-manifest
```

This must print a [valid spec JSON](./README.md#spec-format) to stdout and exit 0. cli-bridge reads the manifest, registers each command in the spec, and (since the [agent-friendly-readme-and-auto-refresh](./src/refresh.ts) work) refreshes the spec automatically whenever the installed binary version drifts from the spec on disk.

## Tools that currently follow this convention

- [walkindude/gosymdb](https://github.com/walkindude/gosymdb) — Go symbol and call-graph index. Exposes `gosymdb cli-bridge-manifest`. See its [Use with Claude Code section](https://github.com/walkindude/gosymdb#use-with-claude-code-mcp).
- [walkindude/cairn](https://github.com/walkindude/cairn) — local notes-to-future-me. Exposes `cairn cli-bridge-manifest`.

These are listed as a factual reference, not a recommendation. If you're building a CLI tool and want to opt in, the spec format is documented in [README.md#spec-format](./README.md#spec-format) and the schema is in [src/schema.ts](./src/schema.ts).

## Where specs live

```
~/.config/cli-bridge/specs/<tool>/<version>.json   (user)
<repo>/.cli-bridge/specs/<tool>/<version>.json     (project, takes priority)
```

When a tool's spec is stale relative to the installed binary AND the binary exposes `cli-bridge-manifest`, cli-bridge writes a fresh `<installed-version>.json` next to the stale spec on next startup and logs `[cli-bridge] auto-refreshed spec for <tool> to v<new>`. If the binary doesn't expose the manifest subcommand, the warning lists the manual fix command.

## Naming

cli-bridge registers tools as `<binary>_<command>`. So gosymdb's `callers` subcommand becomes the MCP tool `gosymdb_callers`; cairn's `surface` becomes `cairn_surface`. There is no namespacing or per-server prefix beyond the binary name.

## Common confusions

- **`cli-bridge` is not a CLI you call from a shell.** It's an MCP server. Running it from a shell starts the stdio server, which will sit waiting for MCP frames on stdin.
- **`/cli-bridge:register <binary>` is a slash command provided by the marketplace plugin.** It's not part of the cli-bridge npm package on its own. Standalone npm installs don't have it.
- **The spec on disk and the installed binary version can drift.** Auto-refresh handles this for tools following the manifest convention; a startup log line records what happened.
