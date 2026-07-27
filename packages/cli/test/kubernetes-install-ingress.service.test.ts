import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { resolveKubernetesPublicIngress } from '../src/services/kubernetes-install-ingress.service';
import type {
  KubernetesIngressEndpoint,
  KubernetesPublicIngress,
  KubernetesPublicIngressResolutionInput,
} from '../src/services/kubernetes-install.service.types';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;

const runCommand: Mock<RunCommand> = vi.hoisted((): Mock<RunCommand> => vi.fn<RunCommand>());
const publicIpv4: string = [8, 8, 8, 8].join('.');
const secondPublicIpv4: string = [8, 8, 4, 4].join('.');
const publicIpv6: string = ['2001', '4860', '4860', '', '8888'].join(':');

vi.mock('../src/command-runner', (): object => ({
  runCommand: runCommand,
  runCommandWithTimeout: runCommand,
}));

describe('Kubernetes Ingress endpoint observation', (): void => {
  afterEach((): void => {
    runCommand.mockReset();
    vi.useRealTimers();
  });

  it('preserves a hostname endpoint without resolving it to an IP', async (): Promise<void> => {
    runCommand.mockResolvedValue(successfulCommandResult(ingressHostnameList()));

    await expect(resolveKubernetesPublicIngress(createResolutionInput())).resolves.toEqual({
      ingressClassName: 'traefik',
      ingressEndpoint: { type: 'hostname', value: 'ingress.example.com' },
      publicIngressIpv4: '',
      publicIngressIpv6: '',
    });
  });

  it('preserves explicitly configured A and AAAA endpoints with their types', async (): Promise<void> => {
    await expect(
      resolveKubernetesPublicIngress(createResolutionInput({ type: 'A', value: publicIpv4 })),
    ).resolves.toMatchObject({
      ingressEndpoint: { type: 'A', value: publicIpv4 },
      publicIngressIpv4: publicIpv4,
      publicIngressIpv6: '',
    });
    await expect(
      resolveKubernetesPublicIngress(createResolutionInput({ type: 'AAAA', value: publicIpv6 })),
    ).resolves.toMatchObject({
      ingressEndpoint: { type: 'AAAA', value: publicIpv6 },
      publicIngressIpv4: '',
      publicIngressIpv6: publicIpv6,
    });
    expect(runCommand).not.toHaveBeenCalled();
  });

  it('times out with explicit endpoint fallback advice', async (): Promise<void> => {
    vi.useFakeTimers();
    runCommand.mockResolvedValue(successfulCommandResult(ingressAddressList([])));
    const resolution: Promise<KubernetesPublicIngress> = resolveKubernetesPublicIngress(createResolutionInput());
    const failure: Promise<void> = expect(resolution).rejects.toThrow(
      'No endpoint was published in the Compartment Ingress status after 300s. Configure ingress.endpoint explicitly or fix the selected Ingress Controller, then re-run install to resume.',
    );

    await vi.advanceTimersByTimeAsync(300_000);
    await failure;
  });

  it('selects a deterministic typed endpoint from reordered status entries', async (): Promise<void> => {
    const firstAddress: string = publicIpv4;
    const secondAddress: string = secondPublicIpv4;
    runCommand
      .mockResolvedValueOnce(successfulCommandResult(ingressAddressList([firstAddress, secondAddress])))
      .mockResolvedValueOnce(successfulCommandResult(ingressAddressList([secondAddress, firstAddress])));

    await expect(resolveKubernetesPublicIngress(createResolutionInput())).resolves.toMatchObject({
      ingressEndpoint: { type: 'A', value: secondAddress },
    });
    await expect(resolveKubernetesPublicIngress(createResolutionInput())).resolves.toMatchObject({
      ingressEndpoint: { type: 'A', value: secondAddress },
    });
  });
});

function createResolutionInput(
  configuredEndpoint: KubernetesIngressEndpoint | null = null,
): KubernetesPublicIngressResolutionInput {
  return {
    configuredEndpoint,
    ingressClassName: 'traefik',
    namespace: 'compartment',
    releaseName: 'compartment',
  };
}

function successfulCommandResult(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

function ingressHostnameList(): string {
  return JSON.stringify({
    items: [{ status: { loadBalancer: { ingress: [{ hostname: 'Ingress.Example.com.' }] } } }],
  });
}

function ingressAddressList(addresses: readonly string[]): string {
  return JSON.stringify({
    items: [{ status: { loadBalancer: { ingress: addresses.map((ip: string): { ip: string } => ({ ip })) } } }],
  });
}
