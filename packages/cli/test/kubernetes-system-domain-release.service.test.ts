import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { CommandResult } from '../src/command-runner.types';
import type {
  KubernetesDomainCertificateInput,
  KubernetesDomainHelmValues,
  KubernetesOperatorTarget,
  StagedKubernetesDomainCertificate,
} from '../src/services/kubernetes-operator.service.types';
import {
  applyRuntimeKubernetesDomainRelease,
  commitActiveKubernetesDomainRelease,
  stageKubernetesDomainCertificate,
} from '../src/services/kubernetes-system-domain-release.service';

type RunCommand = (command: readonly string[]) => Promise<CommandResult>;
type RunCommandWithInput = (command: readonly string[], input: string) => Promise<CommandResult>;

interface DomainReleaseMocks {
  readPendingSecret: Mock<() => Promise<string | undefined>>;
  runCommand: Mock<RunCommand>;
  runCommandWithInput: Mock<RunCommandWithInput>;
}

const mocks: DomainReleaseMocks = vi.hoisted(
  (): DomainReleaseMocks => ({
    readPendingSecret: vi.fn<() => Promise<string | undefined>>(),
    runCommand: vi.fn<RunCommand>(),
    runCommandWithInput: vi.fn<RunCommandWithInput>(),
  }),
);

vi.mock('../src/command-runner', (): object => ({
  runCommand: mocks.runCommand,
  runCommandWithInput: mocks.runCommandWithInput,
}));
vi.mock('../src/services/kubernetes-system-domain-release-values.service', (): object => ({
  readPendingKubernetesDomainTlsSecretName: mocks.readPendingSecret,
}));

describe('Kubernetes system-domain release material', (): void => {
  afterEach((): void => {
    mocks.runCommand.mockReset();
    mocks.runCommandWithInput.mockReset();
    mocks.readPendingSecret.mockReset();
  });

  it('isolates pending certificate bytes in an operation-specific Secret', async (): Promise<void> => {
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-domain-test-'));
    try {
      const input: KubernetesDomainCertificateInput = await createCertificateInput(directory);
      const first: StagedKubernetesDomainCertificate = await stageKubernetesDomainCertificate(input, 'domop_123');
      const second: StagedKubernetesDomainCertificate = await stageKubernetesDomainCertificate(input, 'domop_456');

      expect(first.secretName).not.toBe(second.secretName);
      expect(first.certificate).toBe('certificate-bytes');
      expect(first.privateKey).toBe('private-key-bytes');
      expect(first.secretName).toMatch(/^domain-tls-/u);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('passes only Secret identity and domain generation to Helm activation', async (): Promise<void> => {
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-domain-test-'));
    try {
      const target: KubernetesOperatorTarget = await createReleaseTarget(directory);
      let helmValues: KubernetesDomainHelmValues | null = null;
      mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
        helmValues = await readHelmValues(command);
        return successfulCommand();
      });

      await applyRuntimeKubernetesDomainRelease(
        target,
        {
          baseDomain: 'apps.example.com',
          caddyMode: 'custom-cert',
          domainKind: 'custom',
          publicScheme: 'https',
          tlsMode: 'custom-cert',
        },
        7,
        'domop_123',
      );

      const renderedValues: KubernetesDomainHelmValues = requireHelmValues(helmValues);
      expect(renderedValues).toMatchObject({
        customTls: {
          pendingOperationId: 'domop_123',
        },
        platform: { baseDomain: 'apps.example.com', domainCommit: false, domainGeneration: 7, tlsMode: 'custom-cert' },
      });
      expect(renderedValues.customTls.existingSecret).toMatch(/^domain-tls-/u);
      expect(renderedValues.customTls.operatorSecretName).toBeUndefined();
      expect(JSON.stringify(renderedValues)).not.toContain('certificate-bytes');
      expect(JSON.stringify(renderedValues)).not.toContain('private-key-bytes');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('does not require pending TLS material for an external TLS activation', async (): Promise<void> => {
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-domain-test-'));
    try {
      const target: KubernetesOperatorTarget = await createReleaseTarget(directory);
      let helmValues: KubernetesDomainHelmValues | null = null;
      mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
        helmValues = await readHelmValues(command);
        return successfulCommand();
      });

      await applyRuntimeKubernetesDomainRelease(
        target,
        {
          baseDomain: 'apps.example.com',
          caddyMode: 'custom-http',
          domainKind: 'custom',
          publicScheme: 'https',
          tlsMode: 'external',
        },
        7,
        'domop_external',
      );

      expect(requireHelmValues(helmValues)).toMatchObject({
        customTls: { existingSecret: '' },
        platform: { domainCommit: false, tlsMode: 'custom-http' },
      });
      expect(requireHelmValues(helmValues).customTls.pendingOperationId).toBeUndefined();
      expect(requireHelmValues(helmValues).customTls.operatorSecretName).toBeUndefined();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('promotes the retained pending Secret when activation commit is retried after the API finalized', async (): Promise<void> => {
    const directory: string = await mkdtemp(resolve(tmpdir(), 'compartment-domain-test-'));
    try {
      const target: KubernetesOperatorTarget = await createReleaseTarget(directory);
      let helmValues: KubernetesDomainHelmValues | null = null;
      mocks.readPendingSecret.mockResolvedValue('pending-domain-tls');
      mocks.runCommand.mockImplementation(async (command: readonly string[]): Promise<CommandResult> => {
        helmValues = await readHelmValues(command);
        return successfulCommand();
      });

      await commitActiveKubernetesDomainRelease(
        target,
        {
          baseDomain: 'apps.example.com',
          caddyMode: 'custom-cert',
          domainKind: 'custom',
          publicScheme: 'https',
          tlsMode: 'custom-cert',
        },
        8,
      );

      expect(requireHelmValues(helmValues)).toMatchObject({
        customTls: {
          existingSecret: 'pending-domain-tls',
          operatorSecretName: 'pending-domain-tls',
          pendingOperationId: '',
          pendingSecretName: '',
        },
        platform: { domainCommit: true, domainGeneration: 8 },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

async function createCertificateInput(directory: string): Promise<KubernetesDomainCertificateInput> {
  const certificateFile: string = resolve(directory, 'fullchain.pem');
  const privateKeyFile: string = resolve(directory, 'privkey.pem');
  await writeFile(certificateFile, 'certificate-bytes');
  await writeFile(privateKeyFile, 'private-key-bytes');
  return {
    certificateFile,
    chartPath: resolve(directory, 'chart'),
    namespace: 'compartment',
    privateKeyFile,
    releaseName: 'compartment',
    valuesPath: resolve(directory, 'values.yaml'),
  };
}

function requireHelmValues(value: KubernetesDomainHelmValues | null): KubernetesDomainHelmValues {
  if (value === null) {
    throw new Error('Expected rendered Helm values.');
  }
  return value;
}

async function createReleaseTarget(directory: string): Promise<KubernetesOperatorTarget> {
  const valuesPath: string = resolve(directory, 'values.yaml');
  await writeFile(valuesPath, '{}');
  return {
    chartPath: resolve(directory, 'chart'),
    namespace: 'compartment',
    releaseName: 'compartment',
    valuesPath,
  };
}

async function readHelmValues(command: readonly string[]): Promise<KubernetesDomainHelmValues> {
  const valuesFlags: number[] = command.flatMap((value: string, index: number): number[] =>
    value === '--values' ? [index] : [],
  );
  const lastValuesFlag: number | undefined = valuesFlags.at(-1);
  const domainValuesPath: string | undefined = lastValuesFlag === undefined ? undefined : command[lastValuesFlag + 1];
  if (domainValuesPath === undefined) {
    throw new Error('Expected Helm domain values.');
  }
  return JSON.parse(await readFile(domainValuesPath, 'utf8')) as KubernetesDomainHelmValues;
}

function successfulCommand(): CommandResult {
  return { exitCode: 0, stderr: '', stdout: '' };
}
