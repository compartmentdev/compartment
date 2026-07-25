import {
  resolveAppRouteAccessMode,
  resolveCompartmentServiceBuildConfig,
  resolveCompartmentServiceKind,
  resolveCompartmentServiceReleaseConfig,
  resolveCompartmentServiceRunConfig,
  resolveServiceReadinessConfig,
} from '@compartment/contracts';
import { describe, expect, it } from 'vitest';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import { assertDeployReleaseResourcesReady } from '../src/services/deployment-resource-preflight.service';
import type { ResolvedDescriptorService } from '../src/services/deployments.service.types';

describe('deployment resource preflight service', (): void => {
  it('allows a connected service without release before its resource is bootstrapped', (): void => {
    expect((): void =>
      assertDeployReleaseResourcesReady([createService(false)], [createResource({ expectedClaimsJson: '[]' })]),
    ).not.toThrow();
  });

  it('rejects a release connected to an unbootstrapped resource', (): void => {
    expect((): void =>
      assertDeployReleaseResourcesReady([createService(true)], [createResource({ expectedClaimsJson: '[]' })]),
    ).toThrow(
      'Resource "postgres" is not bootstrapped. Run `compartment resource bootstrap --resource postgres` first, then redeploy.',
    );
  });

  it('rejects a release connected to a stopped bootstrapped resource', (): void => {
    expect((): void =>
      assertDeployReleaseResourcesReady(
        [createService(true)],
        [createResource({ expectedClaimsJson: expectedClaimsJson(), status: 'stopped' })],
      ),
    ).toThrow(
      'Resource "postgres" is not running. Start it with `compartment resource start --resource postgres` before deploying, then redeploy.',
    );
  });

  it('allows a release connected to a running bootstrapped resource', (): void => {
    expect((): void =>
      assertDeployReleaseResourcesReady(
        [createService(true)],
        [createResource({ expectedClaimsJson: expectedClaimsJson(), status: 'running' })],
      ),
    ).not.toThrow();
  });

  it('allows a release without resource connections', (): void => {
    expect((): void =>
      assertDeployReleaseResourcesReady([{ ...createService(true), connections: {} }], []),
    ).not.toThrow();
  });
});

function createService(hasRelease: boolean): ResolvedDescriptorService {
  return {
    accessMode: resolveAppRouteAccessMode(undefined),
    build: resolveCompartmentServiceBuildConfig(undefined),
    connections: {
      postgres: {
        env: {
          DATABASE_URL: 'connection-url',
        },
      },
    },
    kind: resolveCompartmentServiceKind(undefined),
    name: 'api',
    path: './services/api',
    ports: [3000],
    readiness: resolveServiceReadinessConfig(undefined),
    release: resolveCompartmentServiceReleaseConfig(hasRelease ? { command: 'pnpm db:migrate' } : undefined),
    run: resolveCompartmentServiceRunConfig(undefined),
  };
}

function createResource(overrides: Partial<ProjectResourceRow>): ProjectResourceRow {
  return {
    commandJson: '[]',
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
    deleteDataRequested: false,
    environmentId: 'env_production',
    envJson: '{}',
    expectedClaimsJson: expectedClaimsJson(),
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'operation-hash',
    operationsJson: '{}',
    outputsJson: '{}',
    portsJson: '[]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'runtime-hash',
    status: 'running',
    updatedAt: new Date('2026-07-25T00:00:00.000Z'),
    volumesJson: '[]',
    ...overrides,
  };
}

function expectedClaimsJson(): string {
  return JSON.stringify([{ claimName: 'data', uid: 'pvc-data' }]);
}
