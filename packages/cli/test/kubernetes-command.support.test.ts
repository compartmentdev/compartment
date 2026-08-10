import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { buildHelmUpgradeCommand, formatKubernetesCommandFailure } from '../src/services/kubernetes-command.support';
import { buildDomainHelmCommand } from '../src/services/kubernetes-system-domain-release.support';

describe('Helm upgrade command', (): void => {
  it('re-reads current chart defaults instead of replaying the previous release coalesced values', (): void => {
    const command: string[] = buildHelmUpgradeCommand({ namespace: 'compartment' }, 'compartment', '/chart.tgz', [
      '--values',
      '/operator.yaml',
    ]);

    expect(command).toContain('--reset-then-reuse-values');
    expect(command).not.toContain('--reuse-values');
    expect(command).not.toContain('--reset-values');
  });

  it('keeps the caller values files in order after the release coordinates', (): void => {
    const command: string[] = buildHelmUpgradeCommand({ namespace: 'compartment' }, 'compartment', '/chart.tgz', [
      '--values',
      '/operator.yaml',
      '--values',
      '/image-trust.json',
    ]);

    expect(command.slice(0, 6)).toEqual(['helm', 'upgrade', 'compartment', '/chart.tgz', '--namespace', 'compartment']);
    expect(command.filter((value: string): boolean => value.endsWith('.yaml') || value.endsWith('.json'))).toEqual([
      '/operator.yaml',
      '/image-trust.json',
    ]);
  });
});

describe('Kubernetes system-domain release command', (): void => {
  it('adopts current chart defaults for a domain rollout as well as a platform update', (): void => {
    const command: string[] = buildDomainHelmCommand(
      { namespace: 'compartment', releaseName: 'compartment' },
      '/chart.tgz',
      '/operator.yaml',
      '/domain-values.json',
      '/image-trust-values.json',
    );

    expect(command).toContain('--reset-then-reuse-values');
    expect(command).not.toContain('--reuse-values');
    expect(command).not.toContain('--reset-values');
    expect(command).toEqual(expect.arrayContaining(['--rollback-on-failure', '--wait', '--timeout', '10m']));
  });
});

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
