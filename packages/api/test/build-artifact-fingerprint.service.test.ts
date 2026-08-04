import { resolveCompartmentServiceBuildConfig } from '@compartment/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import { encryptTenantVariableValueForStorage, type EncryptedVariableValue } from '../src/lib/variables-crypto';
import type { getApiConfig } from '../src/runtime/runtime-access';
import { buildArtifactFingerprint } from '../src/services/build-artifact-fingerprint.service';
import type { BuildArtifactFingerprintInput } from '../src/services/build-artifact-fingerprint.service.types';

type GetApiConfig = typeof getApiConfig;
const tenantSecretsKek: Buffer = Buffer.from('11'.repeat(32), 'hex');
const variablesMasterKey: Buffer = Buffer.from('22'.repeat(32), 'hex');
const builderProfileDigest: string = `sha256:${'c'.repeat(64)}`;
const getApiConfigMock: Mock<GetApiConfig> = vi.hoisted((): Mock<GetApiConfig> => vi.fn<GetApiConfig>());

vi.mock('../src/runtime/runtime-access', (): { getApiConfig: Mock<GetApiConfig> } => ({
  getApiConfig: getApiConfigMock,
}));

beforeEach((): void => {
  getApiConfigMock.mockReturnValue({ builderProfileDigest, tenantSecretsKek, variablesMasterKey } as ApiConfig);
});

describe('build artifact fingerprint', (): void => {
  it('is deterministic and scopes identical logical sources to the owning service', (): void => {
    const input: BuildArtifactFingerprintInput = {
      build: resolveCompartmentServiceBuildConfig(undefined),
      buildEnvSnapshot: {},
      organizationId: 'org_1',
      projectId: 'prj_1',
      projectServiceId: 'svc_1',
      sourceDigest: `v1:sha256:${'a'.repeat(64)}`,
    };

    expect(buildArtifactFingerprint(input)).toBe(buildArtifactFingerprint({ ...input }));
    expect(buildArtifactFingerprint(input)).not.toBe(buildArtifactFingerprint({ ...input, projectServiceId: 'svc_2' }));
  });

  it('changes when canonical resolved build input changes', (): void => {
    const input: BuildArtifactFingerprintInput = {
      build: resolveCompartmentServiceBuildConfig(undefined),
      buildEnvSnapshot: {},
      organizationId: 'org_1',
      projectId: 'prj_1',
      projectServiceId: 'svc_1',
      sourceDigest: `v1:sha256:${'a'.repeat(64)}`,
    };

    expect(buildArtifactFingerprint(input)).not.toBe(
      buildArtifactFingerprint({
        ...input,
        build: resolveCompartmentServiceBuildConfig({ command: 'pnpm build', strategy: 'railpack' }),
      }),
    );
  });

  it('changes when the resolved builder profile changes', (): void => {
    const input: BuildArtifactFingerprintInput = {
      build: resolveCompartmentServiceBuildConfig(undefined),
      buildEnvSnapshot: {},
      organizationId: 'org_1',
      projectId: 'prj_1',
      projectServiceId: 'svc_1',
      sourceDigest: `v1:sha256:${'a'.repeat(64)}`,
    };
    const initial: string = buildArtifactFingerprint(input);
    getApiConfigMock.mockReturnValue({
      builderProfileDigest: `sha256:${'d'.repeat(64)}`,
      tenantSecretsKek,
      variablesMasterKey,
    } as ApiConfig);

    expect(buildArtifactFingerprint(input)).not.toBe(initial);
  });

  it('keys build values by plaintext while ignoring ordering and ciphertext rotation', (): void => {
    const config: ApiConfig = { builderProfileDigest, tenantSecretsKek, variablesMasterKey } as ApiConfig;
    getApiConfigMock.mockImplementation((): ApiConfig => config);
    const encryptedBefore: EncryptedVariableValue = encryptTenantVariableValueForStorage(
      'before',
      tenantSecretsKek,
      variablesMasterKey,
    );
    const rotatedBefore: EncryptedVariableValue = encryptTenantVariableValueForStorage(
      'before',
      tenantSecretsKek,
      variablesMasterKey,
    );
    const encryptedAfter: EncryptedVariableValue = encryptTenantVariableValueForStorage(
      'after',
      tenantSecretsKek,
      variablesMasterKey,
    );
    const base: BuildArtifactFingerprintInput = {
      build: resolveCompartmentServiceBuildConfig(undefined),
      buildEnvSnapshot: {
        FIRST: encryptedBefore,
        SECOND: encryptTenantVariableValueForStorage('same', tenantSecretsKek, variablesMasterKey),
      },
      organizationId: 'org_1',
      projectId: 'prj_1',
      projectServiceId: 'svc_1',
      sourceDigest: `v1:sha256:${'a'.repeat(64)}`,
    };

    const initial: string = buildArtifactFingerprint(base);
    expect(initial).toBe(
      buildArtifactFingerprint({
        ...base,
        buildEnvSnapshot: { SECOND: base.buildEnvSnapshot.SECOND!, FIRST: rotatedBefore },
      }),
    );
    expect(initial).not.toBe(
      buildArtifactFingerprint({
        ...base,
        buildEnvSnapshot: { ...base.buildEnvSnapshot, FIRST: encryptedAfter },
      }),
    );
  });
});
