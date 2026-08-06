import { describe, expect, it } from 'vitest';
import { readWorkerBuildConfig, readWorkerConfig, type WorkerBuildConfig, type WorkerConfig } from '../src/config';

describe('readWorkerConfig', (): void => {
  it('reads the private node-pull and internal registry endpoints', (): void => {
    const config: WorkerConfig = readWorkerConfig(validEnvironment());

    expect(config.apiUrl).toBe('http://127.0.0.1:9443');
    expect(config.artifactRegistry).toEqual({
      address: 'registry.apps.example.com:443',
      credentialSigningKey: 'registry-signing-key-with-at-least-32-characters',
      internalAddress: 'registry.apps.example.com:443',
      internalUrl: 'https://registry.apps.example.com',
    });
    expect(config.buildSandbox).toEqual({
      buildKitResources: { limits: { cpu: '2' } },
      gcKeepStorageMb: 2000,
      namespace: 'compartment-build',
      runnerImage: 'compartment-worker@sha256:runner',
      runnerResources: { limits: { cpu: '1' } },
      scheduling: {
        nodeSelector: { 'compartment.dev/node-pool': 'build' },
        runtimeClassName: 'gvisor',
        tolerations: [],
      },
      timeoutMs: 900000,
    });
    expect(config.customDomains).toEqual({
      caddyServiceName: 'compartment-caddy',
      ingressClassName: 'traefik',
      issuerRef: { kind: 'Issuer', name: 'compartment-platform' },
      namespace: 'compartment',
    });
    expect(config.deploymentInfrastructureTimeoutMs).toBe(600_000);
    expect(config.pollIntervalMs).toBe(1000);
    expect(config.runtimeControlToken).toBe('runtime-control-token');
    expect(config.tenantSecretsKek).toEqual({ current: Buffer.from('11'.repeat(32), 'hex') });
    expect(config.usageMeteringIntervalMs).toBe(60_000);
    expect(config).not.toHaveProperty('tenantScheduling');
  });

  it('requires a canonical tenant secrets KEK', (): void => {
    expect(
      (): WorkerConfig => readWorkerConfig({ ...validEnvironment(), COMPARTMENT_TENANT_SECRETS_KEK: undefined }),
    ).toThrow();
    expect(
      (): WorkerConfig => readWorkerConfig({ ...validEnvironment(), COMPARTMENT_TENANT_SECRETS_KEK: 'not-hex' }),
    ).toThrow();
  });

  it('parses optional tenant scheduling and rejects malformed configuration', (): void => {
    const config: WorkerConfig = readWorkerConfig({
      ...validEnvironment(),
      COMPARTMENT_KUBE_TENANT_SCHEDULING: tenantSchedulingJson,
    });

    expect(config.tenantScheduling).toEqual({
      nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
      runtimeClassName: 'gvisor',
      tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Equal', value: 'tenant' }],
    });
    expect(
      (): WorkerConfig =>
        readWorkerConfig({
          ...validEnvironment(),
          COMPARTMENT_KUBE_TENANT_SCHEDULING: '{"nodeSelector":',
        }),
    ).toThrow();
  });

  it('fails closed when build scheduling omits the sandbox RuntimeClass', (): void => {
    expect(
      (): WorkerBuildConfig =>
        readWorkerBuildConfig({
          ...validEnvironment(),
          COMPARTMENT_KUBE_BUILD_SCHEDULING: '{"nodeSelector":{"compartment.dev/node-pool":"build"},"tolerations":[]}',
        }),
    ).toThrow('Build scheduling must configure a gVisor RuntimeClass.');
  });

  it('rejects unsafe worker trusted outbound host entries', (): void => {
    expect((): WorkerConfig => {
      return readWorkerConfig({
        ...validEnvironment(),
        COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: 'https://github.enterprise.example',
      });
    }).toThrow('COMPARTMENT_TRUSTED_OUTBOUND_HOSTS must be empty or a comma-separated list');
  });

  it('rejects missing registry signing material instead of restoring global credentials', (): void => {
    const environment: NodeJS.ProcessEnv = validEnvironment();
    delete environment.COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY;
    expect((): WorkerConfig => readWorkerConfig(environment)).toThrow();
  });

  it('requires custom-domain configuration for the worker controller', (): void => {
    const environment: NodeJS.ProcessEnv = validEnvironment();
    delete environment.COMPARTMENT_CADDY_SERVICE_NAME;
    expect((): WorkerConfig => readWorkerConfig(environment)).toThrow();
  });

  it('requires a positive integer service Deployment infrastructure timeout', (): void => {
    expect(
      readWorkerConfig({
        ...validEnvironment(),
        COMPARTMENT_DEPLOYMENT_INFRASTRUCTURE_TIMEOUT_MS: '120000',
      }).deploymentInfrastructureTimeoutMs,
    ).toBe(120_000);
    for (const value of [undefined, '0', '1.5']) {
      expect(
        (): WorkerConfig =>
          readWorkerConfig({
            ...validEnvironment(),
            COMPARTMENT_DEPLOYMENT_INFRASTRUCTURE_TIMEOUT_MS: value,
          }),
      ).toThrow();
    }
  });

  it('does not require custom-domain configuration for build-only processes', (): void => {
    const environment: NodeJS.ProcessEnv = validEnvironment();
    delete environment.COMPARTMENT_CADDY_SERVICE_NAME;
    delete environment.COMPARTMENT_INGRESS_CLASS_NAME;
    delete environment.COMPARTMENT_TLS_ISSUER_KIND;
    delete environment.COMPARTMENT_TLS_ISSUER_NAME;
    delete environment.COMPARTMENT_PLATFORM_NAMESPACE;

    const config: WorkerBuildConfig = readWorkerBuildConfig(environment);
    expect(config.buildSandbox.namespace).toBe('compartment-build');
  });

  it('rejects missing required runtime env values instead of silently falling back', (): void => {
    expect((): WorkerConfig => {
      return readWorkerConfig({
        COMPARTMENT_API_PORT: '9443',
        COMPARTMENT_LOG_LEVEL: 'info',
        COMPARTMENT_WORKER_POLL_INTERVAL_MS: '1000',
        COMPARTMENT_USAGE_METERING_INTERVAL_MS: '60000',
        COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
      });
    }).toThrow();
  });
});

const tenantSchedulingJson: string = JSON.stringify({
  nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
  runtimeClassName: 'gvisor',
  tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Equal', value: 'tenant' }],
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    COMPARTMENT_BUILDKIT_GC_KEEP_STORAGE_MB: '2000',
    COMPARTMENT_BUILDKIT_RESOURCES: '{"limits":{"cpu":"2"}}',
    COMPARTMENT_BUILD_NAMESPACE: 'compartment-build',
    COMPARTMENT_BUILD_RUNNER_IMAGE: 'compartment-worker@sha256:runner',
    COMPARTMENT_BUILD_RUNNER_RESOURCES: '{"limits":{"cpu":"1"}}',
    COMPARTMENT_BUILD_TIMEOUT_MS: '900000',
    COMPARTMENT_KUBE_BUILD_SCHEDULING:
      '{"nodeSelector":{"compartment.dev/node-pool":"build"},"runtimeClassName":"gvisor","tolerations":[]}',
    COMPARTMENT_MAX_CONCURRENT_BUILDS: '2',
    COMPARTMENT_MAX_CONCURRENT_BUILDS_PER_PROJECT: '1',
    COMPARTMENT_API_INTERNAL_HOST: '127.0.0.1',
    COMPARTMENT_API_PORT: '9443',
    COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: 'registry-signing-key-with-at-least-32-characters',
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: 'registry.apps.example.com',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: 'registry.apps.example.com:443',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: 'https://registry.apps.example.com',
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: '443',
    COMPARTMENT_LOG_LEVEL: 'info',
    COMPARTMENT_LEADER_ELECTION_IDENTITY: 'worker-1',
    COMPARTMENT_LEADER_ELECTION_LEASE_DURATION_MS: '15000',
    COMPARTMENT_LEADER_ELECTION_RENEW_DEADLINE_MS: '10000',
    COMPARTMENT_LEADER_ELECTION_RETRY_PERIOD_MS: '2000',
    COMPARTMENT_CADDY_SERVICE_NAME: 'compartment-caddy',
    COMPARTMENT_DEPLOYMENT_INFRASTRUCTURE_TIMEOUT_MS: '600000',
    COMPARTMENT_INGRESS_CLASS_NAME: 'traefik',
    COMPARTMENT_TLS_ISSUER_KIND: 'Issuer',
    COMPARTMENT_TLS_ISSUER_NAME: 'compartment-platform',
    COMPARTMENT_PLATFORM_NAMESPACE: 'compartment',
    COMPARTMENT_TENANT_SECRETS_KEK: '11'.repeat(32),
    COMPARTMENT_WORKER_POLL_INTERVAL_MS: '1000',
    COMPARTMENT_USAGE_METERING_INTERVAL_MS: '60000',
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
    COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: 'github.enterprise.example, idp.example.com:8443, idp.example.com:443',
  };
}
