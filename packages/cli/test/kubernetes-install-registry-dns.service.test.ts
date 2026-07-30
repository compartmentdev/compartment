import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { assertOperatorRegistryDns } from '../src/services/kubernetes-install-registry-dns.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallState,
} from '../src/services/kubernetes-install.service.types';

interface RegistryDnsMocks {
  readReadyNodes: Mock<() => Promise<string[]>>;
  runCommand: Mock<(command: readonly string[]) => Promise<CommandResult>>;
  runCommandWithInput: Mock<(command: readonly string[], input: string) => Promise<CommandResult>>;
  runCommandWithTimeout: Mock<(command: readonly string[], timeoutMs: number) => Promise<CommandResult>>;
}

const mocks: RegistryDnsMocks = vi.hoisted(
  (): RegistryDnsMocks => ({
    readReadyNodes: vi.fn(),
    runCommand: vi.fn(),
    runCommandWithInput: vi.fn(),
    runCommandWithTimeout: vi.fn(),
  }),
);
const registryClusterIp: string = [10, 43, 251, 103].join('.');
const publicDnsAnswer: string = [159, 69, 25, 73].join('.');
const workerImage: string = 'ghcr.io/compartmentdev/compartment-worker@sha256:signed';

vi.mock('../src/command-runner', (): object => ({
  runCommand: mocks.runCommand,
  runCommandWithInput: mocks.runCommandWithInput,
  runCommandWithTimeout: mocks.runCommandWithTimeout,
}));
vi.mock('../src/services/kubernetes-ready-nodes.service', (): object => ({
  readReadyKubernetesNodeNames: mocks.readReadyNodes,
}));

describe('operator registry DNS prerequisite', (): void => {
  beforeEach((): void => {
    mocks.readReadyNodes.mockReset().mockResolvedValue(['node-a']);
    mocks.runCommand
      .mockReset()
      .mockResolvedValueOnce(ok(JSON.stringify({ spec: { clusterIP: registryClusterIp } })))
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            images: {
              worker: {
                digest: 'sha256:signed',
                repository: 'ghcr.io/compartmentdev/compartment-worker',
                tag: 'ignored',
              },
            },
          }),
        ),
      );
    mocks.runCommandWithInput.mockReset().mockResolvedValue(ok('applied'));
    mocks.runCommandWithTimeout.mockReset();
  });

  it('accepts the retained registry-auth ClusterIP from each node resolver', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok('succeeded'))
      .mockResolvedValueOnce(ok(JSON.stringify([{ address: registryClusterIp, family: 4 }])))
      .mockResolvedValueOnce(ok('deleted'));

    await expect(assertOperatorRegistryDns(input(), state())).resolves.toBeUndefined();

    const manifest: string = String(mocks.runCommandWithInput.mock.calls[0]?.[1]);
    expect(manifest).toContain('"hostNetwork":true');
    expect(manifest).toContain('"dnsPolicy":"Default"');
    expect(manifest).toContain('"nodeName":"node-a"');
  });

  it('uses the effective Helm worker image without requiring a Worker Deployment', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok('succeeded'))
      .mockResolvedValueOnce(ok(JSON.stringify([{ address: registryClusterIp, family: 4 }])))
      .mockResolvedValueOnce(ok('deleted'));

    await expect(assertOperatorRegistryDns(input(), state())).resolves.toBeUndefined();

    expect(mocks.runCommand).toHaveBeenCalledTimes(2);
    expect(mocks.runCommand.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining(['helm', 'get', 'values', 'compartment', '--all', '--output', 'json']),
    );
    expect(mocks.runCommand.mock.calls.flat().join(' ')).not.toContain('deployment/compartment-compartment-worker');
    expect(String(mocks.runCommandWithInput.mock.calls[0]?.[1])).toContain(`"image":"${workerImage}"`);
  });

  it('prints the exact required record when a node resolver points elsewhere', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok('succeeded'))
      .mockResolvedValueOnce(ok(JSON.stringify([{ address: publicDnsAnswer, family: 4 }])))
      .mockResolvedValueOnce(ok('deleted'));

    const failure: Promise<void> = assertOperatorRegistryDns(input(), state());
    await expect(failure).rejects.toThrow(`required record: registry.apps.example.com A ${registryClusterIp}`);
    await expect(failure).rejects.toThrow('rebind-domain-ok=/apps.example.com/');
  });

  it('does not add registry DNS requirements to managed domains', async (): Promise<void> => {
    await expect(assertOperatorRegistryDns(input(), { ...state(), domainMode: 'managed' })).resolves.toBeUndefined();

    expect(mocks.runCommand).not.toHaveBeenCalled();
    expect(mocks.readReadyNodes).not.toHaveBeenCalled();
  });
});

function input(): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: 'admin@example.com',
    domainMode: 'custom',
    namespace: 'compartment',
    registryHostname: 'registry.apps.example.com',
    registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'letsencrypt-production' },
    releaseName: 'compartment',
    valuesPath: 'values.yaml',
  };
}

function state(): KubernetesInstallState {
  return {
    acmeEmail: 'admin@example.com',
    baseDomain: 'apps.example.com',
    brokerUrl: '',
    domainMode: 'custom',
    ingressClassName: 'traefik',
    ingressEndpoint: null,
    ingressTargets: [],
    installationId: 'install_1',
    managedDomainAllocationId: '',
    managedDomainBrokerToken: '',
    publicProtocol: 'https',
    registryHostname: 'registry.apps.example.com',
    registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'letsencrypt-production' },
    tlsMode: 'issuer',
  };
}

function ok(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}
