import { describe, expect, it } from 'vitest';
import { assertSelfHostedGeneratedSecretEnvironment } from '../src/self-hosted-generated-secret-environment';

interface SelfHostedGeneratedSecretEnvironmentFixture {
  readonly COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY?: string | undefined;
  readonly COMPARTMENT_DATABASE_URL?: string | undefined;
  readonly COMPARTMENT_EDGE_TOKEN?: string | undefined;
  readonly COMPARTMENT_ENV?: string | undefined;
  readonly COMPARTMENT_INSTALL_TOKEN?: string | undefined;
  readonly COMPARTMENT_POSTGRES_PASSWORD?: string | undefined;
  readonly COMPARTMENT_RUNTIME_CONTROL_TOKEN?: string | undefined;
  readonly COMPARTMENT_SESSION_SECRET?: string | undefined;
  readonly COMPARTMENT_SYSTEM_TOKEN?: string | undefined;
  readonly COMPARTMENT_TENANT_SECRETS_KEK?: string | undefined;
  readonly COMPARTMENT_VARIABLES_MASTER_KEY?: string | undefined;
}

type SelfHostedGeneratedSecretEnvironmentOverrides = Partial<SelfHostedGeneratedSecretEnvironmentFixture>;

const generated24ByteSecret: string = '0123456789abcdef0123456789abcdef0123456789abcdef';
const generated32ByteSecret: string = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('assertSelfHostedGeneratedSecretEnvironment', (): void => {
  it('accepts generated self-hosted secrets', (): void => {
    expect((): void => assertSelfHostedGeneratedSecretEnvironment(createSelfHostedEnvironment())).not.toThrow();
  });

  it('rejects self-hosted example-style placeholder values by shape', (): void => {
    expect((): void =>
      assertSelfHostedGeneratedSecretEnvironment(
        createSelfHostedEnvironment({
          COMPARTMENT_EDGE_TOKEN: 'change-me-edge-token',
        }),
      ),
    ).toThrow('COMPARTMENT_EDGE_TOKEN must be at least 48 hex characters for self-hosted environments.');
  });

  it('requires registry credentials in complete self-hosted environments', (): void => {
    expect((): void =>
      assertSelfHostedGeneratedSecretEnvironment(
        createSelfHostedEnvironment({
          COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: undefined,
        }),
      ),
    ).toThrow('The self-hosted environment is missing COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY.');
  });

  it('allows service-scoped self-hosted API environments without registry credentials', (): void => {
    expect((): void =>
      assertSelfHostedGeneratedSecretEnvironment(
        createSelfHostedEnvironment({
          COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: undefined,
        }),
        { requireArtifactRegistrySecrets: false },
      ),
    ).not.toThrow();
  });

  it('rejects self-hosted database URLs with mismatched passwords', (): void => {
    expect((): void =>
      assertSelfHostedGeneratedSecretEnvironment(
        createSelfHostedEnvironment({
          COMPARTMENT_DATABASE_URL: `postgresql://postgres:${generated32ByteSecret}@postgres:5432/compartment`,
        }),
      ),
    ).toThrow(
      'COMPARTMENT_DATABASE_URL must include the same password as COMPARTMENT_POSTGRES_PASSWORD for self-hosted environments.',
    );
  });

  it('rejects low-entropy variables master keys in self-hosted envs', (): void => {
    expect((): void =>
      assertSelfHostedGeneratedSecretEnvironment(
        createSelfHostedEnvironment({
          COMPARTMENT_VARIABLES_MASTER_KEY: '1'.repeat(64),
        }),
      ),
    ).toThrow('COMPARTMENT_VARIABLES_MASTER_KEY must not use one repeated hex character for self-hosted environments.');
  });

  it('rejects low-entropy tenant KEKs in self-hosted envs', (): void => {
    expect((): void =>
      assertSelfHostedGeneratedSecretEnvironment(
        createSelfHostedEnvironment({
          COMPARTMENT_TENANT_SECRETS_KEK: '1'.repeat(64),
        }),
      ),
    ).toThrow('COMPARTMENT_TENANT_SECRETS_KEK must not use one repeated hex character for self-hosted environments.');
  });

  it('allows local dev placeholder database credentials', (): void => {
    expect((): void =>
      assertSelfHostedGeneratedSecretEnvironment({
        COMPARTMENT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_dev',
        COMPARTMENT_ENV: 'dev',
        COMPARTMENT_POSTGRES_PASSWORD: 'postgres',
        COMPARTMENT_VARIABLES_MASTER_KEY: '1'.repeat(64),
      }),
    ).not.toThrow();
  });

  it('allows placeholder database credentials when the runtime env is unset', (): void => {
    expect((): void =>
      assertSelfHostedGeneratedSecretEnvironment({
        COMPARTMENT_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/compartment_test',
        COMPARTMENT_POSTGRES_PASSWORD: 'postgres',
      }),
    ).not.toThrow();
  });
});

function createSelfHostedEnvironment(
  overrides: SelfHostedGeneratedSecretEnvironmentOverrides = {},
): SelfHostedGeneratedSecretEnvironmentFixture {
  return {
    COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: generated24ByteSecret,
    COMPARTMENT_DATABASE_URL: `postgresql://postgres:${generated24ByteSecret}@postgres:5432/compartment`,
    COMPARTMENT_EDGE_TOKEN: generated24ByteSecret,
    COMPARTMENT_ENV: 'self-hosted',
    COMPARTMENT_INSTALL_TOKEN: generated32ByteSecret,
    COMPARTMENT_POSTGRES_PASSWORD: generated24ByteSecret,
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: generated24ByteSecret,
    COMPARTMENT_SESSION_SECRET: generated32ByteSecret,
    COMPARTMENT_SYSTEM_TOKEN: generated24ByteSecret,
    COMPARTMENT_TENANT_SECRETS_KEK: generated32ByteSecret,
    COMPARTMENT_VARIABLES_MASTER_KEY: generated32ByteSecret,
    ...overrides,
  };
}
