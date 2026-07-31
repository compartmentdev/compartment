import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { waitForKubernetesInstallRegistryDns } from '../src/services/kubernetes-install-registry-dns-wait.service';
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

interface RegistryDnsProbeManifest {
  metadata: RegistryDnsProbeMetadata;
  spec: RegistryDnsProbeSpec;
}

interface RegistryDnsProbeMetadata {
  name: string;
}

interface RegistryDnsProbeSpec {
  containers: RegistryDnsProbeContainer[];
}

interface RegistryDnsProbeContainer {
  args: string[];
}

interface RegistryDnsAnswerFixture {
  address: string;
  family: number;
}

interface RegistryDnsProbeExecutionFixture {
  answers?: RegistryDnsAnswerFixture[] | undefined;
  error?: RegistryDnsProbeExecutionErrorFixture | undefined;
  status: string;
}

interface RegistryDnsProbeExecutionErrorFixture {
  code: string;
  message: string;
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
const registryClusterIpv6: string = ['fd00', '', '103'].join(':');
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
  afterEach((): void => {
    vi.useRealTimers();
  });

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
      .mockResolvedValueOnce(ok(podPhase('Succeeded')))
      .mockResolvedValueOnce(ok(resolvedOutput([registryClusterIp])))
      .mockResolvedValueOnce(ok('deleted'));

    await expect(waitForKubernetesInstallRegistryDns(input(), state())).resolves.toBeNull();

    const manifest: string = String(mocks.runCommandWithInput.mock.calls[0]?.[1]);
    expect(manifest).toContain('"hostNetwork":true');
    expect(manifest).toContain('"dnsPolicy":"Default"');
    expect(manifest).toContain('"nodeName":"node-a"');
    expect((JSON.parse(manifest) as RegistryDnsProbeManifest).spec.containers[0]?.args[0]).toContain(
      '.catch((error)=>console.log(JSON.stringify({status:"unresolved"',
    );
  });

  it('emits structured results and exits successfully for both resolved and unresolved names', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok(podPhase('Succeeded')))
      .mockResolvedValueOnce(ok(resolvedOutput([registryClusterIp])))
      .mockResolvedValueOnce(ok('deleted'));
    await waitForKubernetesInstallRegistryDns(input(), state());
    const manifest: RegistryDnsProbeManifest = JSON.parse(
      String(mocks.runCommandWithInput.mock.calls[0]?.[1]),
    ) as RegistryDnsProbeManifest;
    const script: string = manifest.spec.containers[0]?.args[0] ?? '';
    const resolved: SpawnSyncReturns<string> = runProbeScript(script, 'localhost');
    const unresolved: SpawnSyncReturns<string> = runProbeScript(script, 'registry.definitely-not-allocated.invalid');
    const resolvedProbeOutput: RegistryDnsProbeExecutionFixture = JSON.parse(
      resolved.stdout,
    ) as RegistryDnsProbeExecutionFixture;
    const unresolvedOutput: RegistryDnsProbeExecutionFixture = JSON.parse(
      unresolved.stdout,
    ) as RegistryDnsProbeExecutionFixture;

    expect(resolved.status).toBe(0);
    expect(resolvedProbeOutput.status).toBe('resolved');
    expect(
      resolvedProbeOutput.answers?.every(
        (answer: RegistryDnsAnswerFixture): boolean => typeof answer.address === 'string',
      ),
    ).toBe(true);
    expect(unresolved.status).toBe(0);
    expect(unresolvedOutput.status).toBe('unresolved');
    expect(unresolvedOutput.error?.code).toBe('ENOTFOUND');
    expect(unresolvedOutput.error?.message).toContain('registry.definitely-not-allocated.invalid');
  });

  it('uses the effective Helm worker image without requiring a Worker Deployment', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok(podPhase('Succeeded')))
      .mockResolvedValueOnce(ok(resolvedOutput([registryClusterIp])))
      .mockResolvedValueOnce(ok('deleted'));

    await expect(waitForKubernetesInstallRegistryDns(input(), state())).resolves.toBeNull();

    expect(mocks.runCommand).toHaveBeenCalledTimes(2);
    expect(mocks.runCommand.mock.calls[1]?.[0]).toEqual(
      expect.arrayContaining(['helm', 'get', 'values', 'compartment', '--all', '--output', 'json']),
    );
    expect(mocks.runCommand.mock.calls.flat().join(' ')).not.toContain('deployment/compartment-compartment-worker');
    expect(String(mocks.runCommandWithInput.mock.calls[0]?.[1])).toContain(`"image":"${workerImage}"`);
  });

  it('prints the exact required record when a node resolver points elsewhere', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok(podPhase('Succeeded')))
      .mockResolvedValueOnce(ok(resolvedOutput([publicDnsAnswer])))
      .mockResolvedValueOnce(ok('deleted'));

    const failure: Promise<string | null> = waitForKubernetesInstallRegistryDns(input(), state());
    await expect(failure).rejects.toThrow(`required record: registry.apps.example.com A ${registryClusterIp}`);
    await expect(failure).rejects.toThrow('rebind-domain-ok=/apps.example.com/');
  });

  it('requires every retained registry-auth address from a dual-stack resolver', async (): Promise<void> => {
    mocks.runCommand
      .mockReset()
      .mockResolvedValueOnce(ok(JSON.stringify({ spec: { clusterIPs: [registryClusterIp, registryClusterIpv6] } })))
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
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok(podPhase('Succeeded')))
      .mockResolvedValueOnce(ok(resolvedOutput([registryClusterIp])))
      .mockResolvedValueOnce(ok('deleted'));

    await expect(waitForKubernetesInstallRegistryDns(input(), state())).rejects.toThrow(
      `registry.apps.example.com AAAA ${registryClusterIpv6}`,
    );
  });

  it('requires the retained registry-auth ClusterIP from managed-domain node resolvers', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok(podPhase('Succeeded')))
      .mockResolvedValueOnce(ok(resolvedOutput([registryClusterIp])))
      .mockResolvedValueOnce(ok('deleted'));

    await expect(
      waitForKubernetesInstallRegistryDns(input(), { ...state(), domainMode: 'managed' }),
    ).resolves.toBeNull();

    expect(mocks.readReadyNodes).toHaveBeenCalledOnce();
  });

  it('reports a structured managed DNS failure without failing before the final image-pull gate', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok(podPhase('Succeeded')))
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            error: {
              code: 'ENOTFOUND',
              message: 'getaddrinfo ENOTFOUND registry.apps.example.com',
            },
            status: 'unresolved',
          }),
        ),
      )
      .mockResolvedValueOnce(ok('deleted'));

    const warning: string | null = await waitForKubernetesInstallRegistryDns(input(), {
      ...state(),
      domainMode: 'managed',
    });

    expect(warning).toContain('WARNING:');
    expect(warning).toContain('registry.apps.example.com could not be resolved');
    expect(warning).toContain('ENOTFOUND');
    expect(warning).toContain('installation will continue to the node image-pull verification');
    expect(mocks.runCommandWithInput).toHaveBeenCalledOnce();
    const manifest: RegistryDnsProbeManifest = JSON.parse(
      String(mocks.runCommandWithInput.mock.calls[0]?.[1]),
    ) as RegistryDnsProbeManifest;
    expect(manifest.metadata.name).toBe('registry-dns-preflight-0');
    expect(manifest.spec.containers[0]?.args[0]).toContain('status:"unresolved"');
  });

  it('stops immediately when the probe Pod reaches a failed terminal phase', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(ok(podPhase('Failed')))
      .mockResolvedValueOnce(ok('probe crashed'))
      .mockResolvedValueOnce(ok('deleted'));

    await expect(waitForKubernetesInstallRegistryDns(input(), state())).rejects.toThrow(
      'Registry DNS probe pod registry-dns-preflight-0 on node node-a reached terminal phase Failed. Logs: probe crashed',
    );

    expect(mocks.runCommandWithTimeout).toHaveBeenCalledTimes(3);
    expect(mocks.runCommandWithTimeout.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining(['get', 'pod/registry-dns-preflight-0']),
    );
  });
});

function input(): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: 'admin@example.com',
    clearConfiguredIngressEndpoint: false,
    configuredIngressEndpoint: null,
    domainMode: 'custom',
    ingressClassName: 'traefik',
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
    managedDomainAcmeDnsToken: '',
    publicProtocol: 'https',
    registryHostname: 'registry.apps.example.com',
    registryIssuerRef: { group: 'cert-manager.io', kind: 'ClusterIssuer', name: 'letsencrypt-production' },
    tlsMode: 'issuer',
  };
}

function ok(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

function podPhase(phase: string): string {
  return JSON.stringify({ status: { phase } });
}

function resolvedOutput(addresses: readonly string[]): string {
  return JSON.stringify({
    answers: addresses.map((address: string): RegistryDnsAnswerFixture => ({ address, family: 4 })),
    status: 'resolved',
  });
}

function runProbeScript(script: string, hostname: string): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, REGISTRY_HOST: hostname },
  });
}
