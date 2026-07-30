import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CliBuildInfo } from '../src/cli-build-info.types';
import type { CommandResult } from '../src/command-runner.types';
import { runKubernetesHelmInstallStage } from '../src/services/kubernetes-install-helm.service';
import { prepareKubernetesInstallHelmMaterial } from '../src/services/kubernetes-install-material.service';
import type {
  KubernetesInstallDeploymentInput,
  KubernetesInstallHelmMaterial,
} from '../src/services/kubernetes-install.service.types';

type ReadCliBuildInfo = () => CliBuildInfo;
type RunCommand = (command: readonly string[]) => Promise<CommandResult>;

interface VerifyInstallImagesInput {
  overrideValuesPaths: readonly string[];
  outputPath: string;
}

type VerifyInstallImages = (input: VerifyInstallImagesInput) => Promise<void>;

interface InstallMaterialMocks {
  readCliBuildInfo: Mock<ReadCliBuildInfo>;
  runCommand: Mock<RunCommand>;
  verifyInstallImages: Mock<VerifyInstallImages>;
}

const mocks: InstallMaterialMocks = vi.hoisted(
  (): InstallMaterialMocks => ({
    readCliBuildInfo: vi.fn<ReadCliBuildInfo>(),
    runCommand: vi.fn<RunCommand>(),
    verifyInstallImages: vi.fn<VerifyInstallImages>(),
  }),
);

vi.mock('../src/cli-build-info', (): object => ({ readCliBuildInfo: mocks.readCliBuildInfo }));
vi.mock('../src/command-runner', (): object => ({
  runCommand: mocks.runCommand,
  runCommandWithTimeout: mocks.runCommand,
}));
vi.mock('../src/services/kubernetes-image-trust.service', (): object => ({
  writeVerifiedKubernetesInstallImageValues: mocks.verifyInstallImages,
}));

describe('Kubernetes install Helm material', (): void => {
  beforeEach((): void => {
    mocks.runCommand.mockResolvedValue({ exitCode: 0, stderr: '', stdout: '' });
    mocks.verifyInstallImages.mockImplementation(async (input: VerifyInstallImagesInput): Promise<void> => {
      await writeFile(input.outputPath, JSON.stringify({ images: { api: { digest: `sha256:${'a'.repeat(64)}` } } }));
    });
  });

  afterEach((): void => {
    mocks.readCliBuildInfo.mockReset();
    mocks.runCommand.mockReset();
    mocks.verifyInstallImages.mockReset();
  });

  it('defaults every platform image tag to the release CLI version before operator values', async (): Promise<void> => {
    mocks.readCliBuildInfo.mockReturnValue({ cliVersion: '0.9.2', distributionChannel: 'release' });
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-install-material-test-'));
    try {
      const valuesPath: string = resolve(directory, 'values.yaml');
      await writeFile(valuesPath, '{}');

      const material: KubernetesInstallHelmMaterial = await prepareKubernetesInstallHelmMaterial(
        installInput(directory, valuesPath),
        directory,
      );
      await writeFile(material.installValuesPath, '{}');
      await runInstallStage(directory, valuesPath, material);

      expect(JSON.parse(await readFile(material.platformImageValuesPath, 'utf8'))).toEqual({
        images: {
          api: { digest: '', tag: '0.9.2' },
          caddy: { digest: '', tag: '0.9.2' },
          dns01Solver: { digest: '', tag: '0.9.2' },
          edge: { digest: '', tag: '0.9.2' },
          worker: { digest: '', tag: '0.9.2' },
        },
      });
      expect(readVerificationInput().overrideValuesPaths).toEqual([material.platformImageValuesPath, valuesPath]);
      expect(readHelmValuesPaths()).toEqual([
        material.platformImageValuesPath,
        valuesPath,
        material.installValuesPath,
        material.imageTrustValuesPath,
      ]);
      expect(await readFile(material.platformImageValuesPath, 'utf8')).not.toContain('latest');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('keeps explicit operator image selection after packaged defaults', async (): Promise<void> => {
    mocks.readCliBuildInfo.mockReturnValue({ cliVersion: '0.9.2', distributionChannel: 'release' });
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-install-material-test-'));
    try {
      const valuesPath: string = resolve(directory, 'values.yaml');
      await writeFile(
        valuesPath,
        'images:\n  api:\n    repository: registry.example/compartment-api\n    tag: operator-tag\n',
      );

      const material: KubernetesInstallHelmMaterial = await prepareKubernetesInstallHelmMaterial(
        installInput(directory, valuesPath),
        directory,
      );
      await writeFile(material.installValuesPath, '{}');
      await runInstallStage(directory, valuesPath, material);

      expect(readVerificationInput().overrideValuesPaths).toEqual([material.platformImageValuesPath, valuesPath]);
      expect(readHelmValuesPaths().slice(0, 2)).toEqual([material.platformImageValuesPath, valuesPath]);
      expect(await readFile(valuesPath, 'utf8')).toContain('tag: operator-tag');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

async function runInstallStage(
  directory: string,
  valuesPath: string,
  material: KubernetesInstallHelmMaterial,
): Promise<void> {
  await runKubernetesHelmInstallStage(
    installInput(directory, valuesPath),
    material.chartPath,
    material.platformImageValuesPath,
    material.installValuesPath,
    material.imageTrustValuesPath,
    'foundation',
  );
}

function installInput(directory: string, valuesPath: string): KubernetesInstallDeploymentInput {
  return {
    acmeEmail: '',
    baseDomain: 'compartment.localhost',
    chartPath: resolve(directory, 'chart'),
    clearConfiguredIngressEndpoint: false,
    configuredIngressEndpoint: null,
    domainMode: 'custom',
    ingressClassName: 'traefik',
    namespace: 'compartment',
    registryHostname: 'registry.compartment.localhost',
    registryIssuerRef: { group: 'cert-manager.io', kind: 'Issuer', name: 'platform-issuer' },
    releaseName: 'compartment',
    valuesPath,
  };
}

function readVerificationInput(): VerifyInstallImagesInput {
  const call: [VerifyInstallImagesInput] | undefined = mocks.verifyInstallImages.mock.calls[0];
  if (call === undefined) {
    throw new Error('Expected install image verification.');
  }
  return call[0];
}

function readHelmValuesPaths(): string[] {
  const call: [readonly string[]] | undefined = mocks.runCommand.mock.calls[0];
  if (call === undefined) {
    throw new Error('Expected a Helm install command.');
  }
  return call[0].flatMap((value: string, index: number, command: readonly string[]): string[] => {
    const valuesPath: string | undefined = command[index + 1];
    return value === '--values' && valuesPath !== undefined ? [valuesPath] : [];
  });
}
