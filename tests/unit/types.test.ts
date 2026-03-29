import { describe, it, expect } from 'vitest';
import { ok, err } from '../../src/types.js';
import type { Result } from '../../src/types.js';

describe('Result helpers', () => {
  it('ok() produces ok discriminant', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it('err() produces err discriminant', () => {
    const result = err('fail');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('fail');
    }
  });

  it('type narrowing works correctly', () => {
    const result: Result<number, string> = ok(1);
    if (result.ok) {
      const n: number = result.value;
      expect(n).toBe(1);
    }
  });

  it('ok() works with objects', () => {
    const data = { foo: 'bar' };
    const result = ok(data);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ foo: 'bar' });
    }
  });

  it('err() works with objects', () => {
    const error = { code: 404, message: 'not found' };
    const result = err(error);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: 404, message: 'not found' });
    }
  });

  it('ok() works with undefined', () => {
    const result = ok(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeUndefined();
    }
  });

  it('err() works with null', () => {
    const result = err(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeNull();
    }
  });
});
