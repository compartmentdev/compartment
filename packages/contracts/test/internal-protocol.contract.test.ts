import { describe, expect, it } from 'vitest';
import {
  compartmentInternalAppAccessExchangePathname,
  compartmentInternalAppAccessLogoutPathname,
  compartmentInternalAppAccessSessionsRevokePathname,
  compartmentInternalAppAccessStatePathname,
  compartmentInternalNodeRegistrationPathname,
  nodeDeployRequestSchema,
  nodeDeployPathname,
  nodeDrainDeploymentPathname,
  nodeInspectDeploymentPathname,
  nodeReleasePathname,
  nodeRuntimeNetworkReconcilePathname,
  nodeRuntimeNetworkReservationCleanupPathname,
  nodeRuntimeNetworkReservationCleanupRequestSchema,
  nodeRuntimeNetworkReservationCleanupResponseSchema,
  nodeRuntimeNetworkReservationPathname,
  nodeRuntimeNetworkReservationRequestSchema,
  nodeRuntimeNetworkReservationResponseSchema,
  nodeRuntimeServiceReadinessFailedErrorCode,
  nodeRuntimeServiceStartupFailedErrorCode,
  nodeResourceOperationRequestSchema,
  nodeStopDeploymentPathname,
  nodeTailLogsPathname,
  workerAppendDeploymentEventPathname,
  workerClaimNextDeploymentPathname,
  workerCompleteDeploymentPathname,
  workerFailDeploymentPathname,
  workerRecoverDeploymentsPathname,
  workerRunNextScheduledResourceOperationPathname,
  workerUpdateDeploymentRuntimePathname,
  type NodeDeployRequest,
  type NodeRuntimeNetworkReservationCleanupRequest,
  type NodeRuntimeNetworkReservationRequest,
  type NodeResourceOperationRequest,
} from '../src';

interface InvalidNodePreviousDeployment {
  nodeSocketPath: string;
  upstreamPort: number;
}

interface InvalidNodeDeployRequest extends Omit<NodeDeployRequest, 'previousDeployment'> {
  previousDeployment: InvalidNodePreviousDeployment;
}

interface InvalidNodeResourceOperationRawPathRequest extends Omit<NodeResourceOperationRequest, 'backupId'> {
  artifactHostPath: string;
}

describe('internal protocol path constants', (): void => {
  it('keeps app-access internal paths stable', (): void => {
    expect(compartmentInternalAppAccessExchangePathname).toBe('/internal/app-access/exchange');
    expect(compartmentInternalAppAccessLogoutPathname).toBe('/internal/app-access/logout');
    expect(compartmentInternalAppAccessSessionsRevokePathname).toBe('/internal/app-access/sessions/revoke');
    expect(compartmentInternalAppAccessStatePathname).toBe('/internal/app-access/state');
  });

  it('keeps node internal paths stable', (): void => {
    expect(compartmentInternalNodeRegistrationPathname).toBe('/internal/nodes/register');
    expect(nodeDeployPathname).toBe('/internal/deployments/deploy');
    expect(nodeDrainDeploymentPathname).toBe('/internal/deployments/drain');
    expect(nodeInspectDeploymentPathname).toBe('/internal/deployments/inspect');
    expect(nodeReleasePathname).toBe('/internal/deployments/release');
    expect(nodeRuntimeNetworkReconcilePathname).toBe('/internal/runtime-networks/reconcile');
    expect(nodeRuntimeNetworkReservationPathname).toBe('/internal/runtime-networks/reserve');
    expect(nodeRuntimeNetworkReservationCleanupPathname).toBe('/internal/runtime-networks/reservations/cleanup');
    expect(nodeStopDeploymentPathname).toBe('/internal/deployments/stop');
    expect(nodeTailLogsPathname).toBe('/internal/deployments/logs');
  });

  it('keeps worker internal paths stable', (): void => {
    expect(workerAppendDeploymentEventPathname).toBe('/internal/deployments/runtime-events');
    expect(workerClaimNextDeploymentPathname).toBe('/internal/deployments/claim-next');
    expect(workerCompleteDeploymentPathname).toBe('/internal/deployments/complete');
    expect(workerFailDeploymentPathname).toBe('/internal/deployments/fail');
    expect(workerRecoverDeploymentsPathname).toBe('/internal/deployments/recover-running');
    expect(workerRunNextScheduledResourceOperationPathname).toBe('/internal/resource-operations/run-next-scheduled');
    expect(workerUpdateDeploymentRuntimePathname).toBe('/internal/deployments/runtime-state');
  });
});

describe('node deploy contract', (): void => {
  it('keeps service runtime error codes stable', (): void => {
    expect(nodeRuntimeServiceReadinessFailedErrorCode).toBe('runtime_service_readiness_failed');
    expect(nodeRuntimeServiceStartupFailedErrorCode).toBe('runtime_service_startup_failed');
  });

  it('requires explicit runtime network intent', (): void => {
    const request: NodeDeployRequest = createNodeDeployRequest({
      runtimeNetwork: {
        requiresResourceNetwork: true,
      },
    });

    expect(nodeDeployRequestSchema.parse(request).runtimeNetwork).toEqual({
      requiresResourceNetwork: true,
    });
    expect(nodeDeployRequestSchema.safeParse({ ...request, runtimeNetwork: undefined }).success).toBe(false);
    expect(
      nodeDeployRequestSchema.safeParse({
        ...request,
        runtimeNetwork: { requiresResourceNetwork: false, serviceNetwork: true },
      }).success,
    ).toBe(false);
  });

  it('exposes only upstream port from the previous deployment to node runtime', (): void => {
    const request: NodeDeployRequest = createNodeDeployRequest({
      previousDeployment: {
        upstreamPort: 31000,
      },
    });
    const invalidRequest: InvalidNodeDeployRequest = {
      ...request,
      previousDeployment: {
        nodeSocketPath: '/tmp/compartment/contracts/node/previous-agent.sock',
        upstreamPort: 31000,
      },
    };

    expect(nodeDeployRequestSchema.parse(request).previousDeployment).toEqual({
      upstreamPort: 31000,
    });
    expect(nodeDeployRequestSchema.safeParse(invalidRequest).success).toBe(false);
  });
});

describe('node runtime network reservation contract', (): void => {
  it('accepts reservation and cleanup payloads', (): void => {
    const request: NodeRuntimeNetworkReservationRequest = {
      deploymentId: 'dep_123',
      environmentId: 'env_123',
      projectId: 'prj_123',
      requiresResourceNetwork: true,
      serviceId: 'svc_123',
      serviceNetworkEndpointReservations: 2,
    };
    const cleanupRequest: NodeRuntimeNetworkReservationCleanupRequest = {
      networkNames: ['compartment-test-prj-123-env-123-svc-123'],
      reservationId: 'dep_123',
    };

    expect(nodeRuntimeNetworkReservationRequestSchema.parse(request).requiresResourceNetwork).toBe(true);
    expect(
      nodeRuntimeNetworkReservationResponseSchema.parse({
        expiresAt: '2026-03-23T14:00:00.000Z',
        newlyCreatedNetworkNames: ['compartment-test-prj-123-env-123-svc-123'],
        reservationId: 'dep_123',
        reservedNetworkNames: ['compartment-test-prj-123-env-123-svc-123'],
      }).reservationId,
    ).toBe('dep_123');
    expect(nodeRuntimeNetworkReservationCleanupRequestSchema.parse(cleanupRequest).networkNames).toHaveLength(1);
    expect(
      nodeRuntimeNetworkReservationCleanupResponseSchema.parse({
        cleanedAt: '2026-03-23T15:00:00.000Z',
      }).cleanedAt,
    ).toBe('2026-03-23T15:00:00.000Z');
    expect(
      nodeRuntimeNetworkReservationRequestSchema.safeParse({
        ...request,
        dockerNetworkName: 'custom',
      }).success,
    ).toBe(false);
  });
});

describe('node resource operation contract', (): void => {
  it('accepts backup ids instead of host artifact paths', (): void => {
    const request: NodeResourceOperationRequest = createNodeResourceOperationRequest();
    const rawPathRequest: InvalidNodeResourceOperationRawPathRequest = {
      artifactHostPath: '/etc',
      definition: request.definition,
      environmentId: request.environmentId,
      environmentName: request.environmentName,
      projectId: request.projectId,
      projectName: request.projectName,
      readiness: request.readiness,
      resourceHostname: request.resourceHostname,
      resourceName: request.resourceName,
    };

    expect(nodeResourceOperationRequestSchema.parse(request).backupId).toBe('rbak_123');
    expect(nodeResourceOperationRequestSchema.safeParse(rawPathRequest).success).toBe(false);
    expect(nodeResourceOperationRequestSchema.safeParse({ ...request, backupId: '../etc' }).success).toBe(false);
  });
});

function createNodeDeployRequest(overrides: Partial<NodeDeployRequest> = {}): NodeDeployRequest {
  return {
    deploymentId: 'dep_123',
    environmentId: 'env_123',
    environmentName: 'production',
    imageRef: 'sha256:image',
    projectId: 'prj_123',
    projectName: 'smoke-web',
    readiness: {
      path: '/healthz',
      timeoutMs: 30000,
      type: 'http',
    },
    routeHost: 'smoke-web.localhost',
    run: {
      restart: {
        policy: 'on-failure',
      },
    },
    runtimeNetwork: {
      requiresResourceNetwork: false,
    },
    runtimeEnv: {},
    serviceId: 'svc_123',
    serviceName: 'web',
    ...overrides,
  };
}

function createNodeResourceOperationRequest(
  overrides: Partial<NodeResourceOperationRequest> = {},
): NodeResourceOperationRequest {
  return {
    backupId: 'rbak_123',
    definition: {
      command: 'pg_dump > "$COMPARTMENT_BACKUP_DIR/dump.sql"',
      env: [],
      image: 'postgres:16',
    },
    environmentId: 'env_123',
    environmentName: 'production',
    projectId: 'prj_123',
    projectName: 'smoke-web',
    readiness: null,
    resourceHostname: 'postgres.production.smoke-web.resource.internal',
    resourceName: 'postgres',
    ...overrides,
  };
}
