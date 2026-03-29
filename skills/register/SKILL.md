# /cli-bridge:register

Register a CLI tool as an MCP tool by generating a spec from its `--help` output.

## Usage

```
/cli-bridge:register <binary-name>
```

## What This Skill Does

1. Runs `which <binary>` to find the binary path
2. Runs `<binary> --help` (and `<binary> --version`) to gather information
3. Parses the help output to identify subcommands, flags, and arguments
4. Generates a `CliToolSpec` JSON file at `~/.config/cli-bridge/specs/<name>/<version>.json`
5. Validates the generated spec against the JSON Schema
6. Reports the generated spec path

## Steps

1. **Resolve the binary**: Run `which <binary>` to confirm it exists and get the absolute path.

2. **Detect version**: Run the binary with `--version`, `version`, `-v`, or `-V` to extract the version string using a regex pattern.

3. **Get help output**: Run `<binary> --help` and capture stdout+stderr. Also try `<binary> help` if `--help` fails.

4. **Parse help output**: Identify:
   - Top-level description (first non-empty line or paragraph before "Usage:")
   - Subcommands (lines like `  <name>  <description>`)
   - Global flags (lines like `  --<name>, -<short>  <description>`)
   - Usage pattern (line starting with "Usage:")

5. **Build spec**: Construct a `CliToolSpec` object:
   - `name`: lowercase binary name (sanitized to match `/^[a-z][a-z0-9-]*$/`)
   - `specVersion`: `"1"`
   - `binary`: the binary name
   - `binaryVersion`: detected version
   - `description`: extracted from help (max 500 chars)
   - `versionDetection`: `{ command: "--version", pattern: "v?(\\d+\\.\\d+[.\\d+]*)" }`
   - `triggers.positive`: 3-5 natural language phrases describing when to use the tool
   - `triggers.negative`: 3-5 phrases describing when NOT to use the tool
   - `registration`: `{ resolvedPath, registeredAt: new Date().toISOString(), helpOutput }`
   - `commands`: one entry per detected subcommand, with `output.format: "text"` as default

6. **Validate**: Run `validateSpec()` on the constructed spec. Fix any errors.

7. **Write spec**: Write to `~/.config/cli-bridge/specs/<name>/<version>.json` (create directories as needed).

8. **Confirm**: Report the spec path and summarize what was registered.

## Example Output

```
Registered git as MCP tool.
Spec written to: ~/.config/cli-bridge/specs/git/2.43.0.json
Commands registered: add, commit, push, pull, clone, log, status, diff, branch, checkout
```

## Notes

- If the binary has no subcommands (e.g., `jq`, `curl`), create a single `run` command that accepts the primary flags.
- Output format defaults to `"text"`. If the binary commonly outputs JSON (check `--json` flag or help mentions "JSON output"), set `output.format: "json"`.
- The `triggers` should be written in natural language that an AI assistant would use when deciding to call this tool. Be specific about what the tool is good for.
- Keep `description` under 500 characters.
- Keep `registration.helpOutput` under 2000 characters (truncate if needed).
