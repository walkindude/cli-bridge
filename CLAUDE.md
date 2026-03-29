# cli-bridge

Claude Code plugin. MCP server (stdio) that promotes CLI tools to first-class MCP tools via declarative JSON specs.

## Commands

- `pnpm run build` — compile TypeScript (tsc)
- `pnpm test` — run all tests (vitest)
- `pnpm run test:watch` — watch mode
- `pnpm run test:coverage` — coverage report
- `pnpm run lint` — eslint
- `pnpm run typecheck` — tsc --noEmit

## Architecture

- `src/server.ts` — MCP server. Loads specs on startup, handles tool calls.
- `src/registry.ts` — Spec discovery across project/user/bundled directories. Generates MCP tool definitions.
- `src/executor.ts` — Runs CLI via execFile. No shell. Timeout enforcement.
- `src/schema.ts` — CliToolSpec types + JSON Schema. Single source of truth for validation.
- `src/parser.ts` — Parses CLI stdout (json, text, csv, tsv, jsonl) into MCP content blocks.
- `src/resolver.ts` — Binary resolution (which), version detection, version comparison.
- `src/paths.ts` — Spec directory resolution. Priority: project > user > bundled.
- `src/types.ts` — Result<T,E>, ToolResult, error types.
- `skills/register/SKILL.md` — /cli-bridge:register skill. Generates specs from --help.

## Spec Storage

Specs are NOT in this repo. They live at `~/.config/cli-bridge/specs/{tool}/{version}.json`.
Project teams can optionally place specs in `.cli-bridge/specs/` in their repo.
The `specs/` directory in this plugin is empty by default.

## Conventions

- TypeScript strict mode, ESM modules.
- No `any`. Use `unknown` + narrowing.
- Result<T,E> pattern for expected failures. Exceptions for unexpected failures only.
- execFile only. Never exec. No shell invocation.
- Every public function has JSDoc.
- Every src/ module has a tests/unit/ counterpart.
- Integration tests use `.integration.` in filename. They require real binaries and are skipped in CI if the binary is absent.
- Test coverage target: 90%+ on src/.

## JSON Schema

The JSON Schema in schema.ts is the canonical validation authority.
The TypeScript types exist for development ergonomics but the schema is what validateSpec() uses.
If they diverge, the JSON Schema wins. There is a cross-validation test to catch drift.
