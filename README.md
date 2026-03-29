# cli-bridge

An MCP server (stdio) that promotes CLI tools to first-class MCP tools via declarative JSON specs.

## What is cli-bridge?

cli-bridge lets you expose any command-line tool as an MCP (Model Context Protocol) tool. You describe the tool's interface in a JSON spec file, and cli-bridge automatically generates the corresponding MCP tool definition that Claude can call.

Features:
- Declarative JSON specs — describe flags, arguments, output format, and trigger phrases
- Priority-based spec discovery — project specs override user specs, which override bundled specs
- Version-aware — specs are matched to the installed binary version (exact or best-match)
- Multiple output parsers — JSON, JSONL, CSV, TSV, and plain text
- No shell — uses `execFile` only, no shell injection possible
- TypeScript strict mode — no `any`, no implicit casts

## Installation

```bash
# Clone the repo
git clone https://github.com/yourusername/cli-bridge
cd cli-bridge

# Install dependencies (requires pnpm + Node 22, managed via mise)
mise install
pnpm install

# Build
pnpm run build
```

## Usage

### Configure as an MCP server

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "cli-bridge": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/cli-bridge/dist/server.js"]
    }
  }
}
```

### Register a CLI tool

Use the `/cli-bridge:register` skill in Claude Code to generate a spec:

```
/cli-bridge:register git
```

This will create `~/.config/cli-bridge/specs/git/<version>.json`.

### Write a spec manually

Specs live at `~/.config/cli-bridge/specs/<tool-name>/<version>.json`.

Example spec for `jq`:

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
    "positive": ["process JSON", "filter JSON output", "extract from JSON", "transform JSON data"],
    "negative": ["do not use jq for non-JSON formats", "avoid jq for CSV or XML"]
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
        { "name": "raw-output", "short": "r", "description": "Output raw strings", "required": false, "type": "boolean" },
        { "name": "compact-output", "short": "c", "description": "Compact output", "required": false, "type": "boolean" }
      ],
      "output": { "format": "json" }
    }
  ]
}
```

### Project-level specs

Teams can place specs in `.cli-bridge/specs/` in their repo. These take priority over user-level specs.

## Spec Storage Priority

1. `.cli-bridge/specs/` in the current working directory (project-level)
2. `~/.config/cli-bridge/specs/` (user-level, respects `XDG_CONFIG_HOME`)
3. `<plugin-dir>/specs/` (bundled — empty by default)

## Development

```bash
pnpm run build        # compile TypeScript
pnpm test             # run all tests (vitest)
pnpm run test:watch   # watch mode
pnpm run test:coverage # coverage report (target: 90%+)
pnpm run typecheck    # tsc --noEmit
pnpm run lint         # eslint
```

## End-to-End Verification

To verify a working installation:

1. Build the project:
   ```bash
   pnpm run build
   ```

2. Create a test spec for `node`:
   ```bash
   mkdir -p ~/.config/cli-bridge/specs/node
   cat > ~/.config/cli-bridge/specs/node/$(node --version | sed 's/v//').json <<'EOF'
   {
     "name": "node",
     "specVersion": "1",
     "binary": "node",
     "binaryVersion": "22.0.0",
     "description": "Node.js JavaScript runtime",
     "versionDetection": { "command": "--version", "pattern": "v(\\d+\\.\\d+\\.\\d+)" },
     "triggers": {
       "positive": ["run JavaScript", "execute node script"],
       "negative": ["do not use node for Python scripts"]
     },
     "commands": [{
       "name": "run",
       "description": "Evaluate JavaScript code",
       "usage": "node --eval <code>",
       "flags": [{ "name": "eval", "short": "e", "description": "Evaluate script", "required": true, "type": "string" }],
       "output": { "format": "text" }
     }]
   }
   EOF
   ```

3. Start the MCP server and verify it loads the spec:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | node dist/server.js 2>&1
   ```

4. Run the full test suite:
   ```bash
   pnpm test
   ```

## Architecture

| File | Purpose |
|------|---------|
| `src/server.ts` | MCP server entry point. Loads specs, registers tools, handles calls |
| `src/registry.ts` | Spec discovery across directories. Converts specs to MCP tool definitions |
| `src/executor.ts` | Runs CLI commands via `execFile`. No shell. Timeout enforcement |
| `src/schema.ts` | `CliToolSpec` types + JSON Schema + `validateSpec()` function |
| `src/parser.ts` | Parses CLI stdout (json/text/csv/tsv/jsonl) into MCP content blocks |
| `src/resolver.ts` | Binary path resolution (`which`), version detection, semver matching |
| `src/paths.ts` | Spec directory resolution with XDG support |
| `src/types.ts` | `Result<T,E>`, `ToolResult`, error types |

## License

Apache-2.0 — see [LICENSE](./LICENSE)
