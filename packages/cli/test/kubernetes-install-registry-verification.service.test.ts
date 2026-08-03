import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { verifyKubernetesInstallRegistryNodePull } from '../src/services/kubernetes-install-registry-verification.service';
import type { KubernetesInstallDeploymentInput } from '../src/services/kubernetes-install.service.types';

type RunCommandWithInputCall = [command: readonly string[], input: string];
interface VerificationPodManifest {
  spec: { nodeName: string };
}

interface RegistryVerificationMocks {
  runCommand: Mock<(command: readonly string[]) => Promise<CommandResult>>;
  runCommandWithInput: Mock<(command: readonly string[], input: string) => Promise<CommandResult>>;
  runCommandWithTimeout: Mock<
    (command: readonly string[], timeoutMs: number, env?: NodeJS.ProcessEnv) => Promise<CommandResult>
  >;
}

const mocks: RegistryVerificationMocks = vi.hoisted(
  (): RegistryVerificationMocks => ({
    runCommand: vi.fn(),
    runCommandWithInput: vi.fn(),
    runCommandWithTimeout: vi.fn(),
  }),
);

vi.mock('../src/command-runner', (): object => ({
  runCommand: mocks.runCommand,
  runCommandWithInput: mocks.runCommandWithInput,
  runCommandWithTimeout: mocks.runCommandWithTimeout,
}));

describe('install registry node-pull verification', (): void => {
  beforeEach((): void => {
    mocks.runCommand.mockReset().mockResolvedValue(
      ok(
        JSON.stringify({
          spec: { clusterIP: [10, 43, 251, 103].join('.'), clusterIPs: [[10, 43, 251, 103].join('.')] },
        }),
      ),
    );
    mocks.runCommandWithInput.mockReset().mockResolvedValue(ok('applied'));
    mocks.runCommandWithTimeout.mockReset();
  });

  it('fails installation when kubelet cannot pull from the private endpoint and cleans temporary objects', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            dockerConfigJson: '{"auths":{"registry.example":{"auth":"signed"}}}',
            imageRef: `registry.example/projects/install_1/services/registry-acceptance@sha256:${'a'.repeat(64)}`,
          }),
        ),
      )
      .mockResolvedValueOnce(ok(readyNodes('node-a')))
      .mockResolvedValueOnce(failed('ImagePullBackOff'))
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            status: {
              containerStatuses: [
                {
                  state: {
                    waiting: {
                      message:
                        'failed to pull image: tls: failed to verify certificate: x509: certificate signed by unknown authority',
                      reason: 'ImagePullBackOff',
                    },
                  },
                },
              ],
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            items: [
              {
                message: 'Back-off pulling image because registry.example.test did not present trusted TLS',
                reason: 'BackOff',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(ok('deleted'));

    const failure: Promise<void> = verifyKubernetesInstallRegistryNodePull(input(), input());
    await expect(failure).rejects.toThrow('waiting reason ImagePullBackOff');
    await expect(failure).rejects.toThrow(
      `retained Service address ${[10, 43, 251, 103].join('.')} must be reachable from the node`,
    );
    await expect(failure).rejects.toThrow(
      'certificate issued by Issuer/platform-issuer with that IP SAN must be trusted by the node container runtime',
    );
    await expect(failure).rejects.toThrow(
      'if it was added later, restart the runtime (k3s server: systemctl restart k3s; k3s agent: systemctl restart k3s-agent)',
    );

    expect(mocks.runCommandWithTimeout.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining(['delete', 'pod/registry-acceptance-0', 'secret/compartment-registry-acceptance']),
    );
  });

  it('pulls a fresh private-hostname image on every eligible Ready node', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            dockerConfigJson: '{"auths":{"registry.example":{"auth":"signed"}}}',
            imageRef: `registry.example/projects/install_1/services/registry-acceptance@sha256:${'a'.repeat(64)}`,
          }),
        ),
      )
      .mockResolvedValueOnce(ok(readyNodes('node-a', 'node-b')))
      .mockResolvedValueOnce(ok('ready'))
      .mockResolvedValueOnce(ok('ready'))
      .mockResolvedValueOnce(ok('deleted'));

    await expect(verifyKubernetesInstallRegistryNodePull(input(), input())).resolves.toBeUndefined();

    const podManifests: string[] = mocks.runCommandWithInput.mock.calls
      .slice(1)
      .map((call: RunCommandWithInputCall): string => call[1]);
    expect(podManifests).toHaveLength(2);
    expect(podManifests.every((manifest: string): boolean => manifest.includes('"imagePullPolicy":"Always"'))).toBe(
      true,
    );
    expect(
      podManifests.map((manifest: string): string => (JSON.parse(manifest) as VerificationPodManifest).spec.nodeName),
    ).toEqual(['node-a', 'node-b']);
  });

  it('classifies node resolver failures without softening TLS failures', async (): Promise<void> => {
    mocks.runCommandWithTimeout
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            dockerConfigJson: '{"auths":{"registry.example":{"auth":"signed"}}}',
            imageRef: `registry.example/projects/install_1/services/registry-acceptance@sha256:${'a'.repeat(64)}`,
          }),
        ),
      )
      .mockResolvedValueOnce(ok(readyNodes('node-a')))
      .mockResolvedValueOnce(failed('ImagePullBackOff'))
      .mockResolvedValueOnce(ok(JSON.stringify({ status: { containerStatuses: [] } })))
      .mockResolvedValueOnce(
        ok(
          JSON.stringify({
            items: [
              {
                message:
                  'failed to resolve reference: Head https://registry.example.test/v2/: dial tcp: lookup registry.example.test: no such host',
                reason: 'Failed',
              },
            ],
          }),
        ),
      )
      .mockResolvedValueOnce(ok('deleted'));

    await expect(verifyKubernetesInstallRegistryNodePull(input(), input())).rejects.toThrow('no such host');
  });

  it('reports a timed-out registry command even when kubectl emits no diagnostics', async (): Promise<void> => {
    mocks.runCommandWithTimeout.mockResolvedValue({ exitCode: 124, stderr: '', stdout: '' });

    await expect(verifyKubernetesInstallRegistryNodePull(input(), input())).rejects.toThrow(
      'Registry acceptance image push failed (command timed out): the command produced no diagnostics',
    );
  });
});

function input(): KubernetesInstallDeploymentInput {
  const registryClusterIp: string = [10, 43, 251, 103].join('.');
  return {
    acmeEmail: 'admin@example.com',
    clearConfiguredIngressEndpoint: false,
    configuredIngressEndpoint: null,
    domainMode: 'custom',
    ingressClassName: 'traefik',
    namespace: 'compartment',
    registryHostname: registryClusterIp,
    registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'platform-issuer' },
    releaseName: 'compartment',
    valuesPath: 'values.yaml',
  };
}

function readyNodes(...names: string[]): string {
  return JSON.stringify({
    items: names.map((name: string): object => ({
      metadata: { name },
      spec: {},
      status: { conditions: [{ status: 'True', type: 'Ready' }] },
    })),
  });
}

function ok(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

function failed(stderr: string): CommandResult {
  return { exitCode: 1, stderr, stdout: '' };
}
