import { describe, it, expect } from 'vitest';
import { parseOutput } from '../../src/parser.js';
import type { OutputDef } from '../../src/schema.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function fixture(name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', 'cli-outputs', name), 'utf-8');
}

describe('parseOutput', () => {
  describe('json format', () => {
    it('parses valid JSON output', () => {
      const stdout = '{"key": "value", "num": 42}';
      const result = parseOutput(stdout, { format: 'json' });
      expect(result.type).toBe('text');
      const parsed = JSON.parse(result.text) as unknown;
      expect(parsed).toEqual({ key: 'value', num: 42 });
    });

    it('returns parse error for invalid JSON', () => {
      const result = parseOutput('not json', { format: 'json' });
      expect(result.text).toContain('[parse error: invalid JSON]');
      expect(result.text).toContain('not json');
    });

    it('extracts jsonPath when specified', () => {
      const stdout = '{"items": [1, 2, 3], "total": 3}';
      const result = parseOutput(stdout, { format: 'json', jsonPath: 'items' });
      const parsed = JSON.parse(result.text) as unknown;
      expect(parsed).toEqual([1, 2, 3]);
    });

    it('returns "null" for nonexistent jsonPath', () => {
      const stdout = '{"items": [1, 2, 3]}';
      const result = parseOutput(stdout, {
        format: 'json',
        jsonPath: 'missing.nested',
      });
      expect(result.type).toBe('text');
      // When path doesn't exist, extracted is undefined; we return 'null' as fallback
      expect(result.text).toBe('null');
    });

    it('parses the json-output.json fixture', () => {
      const stdout = fixture('json-output.json');
      const result = parseOutput(stdout, { format: 'json', jsonPath: 'items' });
      const parsed = JSON.parse(result.text) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
    });
  });

  describe('jsonl format', () => {
    it('parses valid JSONL output', () => {
      const stdout = '{"a": 1}\n{"b": 2}\n{"c": 3}';
      const result = parseOutput(stdout, { format: 'jsonl' });
      const parsed = JSON.parse(result.text) as unknown;
      expect(Array.isArray(parsed)).toBe(true);
      expect((parsed as unknown[]).length).toBe(3);
    });

    it('returns parse error if a line is invalid JSON', () => {
      const stdout = '{"a": 1}\nnot json\n{"c": 3}';
      const result = parseOutput(stdout, { format: 'jsonl' });
      expect(result.text).toContain('[parse error: some lines were not valid JSON]');
    });

    it('handles empty output', () => {
      const result = parseOutput('', { format: 'jsonl' });
      const parsed = JSON.parse(result.text) as unknown;
      expect(parsed).toEqual([]);
    });

    it('ignores blank lines', () => {
      const stdout = '{"a": 1}\n\n{"b": 2}\n';
      const result = parseOutput(stdout, { format: 'jsonl' });
      const parsed = JSON.parse(result.text) as unknown;
      expect((parsed as unknown[]).length).toBe(2);
    });
  });

  describe('text format', () => {
    it('returns text as-is', () => {
      const stdout = 'hello world';
      const result = parseOutput(stdout, { format: 'text' });
      expect(result.text).toBe('hello world');
    });

    it('returns text with successPattern match', () => {
      const stdout = 'Operation done successfully';
      const result = parseOutput(stdout, {
        format: 'text',
        successPattern: 'done',
      });
      expect(result.text).toBe(stdout);
    });

    it('returns error when successPattern does not match', () => {
      const stdout = 'Operation failed';
      const result = parseOutput(stdout, {
        format: 'text',
        successPattern: 'done',
      });
      expect(result.text).toContain('[error: output did not match success pattern]');
    });

    it('ignores invalid successPattern regex', () => {
      const stdout = 'some output';
      const result = parseOutput(stdout, {
        format: 'text',
        successPattern: '[invalid(',
      });
      // Should fall through and return text as-is
      expect(result.text).toBe('some output');
    });

    it('parses the text-output.txt fixture', () => {
      const stdout = fixture('text-output.txt');
      const result = parseOutput(stdout, {
        format: 'text',
        successPattern: 'done',
      });
      expect(result.text).toBe(stdout);
    });
  });

  describe('csv format', () => {
    it('parses CSV with headers', () => {
      const stdout = 'name,age,city\nAlice,30,NYC\nBob,25,LA';
      const result = parseOutput(stdout, { format: 'csv' });
      const parsed = JSON.parse(result.text) as unknown[];
      expect(parsed).toHaveLength(2);
      expect((parsed[0] as Record<string, string>)['name']).toBe('Alice');
      expect((parsed[0] as Record<string, string>)['age']).toBe('30');
    });

    it('returns empty array for empty CSV', () => {
      const result = parseOutput('', { format: 'csv' });
      const parsed = JSON.parse(result.text) as unknown;
      expect(parsed).toEqual([]);
    });

    it('handles CSV with only headers', () => {
      const result = parseOutput('name,age', { format: 'csv' });
      const parsed = JSON.parse(result.text) as unknown[];
      expect(parsed).toHaveLength(0);
    });
  });

  describe('tsv format', () => {
    it('parses TSV with headers', () => {
      const stdout = 'name\tage\tcity\nAlice\t30\tNYC\nBob\t25\tLA';
      const result = parseOutput(stdout, { format: 'tsv' });
      const parsed = JSON.parse(result.text) as unknown[];
      expect(parsed).toHaveLength(2);
      expect((parsed[0] as Record<string, string>)['name']).toBe('Alice');
    });

    it('returns empty array for empty TSV', () => {
      const result = parseOutput('', { format: 'tsv' });
      const parsed = JSON.parse(result.text) as unknown;
      expect(parsed).toEqual([]);
    });
  });

  describe('all formats return correct type', () => {
    const formats: OutputDef['format'][] = ['json', 'text', 'csv', 'tsv', 'jsonl'];
    for (const format of formats) {
      it(`${format} returns type: 'text'`, () => {
        const stdout =
          format === 'json'
            ? '{}'
            : format === 'jsonl'
              ? '{}'
              : format === 'csv'
                ? 'a,b\n1,2'
                : format === 'tsv'
                  ? 'a\tb\n1\t2'
                  : 'output';
        const result = parseOutput(stdout, { format });
        expect(result.type).toBe('text');
      });
    }
  });
});
