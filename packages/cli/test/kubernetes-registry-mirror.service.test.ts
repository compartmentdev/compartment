import { parse } from 'yaml';
import type { JsonValue } from '@compartment/utils';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import { renderRegistryMirrorApplyResult } from '../src/commands/registry-mirror.output';
import {
  createKubernetesRegistryMirror,
  isLocalK3sKubeconfigChain,
  mergeKubernetesRegistryMirrorConfig,
} from '../src/services/kubernetes-registry-mirror-config.service';
import {
  applyKubernetesRegistryMirror,
  hasMultipleKubernetesNodes,
  renderKubernetesRegistryMirrorInstructions,
} from '../src/services/kubernetes-registry-mirror.service';
import type {
  KubernetesRegistryMirror,
  KubernetesRegistryMirrorApplyResult,
} from '../src/services/kubernetes-registry-mirror.service.types';
import type { KubernetesOperatorTarget } from '../src/services/kubernetes-operator.service.types';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;

interface RegistryMirrorServiceMocks {
  lstat: Mock<(path: string) => Promise<never>>;
  readFile: Mock<(path: string, encoding: string) => Promise<string>>;
  rename: Mock<(source: string, destination: string) => Promise<void>>;
  runCommand: Mock<RunCommand>;
  unlink: Mock<(path: string) => Promise<void>>;
  writeFile: Mock<(path: string, config: string) => Promise<void>>;
}

interface RegistryMirrorFileState {
  config?: string | undefined;
  temporaryConfig?: string | undefined;
}

const fileState: RegistryMirrorFileState = {};
const mocks: RegistryMirrorServiceMocks = vi.hoisted(
  (): RegistryMirrorServiceMocks => ({
    lstat: vi.fn<(path: string) => Promise<never>>(),
    readFile: vi.fn<(path: string, encoding: string) => Promise<string>>(),
    rename: vi.fn<(source: string, destination: string) => Promise<void>>(),
    runCommand: vi.fn<RunCommand>(),
    unlink: vi.fn<(path: string) => Promise<void>>(),
    writeFile: vi.fn<(path: string, config: string) => Promise<void>>(),
  }),
);

vi.mock('../src/command-runner', (): object => ({ runCommand: mocks.runCommand }));
vi.mock('node:fs/promises', (): object => ({
  access: vi.fn(),
  lstat: mocks.lstat,
  readFile: mocks.readFile,
  realpath: vi.fn(),
  rename: mocks.rename,
  unlink: mocks.unlink,
  writeFile: mocks.writeFile,
}));

const serviceClusterIp: string = ['10', '43', '210', '17'].join('.');
const staleClusterIp: string = ['10', '43', '99', '8'].join('.');
const registryMirror: KubernetesRegistryMirror = createKubernetesRegistryMirror(
  'compartment-compartment-registry-auth',
  'compartment',
  serviceClusterIp,
);

describe('Kubernetes registry mirror setup', (): void => {
  beforeEach((): void => {
    fileState.config = undefined;
    fileState.temporaryConfig = undefined;
    mocks.lstat.mockReset().mockRejectedValue(createMissingFileError());
    mocks.readFile.mockReset().mockImplementation(async (): Promise<string> => {
      await Promise.resolve();
      if (fileState.config === undefined) {
        throw createMissingFileError();
      }
      return fileState.config;
    });
    mocks.rename.mockReset().mockImplementation(async (): Promise<void> => {
      await Promise.resolve();
      fileState.config = fileState.temporaryConfig;
      fileState.temporaryConfig = undefined;
    });
    mocks.runCommand.mockReset().mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
    mocks.unlink.mockReset().mockResolvedValue(undefined);
    mocks.writeFile.mockReset().mockImplementation(async (_path: string, config: string): Promise<void> => {
      await Promise.resolve();
      fileState.temporaryConfig = config;
    });
  });

  it('renders the exact k3s registry mirror format for the installed Service', (): void => {
    expect(mergeKubernetesRegistryMirrorConfig('', registryMirror)).toBe(
      `mirrors:
  compartment-compartment-registry-auth.compartment.svc:5000:
    endpoint:
      - http://${serviceClusterIp}:5000
`,
    );
    const instructions: string = renderKubernetesRegistryMirrorInstructions(registryMirror);
    expect(instructions).toContain('1. Install Compartment CLI');
    expect(instructions).toContain('2. Run:');
    expect(instructions).toContain('system registry-mirror apply');
    expect(instructions).toContain('restarts k3s when the config changes');
  });

  it('renders config that is already current for the merge and post-check path', (): void => {
    const renderedConfig: string = mergeKubernetesRegistryMirrorConfig('', registryMirror);

    expect(mergeKubernetesRegistryMirrorConfig(renderedConfig, registryMirror)).toBe(renderedConfig);
  });

  it('detects when registry mirror instructions are needed for additional nodes', async (): Promise<void> => {
    mocks.runCommand
      .mockResolvedValueOnce({ exitCode: 0, stderr: '', stdout: '{"items":[{"metadata":{"name":"node-1"}}]}' })
      .mockResolvedValueOnce({
        exitCode: 0,
        stderr: '',
        stdout: '{"items":[{"metadata":{"name":"node-1"}},{"metadata":{"name":"node-2"}}]}',
      });
    const target: KubernetesOperatorTarget = { namespace: 'compartment', releaseName: 'compartment' };

    await expect(hasMultipleKubernetesNodes(target)).resolves.toBe(false);
    await expect(hasMultipleKubernetesNodes(target)).resolves.toBe(true);
  });

  it('applies a fresh config without a warning and skips the restart when applied again', async (): Promise<void> => {
    const firstResult: KubernetesRegistryMirrorApplyResult = await applyKubernetesRegistryMirror(registryMirror);
    const capture: CliCommandCapture = createCliCapture();

    renderRegistryMirrorApplyResult(capture.io, firstResult);

    expect(firstResult).toEqual({ configChanged: true, current: true });
    expect(readCliStderr(capture)).not.toContain('Warning:');
    expect(readCliStderr(capture)).toContain('Restarted k3s');

    const secondResult: KubernetesRegistryMirrorApplyResult = await applyKubernetesRegistryMirror(registryMirror);

    expect(secondResult).toEqual({ configChanged: false, current: true });
    expect(mocks.runCommand).toHaveBeenCalledTimes(1);
    expect(mocks.runCommand).toHaveBeenCalledWith(['systemctl', 'restart', 'k3s']);
  });

  it('updates only the installed registry endpoint and keeps foreign registry configuration', (): void => {
    const existingConfig: string = `mirrors:
  "docker.io":
    endpoint:
      - "https://mirror.example.com"
  "compartment-compartment-registry-auth.compartment.svc:5000":
    endpoint:
      - "http://${staleClusterIp}:5000"
    rewrite:
      "^library/(.*)": "mirror/$1"
configs:
  "docker.io":
    tls:
      insecure_skip_verify: true
`;

    const mergedConfig: string = mergeKubernetesRegistryMirrorConfig(existingConfig, registryMirror);
    const parsedConfig: JsonValue = parse(mergedConfig) as JsonValue;

    expect(parsedConfig).toEqual({
      configs: {
        'docker.io': { tls: { insecure_skip_verify: true } },
      },
      mirrors: {
        'compartment-compartment-registry-auth.compartment.svc:5000': {
          endpoint: [`http://${serviceClusterIp}:5000`],
          rewrite: { '^library/(.*)': 'mirror/$1' },
        },
        'docker.io': { endpoint: ['https://mirror.example.com'] },
      },
    });
    expect(mergeKubernetesRegistryMirrorConfig(mergedConfig, registryMirror)).toBe(mergedConfig);
  });

  it('does not auto-apply for the k3d harness kubeconfig or an ambiguous kubeconfig chain', (): void => {
    expect(isLocalK3sKubeconfigChain({}, undefined)).toBe(false);
    expect(isLocalK3sKubeconfigChain({ KUBECONFIG: '/tmp/compartment-k3d/kubeconfig.yaml' }, undefined)).toBe(false);
    expect(
      isLocalK3sKubeconfigChain(
        {
          KUBECONFIG: `/etc/rancher/k3s/k3s.yaml${process.platform === 'win32' ? ';' : ':'}/tmp/other.yaml`,
        },
        undefined,
      ),
    ).toBe(false);
    expect(isLocalK3sKubeconfigChain({ KUBECONFIG: '/etc/rancher/k3s/k3s.yaml' }, 'remote')).toBe(false);
    expect(isLocalK3sKubeconfigChain({ KUBECONFIG: '/etc/rancher/k3s/k3s.yaml' }, undefined)).toBe(true);
  });
});

function createMissingFileError(): NodeJS.ErrnoException {
  return Object.assign(new Error('missing registry config'), { code: 'ENOENT' });
}
