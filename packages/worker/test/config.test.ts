import { describe, expect, it } from 'vitest';
import { readWorkerBuildConfig, readWorkerConfig, type WorkerBuildConfig, type WorkerConfig } from '../src/config';

describe('readWorkerConfig', (): void => {
  it('rejects a metrics port outside the TCP port range', (): void => {
    expect(
      (): WorkerConfig => readWorkerConfig({ ...validEnvironment(), COMPARTMENT_WORKER_METRICS_PORT: '65536' }),
    ).toThrow();
  });

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
      buildKitConfigMapName: 'compartment-buildkit',
      dataSizeLimit: '2Gi',
      buildKitResources: { limits: { cpu: '2', memory: '3Gi' }, requests: { cpu: '250m', memory: '3Gi' } },
      gcKeepStorageMb: 1024,
      seed: {
        image: `compartment-buildkit-seed@sha256:${'c'.repeat(64)}`,
        railpackBuilderImage: `ghcr.io/railwayapp/railpack-builder:mise-test@sha256:${'a'.repeat(64)}`,
        railpackRuntimeImage: `ghcr.io/railwayapp/railpack-runtime:mise-test@sha256:${'b'.repeat(64)}`,
      },
      namespace: 'compartment-build',
      runnerResources: { limits: { cpu: '1', memory: '1Gi' }, requests: { cpu: '100m', memory: '1Gi' } },
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
    expect(config.dataScheduling).toEqual({
      nodeSelector: { 'compartment.dev/node-pool': 'data' },
      runtimeClassName: 'gvisor',
      tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Equal', value: 'data' }],
    });
    expect(config.deploymentInfrastructureTimeoutMs).toBe(600_000);
    expect(config.organizationQuota).toEqual({
      limitsCpu: '8',
      limitsMemory: '8Gi',
      requestsCpu: '2',
      requestsMemory: '2Gi',
      requestsStorage: '20Gi',
    });
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

  it('requires valid data scheduling with the sandbox RuntimeClass', (): void => {
    const missingEnvironment: NodeJS.ProcessEnv = validEnvironment();
    delete missingEnvironment.COMPARTMENT_KUBE_DATA_SCHEDULING;
    expect((): WorkerConfig => readWorkerConfig(missingEnvironment)).toThrow();
    expect(
      (): WorkerConfig =>
        readWorkerConfig({ ...validEnvironment(), COMPARTMENT_KUBE_DATA_SCHEDULING: '{"nodeSelector":' }),
    ).toThrow();
    expect(
      (): WorkerConfig =>
        readWorkerConfig({
          ...validEnvironment(),
          COMPARTMENT_KUBE_DATA_SCHEDULING: '{"nodeSelector":{},"runtimeClassName":"gvisor","tolerations":[]}',
        }),
    ).toThrow('Data scheduling must select dedicated data workers.');
    expect(
      (): WorkerConfig =>
        readWorkerConfig({
          ...validEnvironment(),
          COMPARTMENT_KUBE_DATA_SCHEDULING: '{"nodeSelector":{"compartment.dev/node-pool":"data"},"tolerations":[]}',
        }),
    ).toThrow('Data scheduling must configure a gVisor RuntimeClass.');
  });

  it('fails closed when build resources omit the memory limit that funds the sandbox workspace', (): void => {
    expect(
      (): WorkerBuildConfig =>
        readWorkerBuildConfig({
          ...validEnvironment(),
          COMPARTMENT_BUILDKIT_RESOURCES: '{"limits":{"cpu":"2"}}',
        }),
    ).toThrow('COMPARTMENT_BUILDKIT_RESOURCES must be a JSON object declaring limits.memory.');
  });

  it.each(['two gigabytes', '0Gi', '+2Gi', '2G', '1Ki', '1.5Gi', '8192Ti', '2147483648000000u'])(
    'rejects the unsupported BuildKit data size limit %s',
    (dataSizeLimit: string): void => {
      expect(
        (): WorkerBuildConfig =>
          readWorkerBuildConfig({
            ...validEnvironment(),
            COMPARTMENT_BUILDKIT_DATA_SIZE_LIMIT: dataSizeLimit,
          }),
      ).toThrow('must be 1-8191 whole Mi, Gi, or Ti');
    },
  );

  it.each(['2048Mi', '8Gi'])('accepts the bounded BuildKit data size limit %s', (dataSizeLimit: string): void => {
    const config: WorkerBuildConfig = readWorkerBuildConfig({
      ...validEnvironment(),
      COMPARTMENT_BUILDKIT_DATA_SIZE_LIMIT: dataSizeLimit,
    });

    expect(config.buildSandbox.dataSizeLimit).toBe(dataSizeLimit);
  });

  it('requires the BuildKit seed image to be digest pinned', (): void => {
    expect(
      (): WorkerBuildConfig =>
        readWorkerBuildConfig({
          ...validEnvironment(),
          COMPARTMENT_BUILDKIT_SEED_IMAGE: 'ghcr.io/compartmentdev/compartment-buildkit-seed:latest',
        }),
    ).toThrow();
  });

  it.each([
    `ghcr.io/compartmentdev/compartment buildkit-seed@sha256:${'c'.repeat(64)}`,
    `GHCR.IO/compartmentdev/compartment-buildkit-seed@sha256:${'c'.repeat(64)}`,
    `ghcr.io//compartment-buildkit-seed@sha256:${'c'.repeat(64)}`,
  ])('rejects malformed BuildKit seed image reference %s', (image: string): void => {
    expect((): WorkerBuildConfig => {
      return readWorkerBuildConfig({ ...validEnvironment(), COMPARTMENT_BUILDKIT_SEED_IMAGE: image });
    }).toThrow();
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

  it('requires the organization-scoped build limit env', (): void => {
    const environment: NodeJS.ProcessEnv = validEnvironment();
    delete environment.COMPARTMENT_MAX_CONCURRENT_BUILDS_PER_ORGANIZATION;
    environment.COMPARTMENT_MAX_CONCURRENT_BUILDS_PER_PROJECT = '1';

    expect((): WorkerConfig => readWorkerConfig(environment)).toThrow();
  });

  it('rejects invalid organization quota quantities at startup', (): void => {
    expect(
      (): WorkerConfig =>
        readWorkerConfig({
          ...validEnvironment(),
          COMPARTMENT_ORGANIZATION_QUOTA:
            '{"requestsCpu":"-1","requestsMemory":"2Gi","limitsCpu":"8","limitsMemory":"8Gi","requestsStorage":"20Gi"}',
        }),
    ).toThrow('COMPARTMENT_ORGANIZATION_QUOTA requestsCpu must be a valid non-negative Kubernetes quantity.');
  });

  it('rejects organization requests that exceed their quota limits at startup', (): void => {
    expect(
      (): WorkerConfig =>
        readWorkerConfig({
          ...validEnvironment(),
          COMPARTMENT_ORGANIZATION_QUOTA:
            '{"requestsCpu":"2","requestsMemory":"2Gi","limitsCpu":"1500m","limitsMemory":"8Gi","requestsStorage":"20Gi"}',
        }),
    ).toThrow('COMPARTMENT_ORGANIZATION_QUOTA requestsCpu must not exceed limitsCpu.');
    expect(
      (): WorkerConfig =>
        readWorkerConfig({
          ...validEnvironment(),
          COMPARTMENT_ORGANIZATION_QUOTA:
            '{"requestsCpu":"2","requestsMemory":"2Gi","limitsCpu":"8","limitsMemory":"1536Mi","requestsStorage":"20Gi"}',
        }),
    ).toThrow('COMPARTMENT_ORGANIZATION_QUOTA requestsMemory must not exceed limitsMemory.');
  });
});

const tenantSchedulingJson: string = JSON.stringify({
  nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
  runtimeClassName: 'gvisor',
  tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Equal', value: 'tenant' }],
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    COMPARTMENT_BUILDKIT_CONFIG_MAP_NAME: 'compartment-buildkit',
    COMPARTMENT_BUILDKIT_DATA_SIZE_LIMIT: '2Gi',
    COMPARTMENT_BUILDKIT_GC_KEEP_STORAGE_MB: '1024',
    COMPARTMENT_BUILDKIT_SEED_IMAGE: `compartment-buildkit-seed@sha256:${'c'.repeat(64)}`,
    COMPARTMENT_BUILDKIT_RESOURCES: '{"limits":{"cpu":"2","memory":"3Gi"},"requests":{"cpu":"250m","memory":"3Gi"}}',
    COMPARTMENT_BUILD_NAMESPACE: 'compartment-build',
    COMPARTMENT_WORKER_IMAGE: 'compartment-worker@sha256:runner',
    COMPARTMENT_BUILD_RUNNER_RESOURCES:
      '{"limits":{"cpu":"1","memory":"1Gi"},"requests":{"cpu":"100m","memory":"1Gi"}}',
    COMPARTMENT_BUILD_TIMEOUT_MS: '900000',
    COMPARTMENT_KUBE_BUILD_SCHEDULING:
      '{"nodeSelector":{"compartment.dev/node-pool":"build"},"runtimeClassName":"gvisor","tolerations":[]}',
    COMPARTMENT_RAILPACK_BUILDER_IMAGE: `ghcr.io/railwayapp/railpack-builder:mise-test@sha256:${'a'.repeat(64)}`,
    COMPARTMENT_RAILPACK_RUNTIME_IMAGE: `ghcr.io/railwayapp/railpack-runtime:mise-test@sha256:${'b'.repeat(64)}`,
    COMPARTMENT_KUBE_DATA_SCHEDULING:
      '{"nodeSelector":{"compartment.dev/node-pool":"data"},"runtimeClassName":"gvisor","tolerations":[{"effect":"NoSchedule","key":"compartment.dev/node-pool","operator":"Equal","value":"data"}]}',
    COMPARTMENT_MAX_CONCURRENT_BUILDS: '2',
    COMPARTMENT_MAX_CONCURRENT_BUILDS_PER_ORGANIZATION: '1',
    COMPARTMENT_ORGANIZATION_QUOTA:
      '{"requestsCpu":"2","requestsMemory":"2Gi","limitsCpu":"8","limitsMemory":"8Gi","requestsStorage":"20Gi"}',
    COMPARTMENT_API_INTERNAL_HOST: '127.0.0.1',
    COMPARTMENT_API_PORT: '9443',
    COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: 'registry-signing-key-with-at-least-32-characters',
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: 'registry.apps.example.com',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: 'registry.apps.example.com:443',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: 'https://registry.apps.example.com',
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: '443',
    COMPARTMENT_LOG_LEVEL: 'info',
    COMPARTMENT_WORKER_METRICS_PORT: '9465',
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
