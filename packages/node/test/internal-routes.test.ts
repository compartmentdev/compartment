import Fastify, { type LightMyRequestResponse } from 'fastify';
import {
  errorResponseSchema,
  nodeDeployResponseSchema,
  nodeInspectDeploymentResponseSchema,
  nodeProjectCleanupPathname,
  nodeResourceLogsPathname,
  nodeResourceOperationBackupPathname,
  nodeResourceOperationRestorePathname,
  nodeResourceRestartPolicyPathname,
  nodeResourceStartPathname,
  nodeResourceStopPathname,
  nodeRuntimeNetworkReconcilePathname,
  nodeRuntimeNetworkReconcileResponseSchema,
  nodeRuntimeNetworkReservationCleanupPathname,
  nodeRuntimeNetworkReservationPathname,
  nodeRuntimeNetworkReservationResponseSchema,
  nodeStopDeploymentResponseSchema,
  nodeTailLogsResponseSchema,
  type NodeDeployResponse,
  type NodeInspectDeploymentResponse,
  type NodeRuntimeNetworkReconcileResponse,
  type NodeRuntimeNetworkReservationResponse,
  type NodeStopDeploymentResponse,
  type NodeTailLogsResponse,
} from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NodeApp } from '../src/app.types';
import type { NodeConfig } from '../src/config';
import { registerNodeRoutes } from '../src/routes/register-routes';
import { createRuntimeNetworkPoolConfig } from './runtime-network-pool.fixture';
import type {
  deployRuntimeContainer,
  inspectRuntimeDeployment,
  stopRuntimeContainer,
  tailRuntimeContainerLogs,
} from '../src/services/runtime.service';
import type { reconcileRuntimeNetworks } from '../src/services/runtime-network.service';
import type { cleanupRuntimeProject } from '../src/services/runtime-project-cleanup.service';
import type {
  cleanupRuntimeNetworkReservation,
  reserveRuntimeNetworksForDeployment,
} from '../src/services/runtime-network-capacity.service';
import type { updateRuntimeResourceRestartPolicy } from '../src/services/runtime-resource-restart-policy.service';

type CleanupRuntimeProject = typeof cleanupRuntimeProject;
type CleanupRuntimeNetworkReservation = typeof cleanupRuntimeNetworkReservation;
type DeployRuntimeContainer = typeof deployRuntimeContainer;
type InspectRuntimeDeployment = typeof inspectRuntimeDeployment;
type ReconcileRuntimeNetworks = typeof reconcileRuntimeNetworks;
type ReserveRuntimeNetworksForDeployment = typeof reserveRuntimeNetworksForDeployment;
type StopRuntimeContainer = typeof stopRuntimeContainer;
type TailRuntimeContainerLogs = typeof tailRuntimeContainerLogs;
type UpdateRuntimeResourceRestartPolicy = typeof updateRuntimeResourceRestartPolicy;

interface NodeInternalInvalidRouteCase {
  code: string;
  method: 'GET' | 'POST';
  payload?: object | undefined;
  url: string;
}

interface TestErrorDetails {
  code: string;
  message: string;
}

interface TestErrorResponse {
  error: TestErrorDetails;
}

interface InternalRouteMocks {
  cleanupRuntimeNetworkReservation: Mock<CleanupRuntimeNetworkReservation>;
  cleanupRuntimeProject: Mock<CleanupRuntimeProject>;
  deployRuntimeContainer: Mock<DeployRuntimeContainer>;
  inspectRuntimeDeployment: Mock<InspectRuntimeDeployment>;
  reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks>;
  reserveRuntimeNetworksForDeployment: Mock<ReserveRuntimeNetworksForDeployment>;
  stopRuntimeContainer: Mock<StopRuntimeContainer>;
  tailRuntimeContainerLogs: Mock<TailRuntimeContainerLogs>;
  updateRuntimeResourceRestartPolicy: Mock<UpdateRuntimeResourceRestartPolicy>;
}

const mocks: InternalRouteMocks = vi.hoisted(
  (): InternalRouteMocks => ({
    cleanupRuntimeNetworkReservation: vi.fn<CleanupRuntimeNetworkReservation>(),
    cleanupRuntimeProject: vi.fn<CleanupRuntimeProject>(),
    deployRuntimeContainer: vi.fn<DeployRuntimeContainer>(),
    inspectRuntimeDeployment: vi.fn<InspectRuntimeDeployment>(),
    reconcileRuntimeNetworks: vi.fn<ReconcileRuntimeNetworks>(),
    reserveRuntimeNetworksForDeployment: vi.fn<ReserveRuntimeNetworksForDeployment>(),
    stopRuntimeContainer: vi.fn<StopRuntimeContainer>(),
    tailRuntimeContainerLogs: vi.fn<TailRuntimeContainerLogs>(),
    updateRuntimeResourceRestartPolicy: vi.fn<UpdateRuntimeResourceRestartPolicy>(),
  }),
);

vi.mock(
  '../src/services/runtime-network-capacity.service',
  (): {
    cleanupRuntimeNetworkReservation: Mock<CleanupRuntimeNetworkReservation>;
    reserveRuntimeNetworksForDeployment: Mock<ReserveRuntimeNetworksForDeployment>;
  } => ({
    cleanupRuntimeNetworkReservation: mocks.cleanupRuntimeNetworkReservation,
    reserveRuntimeNetworksForDeployment: mocks.reserveRuntimeNetworksForDeployment,
  }),
);

vi.mock(
  '../src/services/runtime-project-cleanup.service',
  (): {
    cleanupRuntimeProject: Mock<CleanupRuntimeProject>;
  } => ({
    cleanupRuntimeProject: mocks.cleanupRuntimeProject,
  }),
);

vi.mock(
  '../src/services/runtime.service',
  (): {
    deployRuntimeContainer: Mock<DeployRuntimeContainer>;
    inspectRuntimeDeployment: Mock<InspectRuntimeDeployment>;
    stopRuntimeContainer: Mock<StopRuntimeContainer>;
    tailRuntimeContainerLogs: Mock<TailRuntimeContainerLogs>;
  } => ({
    deployRuntimeContainer: mocks.deployRuntimeContainer,
    inspectRuntimeDeployment: mocks.inspectRuntimeDeployment,
    stopRuntimeContainer: mocks.stopRuntimeContainer,
    tailRuntimeContainerLogs: mocks.tailRuntimeContainerLogs,
  }),
);

vi.mock(
  '../src/services/runtime-network.service',
  (): {
    reconcileRuntimeNetworks: Mock<ReconcileRuntimeNetworks>;
  } => ({
    reconcileRuntimeNetworks: mocks.reconcileRuntimeNetworks,
  }),
);

vi.mock(
  '../src/services/runtime-resource-restart-policy.service',
  (): {
    updateRuntimeResourceRestartPolicy: Mock<UpdateRuntimeResourceRestartPolicy>;
  } => ({
    updateRuntimeResourceRestartPolicy: mocks.updateRuntimeResourceRestartPolicy,
  }),
);

afterEach((): void => {
  mocks.cleanupRuntimeNetworkReservation.mockReset();
  mocks.cleanupRuntimeProject.mockReset();
  mocks.deployRuntimeContainer.mockReset();
  mocks.inspectRuntimeDeployment.mockReset();
  mocks.reconcileRuntimeNetworks.mockReset();
  mocks.reserveRuntimeNetworksForDeployment.mockReset();
  mocks.stopRuntimeContainer.mockReset();
  mocks.tailRuntimeContainerLogs.mockReset();
  mocks.updateRuntimeResourceRestartPolicy.mockReset();
});

describe('internal node routes', (): void => {
  it('rejects deploy requests without the runtime control token', async (): Promise<void> => {
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          method: 'POST',
          payload: {
            deploymentId: 'dep_123',
            environmentId: 'env_123',
            environmentName: 'production',
            imageRef: 'sha256:image',
            projectId: 'prj_123',
            projectName: 'smoke-web',
            runtimeEnv: {},
            serviceId: 'svc_123',
            serviceName: 'web',
          },
          url: '/internal/deployments/deploy',
        }),
      );

      expect(response.statusCode).toBe(401);
      expect(mocks.deployRuntimeContainer).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns runtime logs for requests with valid runtime control auth', async (): Promise<void> => {
    mocks.tailRuntimeContainerLogs.mockResolvedValueOnce({
      lines: [
        {
          deploymentId: 'dep_123',
          environmentName: 'production',
          message: 'boot complete',
          serviceName: 'web',
          stream: 'stdout',
          timestamp: '2026-03-23T12:00:00.000Z',
        },
      ],
    });
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          headers: {
            authorization: 'Bearer test-runtime-control-token',
          },
          method: 'GET',
          url: '/internal/deployments/logs?containerId=container_123&deploymentId=dep_123&environmentName=production&serviceName=web&since=2026-03-23T12:00:00.000Z',
        }),
      );

      expect(response.statusCode).toBe(200);
      const payload: NodeTailLogsResponse = nodeTailLogsResponseSchema.parse(response.json());

      expect(payload.lines[0]?.message).toBe('boot complete');
      expect(mocks.tailRuntimeContainerLogs).toHaveBeenCalledTimes(1);
      expect(mocks.tailRuntimeContainerLogs).toHaveBeenCalledWith({
        containerId: 'container_123',
        deploymentId: 'dep_123',
        environmentName: 'production',
        serviceName: 'web',
        since: '2026-03-23T12:00:00.000Z',
      });
    } finally {
      await app.close();
    }
  });

  it('stops runtime containers for requests with valid runtime control auth', async (): Promise<void> => {
    mocks.stopRuntimeContainer.mockResolvedValueOnce(
      nodeStopDeploymentResponseSchema.parse({
        stoppedAt: '2026-03-24T12:00:00.000Z',
      }),
    );
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          headers: {
            authorization: 'Bearer test-runtime-control-token',
          },
          method: 'POST',
          payload: {
            containerId: 'container_123',
          },
          url: '/internal/deployments/stop',
        }),
      );

      expect(response.statusCode).toBe(200);
      const payload: NodeStopDeploymentResponse = nodeStopDeploymentResponseSchema.parse(response.json());

      expect(payload.stoppedAt).toBe('2026-03-24T12:00:00.000Z');
      expect(mocks.stopRuntimeContainer).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('deploys runtime containers for requests with valid runtime control auth', async (): Promise<void> => {
    mocks.deployRuntimeContainer.mockResolvedValueOnce(
      nodeDeployResponseSchema.parse({
        containerId: 'container_123',
        imageRef: 'sha256:image',
        routeHost: 'smoke-web.localhost',
        upstreamHost: '127.0.0.1',
        upstreamPort: 31000,
        startedAt: '2026-03-23T12:00:00.000Z',
      }),
    );
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          headers: {
            authorization: 'Bearer test-runtime-control-token',
          },
          method: 'POST',
          payload: {
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
            run: {
              restart: {
                policy: 'on-failure',
              },
            },
            routeHost: 'smoke-web.localhost',
            runtimeEnv: {},
            runtimeNetwork: {
              requiresResourceNetwork: false,
            },
            serviceId: 'svc_123',
            serviceName: 'web',
          },
          url: '/internal/deployments/deploy',
        }),
      );

      expect(response.statusCode).toBe(200);
      const payload: NodeDeployResponse = nodeDeployResponseSchema.parse(response.json());

      expect(payload.containerId).toBe('container_123');
      expect(mocks.deployRuntimeContainer).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('rejects runtime network reconcile requests without the runtime control token', async (): Promise<void> => {
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          method: 'POST',
          url: nodeRuntimeNetworkReconcilePathname,
        }),
      );

      expect(response.statusCode).toBe(401);
      expect(mocks.reconcileRuntimeNetworks).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('reconciles runtime networks for requests with valid runtime control auth', async (): Promise<void> => {
    mocks.reconcileRuntimeNetworks.mockResolvedValueOnce(undefined);
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          headers: {
            authorization: 'Bearer test-runtime-control-token',
          },
          method: 'POST',
          url: nodeRuntimeNetworkReconcilePathname,
        }),
      );

      expect(response.statusCode).toBe(200);
      const payload: NodeRuntimeNetworkReconcileResponse = nodeRuntimeNetworkReconcileResponseSchema.parse(
        response.json(),
      );

      expect(payload.success).toBe(true);
      expect(mocks.reconcileRuntimeNetworks).toHaveBeenCalledTimes(1);
      expect(mocks.reconcileRuntimeNetworks).toHaveBeenCalledWith(
        expect.objectContaining({
          dockerNamespace: 'compartment-test',
          runtimeConnectivityMode: 'loopback',
        }),
      );
    } finally {
      await app.close();
    }
  });

  it('inspects stable runtime containers for requests with valid runtime control auth', async (): Promise<void> => {
    mocks.inspectRuntimeDeployment.mockResolvedValueOnce(
      nodeInspectDeploymentResponseSchema.parse({
        deployment: {
          containerId: 'container_123',
          imageRef: 'sha256:image',
          routeHost: 'smoke-web.localhost',
          upstreamHost: '127.0.0.1',
          upstreamPort: 31000,
        },
      }),
    );
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          headers: {
            authorization: 'Bearer test-runtime-control-token',
          },
          method: 'GET',
          url: '/internal/deployments/inspect?deploymentId=dep_123&environmentName=production&projectName=smoke-web&serviceName=web',
        }),
      );

      expect(response.statusCode).toBe(200);
      const payload: NodeInspectDeploymentResponse = nodeInspectDeploymentResponseSchema.parse(response.json());

      expect(payload.deployment?.containerId).toBe('container_123');
      expect(mocks.inspectRuntimeDeployment).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('reserves runtime networks for authenticated internal requests', async (): Promise<void> => {
    mocks.reserveRuntimeNetworksForDeployment.mockResolvedValueOnce(
      nodeRuntimeNetworkReservationResponseSchema.parse({
        expiresAt: '2026-03-23T14:00:00.000Z',
        newlyCreatedNetworkNames: ['compartment-test-prj-123-env-123-svc-123'],
        reservationId: 'dep_123',
        reservedNetworkNames: ['compartment-test-prj-123-env-123-svc-123'],
      }),
    );
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          headers: {
            authorization: 'Bearer test-runtime-control-token',
          },
          method: 'POST',
          payload: {
            deploymentId: 'dep_123',
            environmentId: 'env_123',
            projectId: 'prj_123',
            requiresResourceNetwork: false,
            serviceId: 'svc_123',
            serviceNetworkEndpointReservations: 2,
          },
          url: nodeRuntimeNetworkReservationPathname,
        }),
      );

      expect(response.statusCode).toBe(200);
      const payload: NodeRuntimeNetworkReservationResponse = nodeRuntimeNetworkReservationResponseSchema.parse(
        response.json(),
      );

      expect(payload.reservationId).toBe('dep_123');
      expect(mocks.reserveRuntimeNetworksForDeployment).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it.each([
    {
      code: 'invalid_node_inspect_deployment_query',
      method: 'GET',
      url: '/internal/deployments/inspect?deploymentId=dep_123',
    },
    {
      code: 'invalid_node_tail_logs_query',
      method: 'GET',
      url: '/internal/deployments/logs?containerId=container_123&deploymentId=dep_123&environmentName=production&serviceName=web&tailLines=501',
    },
    {
      code: 'invalid_node_stop_deployment_request',
      method: 'POST',
      url: '/internal/deployments/stop',
    },
    {
      code: 'invalid_node_resource_logs_query',
      method: 'GET',
      url: `${nodeResourceLogsPathname}?containerId=resource_container_123`,
    },
    {
      code: 'invalid_node_resource_stop_request',
      method: 'POST',
      url: nodeResourceStopPathname,
    },
    {
      code: 'invalid_node_internal_request',
      method: 'POST',
      url: nodeResourceStartPathname,
    },
    {
      code: 'invalid_node_resource_operation_request',
      method: 'POST',
      payload: { artifactHostPath: '/tmp/backup' },
      url: nodeResourceOperationBackupPathname,
    },
    {
      code: 'invalid_node_resource_operation_request',
      method: 'POST',
      payload: { artifactHostPath: '/tmp/backup' },
      url: nodeResourceOperationRestorePathname,
    },
    {
      code: 'invalid_node_internal_request',
      method: 'POST',
      payload: {
        deploymentId: 'dep_123',
        environmentId: 'env_123',
        projectId: 'prj_123',
        requiresResourceNetwork: false,
        serviceId: 'svc_123',
        serviceNetworkEndpointReservations: 3,
      },
      url: nodeRuntimeNetworkReservationPathname,
    },
    {
      code: 'invalid_node_internal_request',
      method: 'POST',
      payload: { reservationId: 'dep_123' },
      url: nodeRuntimeNetworkReservationCleanupPathname,
    },
  ] satisfies NodeInternalInvalidRouteCase[])(
    'returns contract errors for invalid authenticated $url requests',
    async (input: NodeInternalInvalidRouteCase): Promise<void> => {
      const { app } = createTestApp();

      try {
        const response: LightMyRequestResponse = await withInjectTimeout(
          app.inject({
            headers: {
              authorization: 'Bearer test-runtime-control-token',
            },
            method: input.method,
            ...(input.payload !== undefined ? { payload: input.payload } : {}),
            url: input.url,
          }),
        );

        expectNodeError(response, 400, input.code);
        expect(response.body).not.toContain('ZodError');
        expect(response.body).not.toContain('invalid_type');
      } finally {
        await app.close();
      }
    },
  );

  it('returns contract errors for malformed authenticated JSON requests', async (): Promise<void> => {
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          headers: {
            authorization: 'Bearer test-runtime-control-token',
            'content-type': 'application/json',
          },
          method: 'POST',
          payload: '{',
          url: '/internal/deployments/stop',
        }),
      );

      expectNodeError(response, 400, 'invalid_node_internal_request');
      expect(response.body).not.toContain('JSON');
    } finally {
      await app.close();
    }
  });

  it('rejects project runtime cleanup requests without the runtime control token', async (): Promise<void> => {
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          method: 'POST',
          payload: createProjectCleanupPayload(),
          url: nodeProjectCleanupPathname,
        }),
      );

      expect(response.statusCode).toBe(401);
      expect(mocks.cleanupRuntimeProject).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects resource restart policy updates without the runtime control token', async (): Promise<void> => {
    const { app } = createTestApp();

    try {
      const response: LightMyRequestResponse = await withInjectTimeout(
        app.inject({
          method: 'POST',
          payload: createResourceRestartPolicyPayload(),
          url: nodeResourceRestartPolicyPathname,
        }),
      );

      expect(response.statusCode).toBe(401);
      expect(mocks.updateRuntimeResourceRestartPolicy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

function createProjectCleanupPayload(): {
  caddyNetworkMode: 'disconnect-stale';
  deleteData: boolean;
  projectId: string;
  projectName: string;
  resources: [];
} {
  return {
    caddyNetworkMode: 'disconnect-stale',
    deleteData: true,
    projectId: 'prj_123',
    projectName: 'smoke-web',
    resources: [],
  };
}

function createResourceRestartPolicyPayload(): {
  containerId: string;
  environmentName: string;
  projectName: string;
  resourceName: string;
  restart: {
    policy: 'no';
  };
} {
  return {
    containerId: 'resource_container_123',
    environmentName: 'production',
    projectName: 'smoke-web',
    resourceName: 'postgres',
    restart: {
      policy: 'no',
    },
  };
}

function expectNodeError(response: LightMyRequestResponse, statusCode: number, code: string): void {
  expect(response.statusCode).toBe(statusCode);
  const payload: TestErrorResponse = errorResponseSchema.parse(response.json());
  expect(payload.error).toEqual({
    code,
    message: 'The node internal request is invalid.',
  });
}

function createTestApp(): { app: NodeApp } {
  const app: NodeApp = Fastify();
  registerNodeRoutes(app, createNodeConfig());

  return { app };
}

function createNodeConfig(): NodeConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    appPortEnd: 31999,
    appPortStart: 31000,
    dockerNamespace: 'compartment-test',
    logLevel: 'silent',
    name: 'local-node',
    nodeSocketPath: '/tmp/compartment/node-test/node/internal-routes.sock',
    resourceBackupDirectory: '/var/lib/compartment/resource-backups',
    runtimeConnectivityMode: 'loopback',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    version: '0.1.0',
    runtimeControlToken: 'test-runtime-control-token',
  };
}

async function withInjectTimeout<TResponse>(promise: Promise<TResponse>): Promise<TResponse> {
  return await Promise.race([
    promise,
    new Promise<TResponse>((_resolve: (value: TResponse) => void, reject: (reason?: Error) => void): void => {
      setTimeout((): void => {
        reject(new Error('Timed out waiting for internal node route response.'));
      }, 1000);
    }),
  ]);
}
