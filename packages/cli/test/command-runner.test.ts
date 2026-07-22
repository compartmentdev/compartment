import { describe, expect, it } from 'vitest';
import { runCommandWithTimeout } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';

describe('command runner timeout', (): void => {
  it('terminates a command at its hard deadline', async (): Promise<void> => {
    const result: CommandResult = await runCommandWithTimeout(
      [process.execPath, '-e', 'setInterval(() => {}, 1_000)'],
      100,
    );

    expect(result).toMatchObject({ exitCode: 124 });
    expect(result.stderr).toContain('Command timed out after 1 seconds.');
  });
});
