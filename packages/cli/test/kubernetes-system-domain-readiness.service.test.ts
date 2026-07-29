import type { DomainHostPlan } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { waitForKubernetesSystemDomainReadiness } from '../src/services/kubernetes-system-domain-readiness.service';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
const runCommand: Mock<RunCommand> = vi.hoisted((): Mock<RunCommand> => vi.fn<RunCommand>());
const ingressIpv4: string = [8, 8, 8, 8].join('.');
const issuerHostPlan: DomainHostPlan = {
  baseDomain: 'apps.example.com',
  domainKind: 'custom',
  publicScheme: 'https',
  tlsMode: 'external',
};

vi.mock('../src/command-runner', (): object => ({
  runCommandWithTimeout: runCommand,
}));

describe('Kubernetes system-domain readiness', (): void => {
  afterEach((): void => {
    runCommand.mockReset();
  });

  it('does not commit through a non-Ready Certificate', async (): Promise<void> => {
    runCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: readyIngressList('apps.example.com') })
      .mockResolvedValueOnce({ exitCode: 1, stderr: 'certificate is not Ready', stdout: '' });

    await expect(
      waitForKubernetesSystemDomainReadiness({ namespace: 'compartment', releaseName: 'compartment' }, issuerHostPlan),
    ).rejects.toThrow('The retained domain generation was not committed');
  });
});

function readyIngressList(baseDomain: string, secretName: string = 'compartment-console-tls'): string {
  return JSON.stringify({
    items: [
      {
        spec: {
          rules: [{ host: `console.${baseDomain}` }, { host: `*.${baseDomain}` }],
          tls: [
            { hosts: [`console.${baseDomain}`], secretName },
            { hosts: [`*.${baseDomain}`], secretName },
          ],
        },
        status: { loadBalancer: { ingress: [{ ip: ingressIpv4 }] } },
      },
    ],
  });
}
