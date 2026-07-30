import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { formatKubernetesCommandFailure } from '../src/services/kubernetes-command.support';

describe('Kubernetes command diagnostics', (): void => {
  it('excludes a partial Secret payload while retaining stderr and status', (): void => {
    const encodedSecret: string = Buffer.from('managed-domain-acme-dns-token').toString('base64');
    const result: CommandResult = {
      exitCode: 1,
      stderr: 'Error from server (Forbidden)',
      stdout: JSON.stringify({ data: { 'managed-domain-acme-dns-token': encodedSecret } }),
    };
    const message: string = formatKubernetesCommandFailure('Failed to inspect retained state', result, {
      includeStdout: false,
    });

    expect(message).toContain('command exited with status 1');
    expect(message).toContain(result.stderr);
    expect(message).not.toContain(encodedSecret);
    expect(message).not.toContain('managed-domain-acme-dns-token');
  });
});
