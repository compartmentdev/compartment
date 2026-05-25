import type { DockerInspectContainerResult, DockerInspectNetworkResult } from '@compartment/docker';
import type { NodeInspectDeploymentResponse, ResolvedServiceReadinessConfig } from '@compartment/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { inspectRuntimeDeployment } from '../src/services/runtime-inspect.service';
import { buildDeploymentUpstreamHost, buildRuntimeServiceNetworkName } from '../src/services/runtime-names.service';
import type { RuntimeConnectivityMode } from '../src/services/runtime.types';

type InspectDockerContainer = (input: { containerRef: string }) => Promise<DockerInspectContainerResult | null>;
type BuildDockerNamespaceLabels = (namespace: string) => Record<string, string>;
type EnsureDockerNetwork = (input: DockerEnsureNetworkInput) => Promise<void>;
type InspectDockerNetwork = (input: { networkName: string }) => Promise<DockerInspectNetworkResult | null>;
type WaitForHealthyRuntime = (
  host: string | (() => Promise<string>),
  hostPort: number,
  readiness: ResolvedServiceReadinessConfig,
  options?: { hostHeader?: string },
) => Promise<void>;

interface DockerNetworkReadinessInput {
  dockerNamespace: string;
  host: string;
  hostHeader: string;
  networkName: string;
  port: number;
  probeImageRef: string;
  readiness: ResolvedServiceReadinessConfig;
}

interface DockerEnsureNetworkInput {
  labels: Record<string, string>;
  networkName: string;
}

type WaitForHealthyRuntimeFromDockerNetwork = (input: DockerNetworkReadinessInput) => Promise<void>;

interface RuntimeInspectServiceTestMocks {
  inspectDockerContainer: Mock<InspectDockerContainer>;
  buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
  ensureDockerNetwork: Mock<EnsureDockerNetwork>;
  inspectDockerNetwork: Mock<InspectDockerNetwork>;
  waitForHealthyRuntime: Mock<WaitForHealthyRuntime>;
  waitForHealthyRuntimeFromDockerNetwork: Mock<WaitForHealthyRuntimeFromDockerNetwork>;
}

interface RuntimeInspectConfigFixture {
  dockerNamespace: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
  runtimeProbeImageRef: string;
}

const mocks: RuntimeInspectServiceTestMocks = vi.hoisted(
  (): RuntimeInspectServiceTestMocks => ({
    inspectDockerContainer: vi.fn<InspectDockerContainer>(),
    buildDockerNamespaceLabels: vi.fn<BuildDockerNamespaceLabels>(
      (namespace: string): Record<string, string> => ({
        'compartment.namespace': namespace,
      }),
    ),
    ensureDockerNetwork: vi.fn<EnsureDockerNetwork>(),
    inspectDockerNetwork: vi.fn<InspectDockerNetwork>(),
    waitForHealthyRuntime: vi.fn<WaitForHealthyRuntime>(),
    waitForHealthyRuntimeFromDockerNetwork: vi.fn<WaitForHealthyRuntimeFromDockerNetwork>(),
  }),
);

vi.mock(
  '@compartment/docker',
  (): {
    compartmentDockerNamespaceLabelName: string;
    buildDockerNamespaceLabels: Mock<BuildDockerNamespaceLabels>;
    ensureDockerNetwork: Mock<EnsureDockerNetwork>;
    inspectDockerContainer: Mock<InspectDockerContainer>;
    inspectDockerNetwork: Mock<InspectDockerNetwork>;
  } => ({
    compartmentDockerNamespaceLabelName: 'compartment.namespace',
    buildDockerNamespaceLabels: mocks.buildDockerNamespaceLabels,
    ensureDockerNetwork: mocks.ensureDockerNetwork,
    inspectDockerContainer: mocks.inspectDockerContainer,
    inspectDockerNetwork: mocks.inspectDockerNetwork,
  }),
);

vi.mock('../src/services/runtime-health.service', (): { waitForHealthyRuntime: Mock<WaitForHealthyRuntime> } => ({
  waitForHealthyRuntime: mocks.waitForHealthyRuntime,
}));

vi.mock(
  '../src/services/runtime-docker-readiness.service',
  (): { waitForHealthyRuntimeFromDockerNetwork: Mock<WaitForHealthyRuntimeFromDockerNetwork> } => ({
    waitForHealthyRuntimeFromDockerNetwork: mocks.waitForHealthyRuntimeFromDockerNetwork,
  }),
);

afterEach((): void => {
  mocks.inspectDockerContainer.mockReset();
  mocks.buildDockerNamespaceLabels.mockClear();
  mocks.ensureDockerNetwork.mockReset();
  mocks.inspectDockerNetwork.mockReset();
  mocks.waitForHealthyRuntime.mockReset();
  mocks.waitForHealthyRuntimeFromDockerNetwork.mockReset();
});

describe('inspectRuntimeDeployment', (): void => {
  beforeEach((): void => {
    mocks.inspectDockerNetwork.mockResolvedValue({
      endpointContainerIds: [],
      ipamConfigs: [],
      labels: {
        'compartment.namespace': 'compartment-e2e',
      },
      name: 'runtime-network',
    });
  });

  it('returns stable runtime metadata when the container matches the deployment', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123456',
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.upstreamHost': '127.0.0.1',
        'compartment.upstreamPort': '31000',
      },
      publishedPorts: [
        {
          containerPort: 3000,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
    });

    const response: NodeInspectDeploymentResponse = await inspectRuntimeDeployment(
      {
        deploymentId: 'dep_123456',
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
      createRuntimeInspectConfig(),
    );

    expect(response).toEqual({
      deployment: {
        containerId: 'container_123',
        imageRef: 'sha256:image',
        routeHost: 'smoke-web.localhost',
        upstreamHost: '127.0.0.1',
        upstreamPort: 31000,
      },
    });
    expect(mocks.inspectDockerContainer).toHaveBeenCalledWith({
      containerRef: 'compartment-compartment-e2e-smoke-web-production-web-dep_123456',
    });
  });

  it('reads network-mode upstream metadata from container labels when no ports are published', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123456',
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.upstreamHost': 'compartment-compartment-e2e-smoke-web-production-web-dep-123456',
        'compartment.upstreamPort': '3000',
      },
      publishedPorts: [],
    });

    const response: NodeInspectDeploymentResponse = await inspectRuntimeDeployment(
      {
        deploymentId: 'dep_123456',
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
      createRuntimeInspectConfig(),
    );

    expect(response).toEqual({
      deployment: {
        containerId: 'container_123',
        imageRef: 'sha256:image',
        routeHost: 'smoke-web.localhost',
        upstreamHost: 'compartment-compartment-e2e-smoke-web-production-web-dep-123456',
        upstreamPort: 3000,
      },
    });
  });

  it('returns null when the inspected deployment container belongs to another deployment', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_previous',
        'compartment.routeHost': 'smoke-web.localhost',
      },
      publishedPorts: [
        {
          containerPort: 3000,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
    });

    await expect(
      inspectRuntimeDeployment(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          serviceName: 'web',
        },
        createRuntimeInspectConfig(),
      ),
    ).resolves.toEqual({ deployment: null });
  });

  it('returns null when readiness does not pass during recovery inspection', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123456',
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.upstreamHost': '127.0.0.1',
        'compartment.upstreamPort': '31000',
      },
      publishedPorts: [
        {
          containerPort: 3000,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
    });
    mocks.waitForHealthyRuntime.mockRejectedValueOnce(new Error('not ready'));

    await expect(
      inspectRuntimeDeployment(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          readinessPath: '/healthz',
          readinessTimeoutMs: 30000,
          readinessType: 'http',
          serviceName: 'web',
        },
        createRuntimeInspectConfig(),
      ),
    ).resolves.toEqual({ deployment: null });
    expect(mocks.waitForHealthyRuntime).toHaveBeenCalledWith('127.0.0.1', 31000, createReadiness(), {
      hostHeader: '127.0.0.1',
    });
  });

  it('checks loopback readiness through the upstream host when a resource network IP exists', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123456',
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.upstreamHost': '127.0.0.1',
        'compartment.upstreamPort': '31000',
      },
      networkAttachments: [
        {
          ipAddress: ['172', '18', '0', '12'].join('.'),
          name: 'compartment-compartment-e2e-prj-smoke-web-env-production-resources',
        },
      ],
      publishedPorts: [
        {
          containerPort: 3000,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
    });
    mocks.waitForHealthyRuntime.mockResolvedValueOnce(undefined);

    await expect(
      inspectRuntimeDeployment(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          readinessPath: '/healthz',
          readinessTimeoutMs: 30000,
          readinessType: 'http',
          serviceName: 'web',
        },
        createRuntimeInspectConfig(),
      ),
    ).resolves.toEqual({
      deployment: {
        containerId: 'container_123',
        imageRef: 'sha256:image',
        routeHost: 'smoke-web.localhost',
        upstreamHost: '127.0.0.1',
        upstreamPort: 31000,
      },
    });
    expect(mocks.waitForHealthyRuntime).toHaveBeenCalledWith('127.0.0.1', 31000, createReadiness(), {
      hostHeader: '127.0.0.1',
    });
  });

  it('checks network readiness through the canonical service network attachment', async (): Promise<void> => {
    const networkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
        serviceId: 'svc_web',
      },
      'compartment-e2e',
    );
    const upstreamHost: string = buildDeploymentUpstreamHost(
      {
        deploymentId: 'dep_123456',
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
      'compartment-e2e',
    );
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123456',
        'compartment.environmentId': 'env_production',
        'compartment.projectId': 'prj_smoke_web',
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.serviceId': 'svc_web',
        'compartment.upstreamHost': upstreamHost,
        'compartment.upstreamPort': '3000',
      },
      networkAttachments: [
        {
          ipAddress: null,
          name: networkName,
        },
      ],
      publishedPorts: [],
    });
    mocks.waitForHealthyRuntimeFromDockerNetwork.mockResolvedValueOnce(undefined);

    await expect(
      inspectRuntimeDeployment(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          readinessPath: '/healthz',
          readinessTimeoutMs: 30000,
          readinessType: 'http',
          serviceName: 'web',
        },
        createRuntimeInspectConfig({ runtimeConnectivityMode: 'network' }),
      ),
    ).resolves.toEqual({
      deployment: {
        containerId: 'container_123',
        imageRef: 'sha256:image',
        routeHost: 'smoke-web.localhost',
        upstreamHost,
        upstreamPort: 3000,
      },
    });
    expect(mocks.waitForHealthyRuntime).not.toHaveBeenCalled();
    expect(mocks.inspectDockerNetwork).toHaveBeenCalledWith({ networkName });
    expect(mocks.waitForHealthyRuntimeFromDockerNetwork).toHaveBeenCalledWith({
      dockerNamespace: 'compartment-e2e',
      host: upstreamHost,
      hostHeader: upstreamHost,
      networkName,
      port: 3000,
      probeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
      readiness: createReadiness(),
    });
  });

  it('does not probe network readiness through an unowned canonical network attachment', async (): Promise<void> => {
    const networkName: string = buildRuntimeServiceNetworkName(
      {
        environmentId: 'env_production',
        projectId: 'prj_smoke_web',
        serviceId: 'svc_web',
      },
      'compartment-e2e',
    );
    const upstreamHost: string = buildDeploymentUpstreamHost(
      {
        deploymentId: 'dep_123456',
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
      'compartment-e2e',
    );
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123456',
        'compartment.environmentId': 'env_production',
        'compartment.projectId': 'prj_smoke_web',
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.serviceId': 'svc_web',
        'compartment.upstreamHost': upstreamHost,
        'compartment.upstreamPort': '3000',
      },
      networkAttachments: [
        {
          ipAddress: null,
          name: networkName,
        },
      ],
      publishedPorts: [],
    });
    mocks.inspectDockerNetwork.mockResolvedValueOnce({
      endpointContainerIds: [],
      ipamConfigs: [],
      labels: {},
      name: networkName,
    });

    await expect(
      inspectRuntimeDeployment(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          readinessPath: '/healthz',
          readinessTimeoutMs: 30000,
          readinessType: 'http',
          serviceName: 'web',
        },
        createRuntimeInspectConfig({ runtimeConnectivityMode: 'network' }),
      ),
    ).resolves.toEqual({ deployment: null });
    expect(mocks.waitForHealthyRuntimeFromDockerNetwork).not.toHaveBeenCalled();
  });

  it('does not probe network readiness through noncanonical runtime network attachments', async (): Promise<void> => {
    const upstreamHost: string = buildDeploymentUpstreamHost(
      {
        deploymentId: 'dep_123456',
        environmentName: 'production',
        projectName: 'smoke-web',
        serviceName: 'web',
      },
      'compartment-e2e',
    );
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: true,
      labels: {
        'compartment.deploymentId': 'dep_123456',
        'compartment.routeHost': 'smoke-web.localhost',
        'compartment.upstreamHost': upstreamHost,
        'compartment.upstreamPort': '3000',
      },
      networkAttachments: [
        {
          ipAddress: null,
          name: 'compartment-compartment-e2e-prj-smoke-web-env-production-resources',
        },
      ],
      publishedPorts: [],
    });

    await expect(
      inspectRuntimeDeployment(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          readinessPath: '/healthz',
          readinessTimeoutMs: 30000,
          readinessType: 'http',
          serviceName: 'web',
        },
        createRuntimeInspectConfig({ runtimeConnectivityMode: 'network' }),
      ),
    ).resolves.toEqual({ deployment: null });
    expect(mocks.waitForHealthyRuntime).not.toHaveBeenCalled();
    expect(mocks.waitForHealthyRuntimeFromDockerNetwork).not.toHaveBeenCalled();
  });

  it('returns null when the inspected runtime is no longer running', async (): Promise<void> => {
    mocks.inspectDockerContainer.mockResolvedValueOnce({
      containerId: 'container_123',
      imageRef: 'sha256:image',
      isRunning: false,
      labels: {
        'compartment.deploymentId': 'dep_123456',
        'compartment.routeHost': 'smoke-web.localhost',
      },
      publishedPorts: [
        {
          containerPort: 3000,
          hostIp: '127.0.0.1',
          hostPort: 31000,
        },
      ],
    });

    await expect(
      inspectRuntimeDeployment(
        {
          deploymentId: 'dep_123456',
          environmentName: 'production',
          projectName: 'smoke-web',
          serviceName: 'web',
        },
        createRuntimeInspectConfig(),
      ),
    ).resolves.toEqual({ deployment: null });
  });
});

function createReadiness(): ResolvedServiceReadinessConfig {
  return {
    path: '/healthz',
    timeoutMs: 30000,
    type: 'http',
  };
}

function createRuntimeInspectConfig(overrides: Partial<RuntimeInspectConfigFixture> = {}): RuntimeInspectConfigFixture {
  return {
    dockerNamespace: 'compartment-e2e',
    runtimeConnectivityMode: 'loopback',
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    ...overrides,
  };
}
