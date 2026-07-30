import { describe, expect, it } from 'vitest';
import { runCommand, runCommandWithTimeout } from '../src/command-runner';
import type { CommandResult } from '../src/command-runner.types';
import { formatKubernetesCommandFailure } from '../src/services/kubernetes-command.support';

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

describe('command runner failures', (): void => {
  it('preserves a missing executable as a shared command-not-found failure', async (): Promise<void> => {
    const binary: string = 'compartment-definitely-missing-command';
    const result: CommandResult = await runCommand([binary, '--version']);

    expect(result).toMatchObject({
      exitCode: 127,
      failure: { command: binary, kind: 'command-not-found' },
    });
    expect(formatKubernetesCommandFailure('Arbitrary command failed', result)).toBe(
      `Arbitrary command failed: ${binary} not found on PATH. Install ${binary} and re-run install.`,
    );
    expect(formatKubernetesCommandFailure('Arbitrary command failed', result)).not.toContain('status 127');
  });

  it('adds the canonical minimum version when a known install tool is missing', (): void => {
    const result: CommandResult = {
      exitCode: 127,
      failure: { command: 'helm', kind: 'command-not-found' },
      stderr: '',
      stdout: '',
    };

    expect(formatKubernetesCommandFailure('Chart inspection failed', result)).toMatch(
      /helm not found on PATH.*Helm >= 4\.0\.0.*get-helm-4/su,
    );
    expect(formatKubernetesCommandFailure('Chart inspection failed', result)).not.toContain('status 127');
  });

  it('does not expose an absolute executable path in a command-not-found message', async (): Promise<void> => {
    const result: CommandResult = await runCommand(['/tmp/private-cache/hash/cosign', 'version']);

    expect(formatKubernetesCommandFailure('Signature verification failed', result)).toBe(
      'Signature verification failed: cosign not found on PATH. Install cosign and re-run install.',
    );
  });
});
