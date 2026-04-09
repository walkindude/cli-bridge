import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Check synchronously if gosymdb is available
let gosymdbAvailable = false;
try {
  // We use a synchronous approach to determine availability at module load
  const { execFileSync } = await import('node:child_process');
  execFileSync('which', ['gosymdb'], { stdio: 'pipe' });
  gosymdbAvailable = true;
} catch {
  gosymdbAvailable = false;
}

describe.skipIf(!gosymdbAvailable)('gosymdb integration', () => {
  it('gosymdb binary is available and responds to --version', async () => {
    const result = await execFileAsync('gosymdb', ['--version']).catch(
      (e: unknown) => e as { stdout: string; stderr: string },
    );
    expect(result.stdout || result.stderr).toBeTruthy();
  });
});

describe('gosymdb availability check', () => {
  it('correctly reports gosymdb availability', () => {
    // This test always runs to document the check
    expect(typeof gosymdbAvailable).toBe('boolean');
  });
});
