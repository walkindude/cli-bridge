import type { OutputDef } from './schema.js';

export interface ToolContent {
  type: 'text';
  text: string;
}

/**
 * Parses raw CLI stdout into an MCP-compatible content block.
 */
export function parseOutput(stdout: string, outputDef: OutputDef): ToolContent {
  switch (outputDef.format) {
    case 'json':
      return parseJson(stdout, outputDef.jsonPath);
    case 'jsonl':
      return parseJsonl(stdout);
    case 'csv':
      return parseDsv(stdout, ',');
    case 'tsv':
      return parseDsv(stdout, '\t');
    case 'text':
      return parseText(stdout, outputDef.successPattern);
    default: {
      const _exhaustive: never = outputDef.format;
      void _exhaustive;
      return { type: 'text', text: stdout };
    }
  }
}

function parseJson(stdout: string, jsonPath?: string): ToolContent {
  try {
    const parsed: unknown = JSON.parse(stdout);
    const extracted = jsonPath ? extractPath(parsed, jsonPath) : parsed;
    const text = JSON.stringify(extracted, null, 2) ?? 'null';
    return { type: 'text', text };
  } catch {
    return { type: 'text', text: `[parse error: invalid JSON]\n${stdout}` };
  }
}

function parseJsonl(stdout: string): ToolContent {
  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  const results: unknown[] = [];
  let hasError = false;
  for (const line of lines) {
    try {
      results.push(JSON.parse(line) as unknown);
    } catch {
      hasError = true;
      results.push(line);
    }
  }
  if (hasError) {
    return { type: 'text', text: `[parse error: some lines were not valid JSON]\n${stdout}` };
  }
  return { type: 'text', text: JSON.stringify(results, null, 2) };
}

function parseText(stdout: string, successPattern?: string): ToolContent {
  if (successPattern) {
    try {
      const re = new RegExp(successPattern);
      if (!re.test(stdout)) {
        return { type: 'text', text: `[error: output did not match success pattern]\n${stdout}` };
      }
    } catch {
      // Invalid pattern — treat as no pattern
    }
  }
  return { type: 'text', text: stdout };
}

function parseDsv(stdout: string, delimiter: string): ToolContent {
  try {
    const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return { type: 'text', text: '[]' };
    }
    const headers = splitDsv(lines[0] ?? '', delimiter);
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = splitDsv(lines[i] ?? '', delimiter);
      const row: Record<string, string> = {};
      headers.forEach((header, j) => {
        row[header] = values[j] ?? '';
      });
      rows.push(row);
    }
    return { type: 'text', text: JSON.stringify(rows, null, 2) };
  } catch {
    return { type: 'text', text: `[parse error: could not parse ${delimiter === '\t' ? 'TSV' : 'CSV'}]\n${stdout}` };
  }
}

function splitDsv(line: string, delimiter: string): string[] {
  // Simple split — does not handle quoted fields with embedded delimiters
  return line.split(delimiter).map((s) => s.trim());
}

function extractPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
