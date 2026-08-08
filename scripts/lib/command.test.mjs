import { describe, expect, it } from 'vitest';

import { captureCommandAsync } from './command.mjs';

describe('captureCommandAsync', () => {
  it('captures output and a nonzero status', async () => {
    const result = await captureCommandAsync(
      process.execPath,
      ['--eval', "process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 7;"],
      process.cwd(),
      process.env,
      { timeoutMs: 1_000 },
    );

    expect(result).toEqual({ status: 7, stderr: 'err', stdout: 'out', timedOut: false });
  });

  it('terminates a command after the timeout', async () => {
    const result = await captureCommandAsync(
      process.execPath,
      ['--eval', 'setInterval(() => {}, 1_000);'],
      process.cwd(),
      process.env,
      { timeoutMs: 25 },
    );

    expect(result).toMatchObject({ status: null, timedOut: true });
  });

  it('rejects a failed spawn before exposing output', async () => {
    await expect(
      captureCommandAsync('compartment-command-that-does-not-exist', [], process.cwd(), process.env, {
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
