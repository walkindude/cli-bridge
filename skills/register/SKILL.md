# /cli-bridge:register

Register a CLI tool as an MCP tool by either fetching its canonical spec
(if the tool supports it) or generating one from `--help` as a fallback.

## Usage

```
/cli-bridge:register <binary-name>
```

## What This Skill Does

Two paths, tried in order:

**Canonical path (preferred).** If the tool exposes a `cli-bridge-manifest`
subcommand, run it and use its output verbatim. Tool authors own their own
spec. Zero drift. Blessed convention for first-class support.

**Heuristic fallback.** If `cli-bridge-manifest` is absent or fails, parse
`--help` output and synthesize a spec.

In both cases the final spec is written to
`~/.config/cli-bridge/specs/<name>/<version>.json`.

## Steps

1. **Resolve the binary**: Run `which <binary>` to confirm it exists and get
   the absolute path.

2. **Detect version**: Run the binary with `--version`, `version`, `-v`, or
   `-V` to extract the version string.

3. **Try the canonical path**: Run `<binary> cli-bridge-manifest`.
   - If it exits 0 and stdout parses as valid JSON that satisfies the
     `CliToolSpec` schema (see `src/schema.ts`), use that JSON as the spec.
     Skip to step 7.
   - If it fails (non-zero exit, not found, invalid JSON, or schema
     violation), continue with the fallback steps 4–6.

4. **Get help output**: Run `<binary> --help` and capture stdout+stderr.
   Also try `<binary> help` if `--help` fails.

5. **Parse help output**: Identify:
   - Top-level description (first non-empty line or paragraph before
     "Usage:")
   - Subcommands (lines like `  <name>  <description>`)
   - Global flags (lines like `  --<name>, -<short>  <description>`)
   - Usage pattern (line starting with "Usage:")

6. **Build spec**: Construct a `CliToolSpec` object:
   - `name`: lowercase binary name (sanitized to match `/^[a-z][a-z0-9-]*$/`)
   - `specVersion`: `"1"`
   - `binary`: the binary name
   - `binaryVersion`: detected version
   - `description`: extracted from help (max 500 chars)
   - `versionDetection`: `{ command: "--version", pattern: "v?(\\d+\\.\\d+[.\\d+]*)" }`
   - `triggers.positive`: 3–5 descriptive phrases naming the tasks or
     inputs the tool fits (e.g. "JSON parsing tasks",
     "schema-aware symbol queries"). Avoid imperatives directed at the
     reader ("BEFORE you parse JSON"); see the Notes section below.
   - `triggers.negative`: 3–5 phrases naming inputs or tasks where the
     tool doesn't apply (e.g. "non-JSON input formats", "non-Go
     codebases"). Same descriptive register as the positive set.
   - `commands`: one entry per detected subcommand, with `output.format:
     "text"` as default

7. **Add registration metadata**: Regardless of path, attach:
   - `registration.resolvedPath`: absolute path from step 1
   - `registration.registeredAt`: `new Date().toISOString()`
   - `registration.helpOutput`: truncated help output (≤ 2000 chars) —
     omit when the canonical path was used

8. **Validate**: Run `validateSpec()` on the constructed spec. Fix any
   errors.

9. **Write spec**: Write to
   `~/.config/cli-bridge/specs/<name>/<version>.json` (create directories
   as needed).

10. **Confirm**: Report the spec path, the path taken (canonical vs
    heuristic), and summarize what was registered.

## Example Output

Canonical path:

```
Registered gosymdb (via cli-bridge-manifest).
Spec written to: ~/.config/cli-bridge/specs/gosymdb/dev-f8fbe2b.json
Commands registered: index, find, def, callers, callees, blast-radius,
  dead, trace, implementors, references, packages, health, agent-context
```

Heuristic fallback:

```
Registered git (via --help parsing — cli-bridge-manifest not supported).
Spec written to: ~/.config/cli-bridge/specs/git/2.43.0.json
Commands registered: add, commit, push, pull, clone, log, status, diff,
  branch, checkout
```

## Notes

- **Canonical path is always preferred.** Encourage tool authors to add a
  `<tool> cli-bridge-manifest` subcommand that prints their canonical spec.
  gosymdb does this (see `internal/cmd/cli_bridge_manifest.go`). This
  eliminates the brittleness of scraping `--help`, keeps the spec in
  lockstep with the binary, and lets tool authors curate trigger phrases
  and descriptions directly.

- If the binary has no subcommands (e.g., `jq`, `curl`), create a single
  `run` command that accepts the primary flags.

- Output format defaults to `"text"`. If the binary commonly outputs JSON
  (check `--json` flag or help mentions "JSON output"), set `output.format:
  "json"`.

- Triggers describe the situations where the tool fits, in descriptive
  register. They are read by future agents at MCP startup, so the
  preferred shape is "for X tasks" or "X inputs", not "BEFORE you do
  X" or "Do NOT use for X". Imperatives written into triggers become
  prompt injection by the time they reach a model's tool catalog.
  Descriptive phrasing works just as well for tool selection without
  carrying directive weight into runtime contexts.

- Keep `description` under 500 characters.

- Keep `registration.helpOutput` under 2000 characters (truncate if needed).
