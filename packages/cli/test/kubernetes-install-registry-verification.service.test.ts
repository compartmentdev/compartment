import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { verifyKubernetesInstallRegistryNodePull } from '../src/services/kubernetes-install-registry-verification.service';
import type { KubernetesInstallDeploymentInput } from '../src/services/kubernetes-install.service.types';

type RunCommandWithInputCall = [command: readonly string[], input: string];
interface VerificationPodManifest {
  spec: { nodeName: string };
}

interface RegistryVerificationMocks {
  runCommandWithInput: Mock<(command: readonly string[], input: string) => Promise<CommandResult>>;
  runCommandWithTimeout: Mock<
    (command: readonly string[], timeoutMs: number, env?: NodeJS.ProcessEnv) => Promise<CommandResult>
  >;
}

const mocks: RegistryVerificationMocks = vi.hoisted(
  (): RegistryVerificationMocks => ({
    runCommandWithInput: vi.fn(),
    runCommandWithTimeout: vi.fn(),
  }),
);

vi.mock('../src/command-runner', (): object => ({
  runCommandWithInput: mocks.runCommandWithInput,
  runCommandWithTimeout: mocks.runCommandWithTimeout,
}));

describe('install registry node-pull verification', (): void => {
  beforeEach((): void => {
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
      .mockResolvedValueOnce(ok('deleted'));

    await expect(verifyKubernetesInstallRegistryNodePull(input())).rejects.toThrow(
      'Registry node pull failed on node-a: ImagePullBackOff',
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

    await expect(verifyKubernetesInstallRegistryNodePull(input())).resolves.toBeUndefined();

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
});

function input(): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: 'admin@example.com',
    domainMode: 'custom',
    namespace: 'compartment',
    registryHostname: 'registry.example.test',
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
