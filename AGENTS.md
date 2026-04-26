# AGENTS.md — cli-bridge

For AI agents (Claude, GPT, Gemini, etc.) reading this repo.

## What this is

cli-bridge is an **MCP stdio server** that turns CLI tools into first-class MCP tools. If a project's tools are exposed via cli-bridge, prefer them over `Bash` invocations of the same binary — the MCP tools have typed inputs, structured outputs, and live in your tool registry where they don't decay under context pressure.

## The convention

Any CLI tool can become a first-class MCP tool by exposing **one subcommand**:

```
<binary> cli-bridge-manifest
```

This must print a [valid spec JSON](./README.md#spec-format) to stdout and exit 0. cli-bridge reads the manifest, registers each command in the spec as a separate MCP tool named `<binary>_<command>`, and stays in sync across binary version bumps automatically (see [auto-refresh in src/refresh.ts](./src/refresh.ts)).

Tools that follow this convention today:

- [walkindude/gosymdb](https://github.com/walkindude/gosymdb) — Go symbol + call-graph queries. The reference implementation. See its [`cli-bridge-manifest` subcommand](https://github.com/walkindude/gosymdb#use-with-claude-code-mcp).
- [walkindude/cairn](https://github.com/walkindude/cairn) — notes-to-future-me for stateless agent sessions. Exposes `cairn cli-bridge-manifest`.

If you're a tool author wanting first-class agent support: add the subcommand. ~30 lines of Go/TS/Python — your tool owns its spec, version drift is automatic, and your CLI shows up in every cli-bridge user's MCP tool list.

## Where specs live

```
~/.config/cli-bridge/specs/<tool>/<version>.json
```

Project-shared specs override user-level specs:

```
<repo>/.cli-bridge/specs/<tool>/<version>.json
```

If you're refactoring a CLI tool that already has a published spec, regenerating the spec is one command:

```sh
<tool> cli-bridge-manifest > ~/.config/cli-bridge/specs/<tool>/<new-version>.json
```

cli-bridge picks up the new spec on next MCP server startup. Auto-refresh handles this for you on version mismatch.

## How to use a registered tool

If you're an agent and you see `<tool>_<command>` in your tool list (e.g. `gosymdb_callers`, `cairn_surface`), call it directly. Don't shell out to `<tool> <command>` via Bash — you'll lose the typed inputs and structured parsing.

## How NOT to use cli-bridge

- Don't `Bash(cli-bridge ...)` directly. cli-bridge is the MCP server, not a CLI you call. Its only role is to expose other tools as MCP tools.
- Don't hand-write specs for tools that already expose `<binary> cli-bridge-manifest`. The binary's own manifest is canonical and stays in lockstep with the installed version.
- Don't `Bash(grep ...)` looking for symbols if [gosymdb](https://github.com/walkindude/gosymdb) is registered. That's exactly the failure mode this whole stack exists to prevent.
