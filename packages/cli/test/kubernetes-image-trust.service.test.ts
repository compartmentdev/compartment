import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { selfHostedRuntimeImageSignaturePolicy } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import {
  writeVerifiedKubernetesInstallImageValues,
  writeVerifiedKubernetesReleaseImageValues,
} from '../src/services/kubernetes-image-trust.service';
import type { KubernetesVerifiedPlatformImageValues } from '../src/services/kubernetes-image-trust.service.types';
import { deployAndWaitForKubernetesInstall } from '../src/services/kubernetes-install.service';
import type { KubernetesInstallDeploymentInput } from '../src/services/kubernetes-install.service.types';

type RunCommand = (command: readonly string[], env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
type RunCommandCall = [command: readonly string[], env?: NodeJS.ProcessEnv | undefined];

interface ImageTrustMocks {
  runCommand: Mock<RunCommand>;
}

interface CapturedActivation {
  trustValues: KubernetesVerifiedPlatformImageValues | null;
}

const mocks: ImageTrustMocks = vi.hoisted((): ImageTrustMocks => ({ runCommand: vi.fn<RunCommand>() }));

vi.mock('../src/command-runner', (): object => ({ runCommand: mocks.runCommand }));

const digestByImageName: Readonly<Record<string, string>> = Object.freeze({
  api: `sha256:${'a'.repeat(64)}`,
  caddy: `sha256:${'d'.repeat(64)}`,
  edge: `sha256:${'c'.repeat(64)}`,
  worker: `sha256:${'b'.repeat(64)}`,
});

describe('Kubernetes platform image trust', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
    vi.unstubAllEnvs();
  });

  it('verifies effective platform refs and writes immutable digest overrides', async (): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    try {
      const operatorValuesPath: string = resolve(directory, 'values.yaml');
      const outputPath: string = resolve(directory, 'verified.json');
      await writeFile(
        operatorValuesPath,
        'images:\n  api:\n    repository: registry.example/compartment-api\n    tag: sha-release\n',
      );
      vi.stubEnv('COMPARTMENT_SECRET_SENTINEL', 'must-not-reach-cosign');
      mocks.runCommand.mockImplementation(createVerificationHandler());

      await writeVerifiedKubernetesInstallImageValues({
        chartPath: resolve(directory, 'chart'),
        operatorValuesPath,
        outputPath,
      });

      const values: KubernetesVerifiedPlatformImageValues = JSON.parse(
        await readFile(outputPath, 'utf8'),
      ) as KubernetesVerifiedPlatformImageValues;
      expect(values).toEqual({
        images: {
          api: { digest: digestByImageName.api },
          caddy: { digest: digestByImageName.caddy },
          edge: { digest: digestByImageName.edge },
          worker: { digest: digestByImageName.worker },
        },
      });
      const cosignCalls: RunCommandCall[] = mocks.runCommand.mock.calls.filter(
        (call: RunCommandCall): boolean => call[0][1] === 'verify',
      );
      expect(cosignCalls).toHaveLength(4);
      expect(cosignCalls[0]?.[0]).toContain('registry.example/compartment-api:sha-release');
      expect(cosignCalls[0]?.[0]).toEqual(
        expect.arrayContaining([
          selfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer,
          selfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp,
          '--output',
          'json',
        ]),
      );
      expect(cosignCalls[0]?.[1]).not.toHaveProperty('COMPARTMENT_SECRET_SENTINEL');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('verifies operator image overrides against effective reused release values', async (): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    try {
      const operatorValuesPath: string = resolve(directory, 'values.yaml');
      const outputPath: string = resolve(directory, 'verified.json');
      await writeFile(operatorValuesPath, "images:\n  api:\n    digest: ''\n    tag: replacement\n");
      mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
        if (command[1] === 'get') {
          return successfulResult(JSON.stringify(releaseImageValues()));
        }
        return await createVerificationHandler()(command);
      });

      await writeVerifiedKubernetesReleaseImageValues({
        namespace: 'compartment',
        operatorValuesPath,
        outputPath,
        releaseName: 'compartment',
      });

      const apiVerifyCall: RunCommandCall | undefined = mocks.runCommand.mock.calls.find(
        (call: RunCommandCall): boolean => call[0].at(-1)?.includes('compartment-api') ?? false,
      );
      expect(apiVerifyCall?.[0].at(-1)).toBe('ghcr.io/compartmentdev/compartment-api:replacement');
      expect(JSON.parse(await readFile(outputPath, 'utf8'))).toMatchObject({
        images: { api: { digest: digestByImageName.api } },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.each([
    ['empty', '[]', 'no verified signatures'],
    ['malformed', '{', 'invalid JSON'],
    [
      'attestation-only',
      JSON.stringify([cosignAttestation(`sha256:${'a'.repeat(64)}`)]),
      'no verified image signatures',
    ],
    [
      'mixed',
      JSON.stringify([cosignSignature(`sha256:${'a'.repeat(64)}`), cosignSignature(`sha256:${'b'.repeat(64)}`)]),
      'mixed manifest digests',
    ],
  ])(
    'rejects %s cosign verification output',
    async (_label: string, output: string, message: string): Promise<void> => {
      const directory: string = await createTemporaryDirectory();
      try {
        const operatorValuesPath: string = resolve(directory, 'values.yaml');
        await writeFile(operatorValuesPath, '{}');
        mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
          await Promise.resolve();
          if (command[1] === 'show') {
            return await Promise.resolve(successfulResult(chartImageValues()));
          }
          return await Promise.resolve(successfulResult(output));
        });

        await expect(
          writeVerifiedKubernetesInstallImageValues({
            chartPath: resolve(directory, 'chart'),
            operatorValuesPath,
            outputPath: resolve(directory, 'verified.json'),
          }),
        ).rejects.toThrow(message);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  it.each([
    ['unsigned', 'no matching signatures'],
    ['wrong identity', 'certificate identity mismatch'],
  ])('does not call Helm upgrade when an image is %s', async (_label: string, cosignError: string): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    try {
      const input: KubernetesInstallDeploymentInput = await createInstallInput(directory);
      mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
        await Promise.resolve();
        if (command[0] === 'kubectl') {
          return await Promise.resolve(successfulResult('{"items":[]}'));
        }
        if (command[1] === 'list') {
          return await Promise.resolve(successfulResult('[]'));
        }
        if (command[1] === 'show') {
          return await Promise.resolve(successfulResult(chartImageValues()));
        }
        if (command[1] === 'verify') {
          return await Promise.resolve({ exitCode: 1, stderr: cosignError, stdout: '' });
        }
        throw new Error(`Unexpected command: ${command.join(' ')}`);
      });

      await expect(deployAndWaitForKubernetesInstall(input)).rejects.toThrow(cosignError);
      expect(readHelmUpgradeCalls()).toHaveLength(0);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('places verified digest values after operator values before the first Helm activation', async (): Promise<void> => {
    const directory: string = await createTemporaryDirectory();
    try {
      const input: KubernetesInstallDeploymentInput = await createInstallInput(directory);
      const captured: CapturedActivation = { trustValues: null };
      mocks.runCommand.mockImplementation(createActivationHandler(captured));

      await expect(deployAndWaitForKubernetesInstall(input)).rejects.toThrow('activation sentinel');
      expect(captured.trustValues).toEqual({
        images: {
          api: { digest: digestByImageName.api },
          caddy: { digest: digestByImageName.caddy },
          edge: { digest: digestByImageName.edge },
          worker: { digest: digestByImageName.worker },
        },
      });
      const commands: readonly (readonly string[])[] = mocks.runCommand.mock.calls.map(
        (call: RunCommandCall): readonly string[] => call[0],
      );
      const firstUpgradeIndex: number = commands.findIndex(
        (command: readonly string[]): boolean => command[1] === 'upgrade',
      );
      const lastCosignIndex: number = commands.findLastIndex(
        (command: readonly string[]): boolean => command[1] === 'verify',
      );
      expect(lastCosignIndex).toBeLessThan(firstUpgradeIndex);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

function createVerificationHandler(): RunCommand {
  return async (command: readonly string[]): Promise<CommandResult> => {
    await Promise.resolve();
    if (command[1] === 'show') {
      return await Promise.resolve(successfulResult(chartImageValues()));
    }
    const imageRef: string | undefined = command.at(-1);
    const imageName: string | undefined = imageRef?.match(/compartment-(api|worker|edge|caddy)/u)?.[1];
    const digest: string | undefined = imageName === undefined ? undefined : digestByImageName[imageName];
    if (digest === undefined) {
      throw new Error(`Unexpected verification command: ${command.join(' ')}`);
    }
    return await Promise.resolve(successfulResult(JSON.stringify([cosignSignature(digest)])));
  };
}

function createActivationHandler(captured: CapturedActivation): RunCommand {
  const verificationHandler: RunCommand = createVerificationHandler();
  return async (command: readonly string[], env?: NodeJS.ProcessEnv): Promise<CommandResult> => {
    if (command[0] === 'kubectl') {
      return successfulResult('{"items":[]}');
    }
    if (command[1] === 'list') {
      return successfulResult('[]');
    }
    if (command[1] === 'show' || command[1] === 'verify') {
      return await verificationHandler(command, env);
    }
    if (command[1] === 'upgrade') {
      const trustValuesPath: string = readLastOptionValue(command, '--values');
      captured.trustValues = JSON.parse(
        await readFile(trustValuesPath, 'utf8'),
      ) as KubernetesVerifiedPlatformImageValues;
      return { exitCode: 1, stderr: 'activation sentinel', stdout: '' };
    }
    throw new Error(`Unexpected command: ${command.join(' ')}`);
  };
}

async function createInstallInput(directory: string): Promise<KubernetesInstallDeploymentInput> {
  const valuesPath: string = resolve(directory, 'values.yaml');
  await writeFile(valuesPath, '{}');
  return {
    acmeEmail: '',
    apiUrl: 'http://console.compartment.localhost',
    baseDomain: 'compartment.localhost',
    chartPath: resolve(directory, 'chart'),
    domainMode: 'custom',
    namespace: 'compartment',
    releaseName: 'compartment',
    valuesPath,
  };
}

function readHelmUpgradeCalls(): readonly RunCommandCall[] {
  return mocks.runCommand.mock.calls.filter((call: RunCommandCall): boolean => call[0][1] === 'upgrade');
}

function readLastOptionValue(command: readonly string[], option: string): string {
  const optionIndex: number = command.lastIndexOf(option);
  const value: string | undefined = command[optionIndex + 1];
  if (optionIndex === -1 || value === undefined) {
    throw new Error(`Missing ${option} in command.`);
  }
  return value;
}

function chartImageValues(): string {
  return `images:
  api: { repository: ghcr.io/compartmentdev/compartment-api, tag: latest, digest: '' }
  worker: { repository: ghcr.io/compartmentdev/compartment-worker, tag: latest, digest: '' }
  edge: { repository: ghcr.io/compartmentdev/compartment-edge, tag: latest, digest: '' }
  caddy: { repository: ghcr.io/compartmentdev/compartment-caddy, tag: latest, digest: '' }
`;
}

function releaseImageValues(): object {
  return {
    images: {
      api: {
        digest: `sha256:${'e'.repeat(64)}`,
        repository: 'ghcr.io/compartmentdev/compartment-api',
        tag: 'old',
      },
      caddy: { digest: '', repository: 'ghcr.io/compartmentdev/compartment-caddy', tag: 'latest' },
      edge: { digest: '', repository: 'ghcr.io/compartmentdev/compartment-edge', tag: 'latest' },
      worker: { digest: '', repository: 'ghcr.io/compartmentdev/compartment-worker', tag: 'latest' },
    },
  };
}

function cosignSignature(digest: string): object {
  return {
    critical: {
      image: { 'docker-manifest-digest': digest },
      type: 'https://sigstore.dev/cosign/sign/v1',
    },
  };
}

function cosignAttestation(digest: string): object {
  return {
    critical: {
      image: { 'docker-manifest-digest': digest },
      type: 'https://cosign.sigstore.dev/attestation/v1',
    },
  };
}

function successfulResult(stdout: string): CommandResult {
  return { exitCode: 0, stderr: '', stdout };
}

async function createTemporaryDirectory(): Promise<string> {
  return await mkdtemp(resolve(tmpdir(), 'compartment-image-trust-test-'));
}
