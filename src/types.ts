/** Discriminated union for recoverable operation results. */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Constructs a successful Result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Constructs a failed Result. */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Raw output from executing a CLI command. */
export interface ToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

/** A JSON Schema validation failure. */
export interface ValidationError {
  path: string;
  message: string;
}

/** Failure to resolve a binary to an absolute path. */
export interface ResolveError {
  binary: string;
  message: string;
}

/** Failure to detect a binary's version. */
export interface VersionDetectError {
  binary: string;
  attemptedCommands: string[];
  message: string;
}

/** Failure to load a spec file. */
export interface SpecLoadError {
  specPath: string;
  message: string;
}
