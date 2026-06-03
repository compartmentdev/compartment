import { execFile, execFileSync, type ExecFileOptions } from 'node:child_process';
import {
  createServer,
  request as createHttpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  compartmentInternalNodeRegistrationPathname,
  nodeProjectCleanupPathname,
  nodeProjectCleanupResponseSchema,
  nodeDeployResponseSchema,
  nodeRuntimeNetworkReservationCleanupPathname,
  nodeRuntimeNetworkReservationCleanupResponseSchema,
  nodeRuntimeNetworkReservationPathname,
  nodeRuntimeNetworkReservationResponseSchema,
  type NodeDeployResponse,
  type NodeProjectCleanupResponse,
  type NodeRuntimeNetworkReservationCleanupResponse,
  type NodeRuntimeNetworkReservationRequest,
  type NodeRuntimeNetworkReservationResponse,
} from '@compartment/contracts';
import { compartmentDockerNamespaceLabelName, syncDockerNetworkEgressDenyRules } from '@compartment/docker';
import { cleanupDockerTestNamespacesByPrefix, createDockerTestNamespace } from '@compartment/test-support';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeApp } from '../src/app';
import type { NodeApp } from '../src/app.types';
import type { NodeConfig } from '../src/config';
import { prepareNodeAgentSocketPath, restrictNodeAgentSocketPathPermissions } from '../src/node-agent-socket-path';
import {
  buildDeploymentContainerName,
  buildRuntimeServiceNetworkName,
  buildSystemNetworkName,
} from '../src/services/runtime-names.service';
import { projectIdLabelName } from '../src/services/runtime-container-labels';
import { buildTestIpv4Cidr, createRuntimeNetworkPoolConfig } from './runtime-network-pool.fixture';

interface DockerContainerInspect {
  Config: {
    User: string;
  };
  HostConfig: {
    CapAdd: string[] | null;
    CapDrop: string[] | null;
    Privileged: boolean;
    ReadonlyRootfs: boolean;
    SecurityOpt: string[] | null;
  };
  Id: string;
  NetworkSettings: {
    Networks: Record<string, { Aliases?: string[] | undefined; IPAddress: string } | undefined>;
    Ports: Record<string, { HostIp: string; HostPort: string }[] | null>;
  };
}

interface DockerNetworkInspect {
  IPAM: {
    Config?: DockerNetworkIpamInspect[] | undefined;
  };
  Labels: Record<string, string> | null;
}

interface DockerNetworkIpamInspect {
  Gateway?: string | undefined;
  Subnet?: string | undefined;
}

interface DockerNetworkEgressDenyCleanupInput {
  destinationCidrs: string[];
  namespace: string;
  sourceSubnets: string[];
}

interface NodeAgentRequestInput {
  body: object;
  path: string;
  socketPath: string;
}

const executeFileAsync: (
  file: string,
  args: readonly string[],
  options?: ExecFileOptions,
) => Promise<{ stderr: string; stdout: string }> = promisify(execFile);
const runtimeControlToken: string = 'test-runtime-control-token';
const boundaryAlpineImage: string = 'public.ecr.aws/docker/library/alpine:3.20';
const boundaryNginxImage: string = 'public.ecr.aws/docker/library/nginx:alpine';
const boundaryNodeImage: string = process.env.COMPARTMENT_TEST_APP_NODE_IMAGE ?? 'node:24.15.0-bookworm-slim';

describe.sequential('runtime network boundary', (): void => {
  const cleanupTasks: (() => Promise<void>)[] = [];

  beforeEach(async (): Promise<void> => {
    await cleanupDockerTestNamespacesByPrefix('compartment-e2e');
    await cleanupDockerTestNamespacesByPrefix('compartment-node-boundary');
  }, 120_000);

  afterEach(async (): Promise<void> => {
    while (cleanupTasks.length > 0) {
      await cleanupTasks.pop()?.();
    }
  }, 120_000);

  it.skipIf(!canManageHostFirewallRules())(
    'keeps the host node agent out of service runtime networks in network mode',
    async (): Promise<void> => {
      const dockerNamespace: string = createDockerTestNamespace('compartment-node-boundary');
      const systemNetworkName: string = buildSystemNetworkName(dockerNamespace);
      const serviceNetworkName: string = buildRuntimeServiceNetworkName(
        {
          environmentId: 'env_123',
          projectId: 'prj_123',
          serviceId: 'svc_123',
        },
        dockerNamespace,
      );
      const managedServiceSubnet: string = buildTestIpv4Cidr(10, 240, 0, 0, 28);
      const apiServer: Server = await startMockApiServer();
      const apiPort: number = readServerPort(apiServer);
      const socketDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-node-boundary-'));
      const nodeSocketPath: string = join(socketDirectory, 'node', 'agent.sock');
      const caddyContainerName: string = `${dockerNamespace}-caddy`;
      const runtimeContainerName: string = buildDeploymentContainerName(
        {
          deploymentId: 'dep_123',
          environmentName: 'production',
          projectName: 'smoke-web',
          serviceName: 'web',
        },
        dockerNamespace,
      );

      cleanupTasks.push(async (): Promise<void> => {
        await safeSyncDockerNetworkEgressDenyRules({
          destinationCidrs: [],
          namespace: dockerNamespace,
          sourceSubnets: [],
        });
        await safeDockerCommand(['network', 'disconnect', '-f', serviceNetworkName, caddyContainerName]);
        await safeDockerCommand(['network', 'disconnect', '-f', systemNetworkName, caddyContainerName]);
        await safeDockerCommand(['rm', '-f', runtimeContainerName]);
        await safeDockerCommand(['rm', '-f', caddyContainerName]);
        await safeDockerCommand(['network', 'rm', serviceNetworkName, systemNetworkName]);
        await rm(socketDirectory, { force: true, recursive: true });
        await closeServer(apiServer);
      });

      await runDockerCommand(['network', 'create', systemNetworkName]);
      await pullDockerImageIfMissing(boundaryNodeImage);
      await startCaddyContainer(caddyContainerName, dockerNamespace, systemNetworkName);
      const nodeAgent: NodeApp = await startNodeAgent(createNodeConfig(dockerNamespace, apiPort, nodeSocketPath));
      cleanupTasks.push(async (): Promise<void> => {
        await nodeAgent.close();
      });

      const deployResponse: NodeDeployResponse = await deployRuntime(nodeSocketPath);
      const runtimeInspect: DockerContainerInspect = await inspectDockerContainer(deployResponse.containerId);
      const caddyInspect: DockerContainerInspect = await inspectDockerContainer(caddyContainerName);
      const serviceNetwork: DockerNetworkInspect = await inspectDockerNetwork(serviceNetworkName);

      expect(caddyInspect.NetworkSettings.Networks[serviceNetworkName]).toBeDefined();
      await expect(readProjectNetworkNames(dockerNamespace, 'prj_123')).resolves.toEqual([serviceNetworkName]);
      expect(serviceNetwork.Labels?.['compartment.network.ipam']).toBe('managed');
      expect(serviceNetwork.Labels?.['compartment.network.subnet']).toBe(managedServiceSubnet);
      expect(
        serviceNetwork.IPAM.Config?.map((config: DockerNetworkIpamInspect): string | undefined => config.Subnet),
      ).toContain(managedServiceSubnet);
      expect(readPublishedPortBindings(runtimeInspect)).toHaveLength(0);
      expect(runtimeInspect.HostConfig.CapAdd).toEqual(['CHOWN', 'NET_BIND_SERVICE', 'SETGID', 'SETUID']);
      expect(runtimeInspect.HostConfig.CapDrop).toContain('ALL');
      expect(runtimeInspect.HostConfig.Privileged).toBe(false);
      expect(runtimeInspect.HostConfig.ReadonlyRootfs).toBe(false);
      expect(runtimeInspect.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
      await installCurl(deployResponse.containerId);
      await expectContainerCurlFails(deployResponse.containerId, `http://${buildIpv4Address([169, 254, 169, 254])}/`);
      const serviceGatewayAddress: string = await inspectDockerNetworkGateway(serviceNetworkName);
      await expectContainerCurlFails(deployResponse.containerId, `http://${serviceGatewayAddress}:22/`);
      await expectContainerCurlFails(deployResponse.containerId, `http://${serviceGatewayAddress}:80/`);
      await expectContainerCurlFails(deployResponse.containerId, `https://${serviceGatewayAddress}:443/`);
      await runDockerCommand([
        'exec',
        deployResponse.containerId,
        'curl',
        '--connect-timeout',
        '5',
        '--max-time',
        '10',
        '--fail',
        '--silent',
        '--show-error',
        'https://example.com/',
      ]);

      const cleanupResponse: NodeProjectCleanupResponse = await cleanupProjectRuntime(nodeSocketPath, false);

      expect(cleanupResponse.cleanedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      await expect(readProjectContainerIds(dockerNamespace, 'prj_123')).resolves.toEqual([]);
      await expect(readDockerNetworkExists(serviceNetworkName)).resolves.toBe(false);
      const caddyInspectAfterCleanup: DockerContainerInspect = await inspectDockerContainer(caddyContainerName);

      expect(caddyInspectAfterCleanup.NetworkSettings.Networks[serviceNetworkName]).toBeUndefined();
    },
    120_000,
  );

  it.skipIf(!canInspectHostIpv4Routes())(
    'fails tiny managed-pool reservations before runtime artifacts are created',
    async (): Promise<void> => {
      const dockerNamespace: string = createDockerTestNamespace('compartment-node-boundary');
      const apiServer: Server = await startMockApiServer();
      const apiPort: number = readServerPort(apiServer);
      const socketDirectory: string = await mkdtemp(join(tmpdir(), 'compartment-node-boundary-'));
      const nodeSocketPath: string = join(socketDirectory, 'node', 'agent.sock');

      cleanupTasks.push(async (): Promise<void> => {
        await safeRemoveNamespaceVolumes(dockerNamespace);
        await rm(socketDirectory, { force: true, recursive: true });
        await closeServer(apiServer);
      });

      const nodeAgent: NodeApp = await startNodeAgent(
        createNodeConfig(dockerNamespace, apiPort, nodeSocketPath, {
          runtimeNetworkPool: createRuntimeNetworkPoolConfig({
            cidr: buildTestIpv4Cidr(10, 250, 0, 0, 29),
            subnetPrefixLength: 29,
          }),
        }),
      );
      cleanupTasks.push(async (): Promise<void> => {
        await nodeAgent.close();
      });

      const firstReservation: NodeRuntimeNetworkReservationResponse = await reserveRuntimeNetwork(
        nodeSocketPath,
        createReservationRequest({ deploymentId: 'dep_first', serviceId: 'svc_first' }),
      );
      const firstServiceNetworkName: string = buildRuntimeServiceNetworkName(
        {
          environmentId: 'env_123',
          projectId: 'prj_123',
          serviceId: 'svc_first',
        },
        dockerNamespace,
      );

      await expect(
        reserveRuntimeNetwork(
          nodeSocketPath,
          createReservationRequest({ deploymentId: 'dep_second', serviceId: 'svc_second' }),
        ),
      ).rejects.toThrow('runtime_network_capacity_exhausted');
      await expect(readProjectContainerIds(dockerNamespace, 'prj_123')).resolves.toEqual([]);
      await expect(readProjectNetworkNames(dockerNamespace, 'prj_123')).resolves.toEqual([firstServiceNetworkName]);

      await cleanupRuntimeNetworkReservation(nodeSocketPath, {
        networkNames: firstReservation.newlyCreatedNetworkNames,
        reservationId: firstReservation.reservationId,
      });
      await expect(readProjectNetworkNames(dockerNamespace, 'prj_123')).resolves.toEqual([]);
    },
    120_000,
  );
});

async function startMockApiServer(): Promise<Server> {
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    if (request.method === 'POST' && request.url === compartmentInternalNodeRegistrationPathname) {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          node: {
            id: 'node_123',
            name: 'test-node',
            nodeSocketPath: '/tmp/compartment/node-boundary/node/agent.sock',
            nodeVersion: '0.1.0',
          },
          registeredAt: '2026-01-01T00:00:00.000Z',
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise<void>((resolveListen: () => void, reject: (reason?: Error) => void): void => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', (): void => {
      server.off('error', reject);
      resolveListen();
    });
  });

  return server;
}

async function startNodeAgent(config: NodeConfig): Promise<NodeApp> {
  const app: NodeApp = createNodeApp({ config });
  prepareNodeAgentSocketPath(config.nodeSocketPath, config.runtimeSocketGid);
  await app.listen({
    path: config.nodeSocketPath,
  });
  restrictNodeAgentSocketPathPermissions(config.nodeSocketPath, config.runtimeSocketGid);
  return app;
}

function createNodeConfig(
  dockerNamespace: string,
  apiPort: number,
  nodeSocketPath: string,
  overrides: Partial<Pick<NodeConfig, 'runtimeConnectivityMode' | 'runtimeNetworkPool'>> = {},
): NodeConfig {
  return {
    apiUrl: `http://127.0.0.1:${apiPort.toString()}`,
    appPortEnd: 31999,
    appPortStart: 31000,
    dockerNamespace,
    logLevel: 'silent',
    name: 'test-node',
    nodeSocketPath,
    resourceBackupDirectory: '/var/lib/compartment/resource-backups',
    runtimeConnectivityMode: 'network',
    runtimeDefaultUpstreamHost: 'host.docker.internal',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
    runtimeGid: 10001,
    runtimeUid: 10001,
    runtimeRegistryCredentials: {
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:39461',
      username: 'registry-reader',
    },
    runtimeProbeImageRef: boundaryNodeImage,
    runtimeSocketGid: 10001,
    runtimeControlToken,
    version: '0.1.0',
    ...overrides,
  };
}

async function startCaddyContainer(
  containerName: string,
  dockerNamespace: string,
  systemNetworkName: string,
): Promise<void> {
  await runDockerCommand([
    'run',
    '-d',
    '--name',
    containerName,
    '--label',
    `com.docker.compose.project=${dockerNamespace}`,
    '--label',
    'com.docker.compose.service=caddy',
    '--network',
    systemNetworkName,
    boundaryAlpineImage,
    'sleep',
    '300',
  ]);
}

async function deployRuntime(socketPath: string): Promise<NodeDeployResponse> {
  const responseBody: string = await sendNodeAgentRequest({
    body: {
      deploymentId: 'dep_123',
      environmentId: 'env_123',
      environmentName: 'production',
      imageRef: boundaryNginxImage,
      projectId: 'prj_123',
      projectName: 'smoke-web',
      readiness: {
        path: '/',
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
    path: '/internal/deployments/deploy',
    socketPath,
  });

  return nodeDeployResponseSchema.parse(JSON.parse(responseBody));
}

async function cleanupProjectRuntime(socketPath: string, deleteData: boolean): Promise<NodeProjectCleanupResponse> {
  const responseBody: string = await sendNodeAgentRequest({
    body: {
      caddyNetworkMode: 'disconnect-stale',
      deleteData,
      projectId: 'prj_123',
      projectName: 'smoke-web',
      resources: [],
    },
    path: nodeProjectCleanupPathname,
    socketPath,
  });

  return nodeProjectCleanupResponseSchema.parse(JSON.parse(responseBody));
}

function createReservationRequest(
  overrides: Partial<NodeRuntimeNetworkReservationRequest> = {},
): NodeRuntimeNetworkReservationRequest {
  return {
    deploymentId: 'dep_123',
    environmentId: 'env_123',
    projectId: 'prj_123',
    requiresResourceNetwork: false,
    serviceId: 'svc_123',
    serviceNetworkEndpointReservations: 2,
    ...overrides,
  };
}

async function reserveRuntimeNetwork(
  socketPath: string,
  request: NodeRuntimeNetworkReservationRequest,
): Promise<NodeRuntimeNetworkReservationResponse> {
  const responseBody: string = await sendNodeAgentRequest({
    body: request,
    path: nodeRuntimeNetworkReservationPathname,
    socketPath,
  });

  return nodeRuntimeNetworkReservationResponseSchema.parse(JSON.parse(responseBody));
}

async function cleanupRuntimeNetworkReservation(
  socketPath: string,
  request: { networkNames: string[]; reservationId: string },
): Promise<NodeRuntimeNetworkReservationCleanupResponse> {
  const responseBody: string = await sendNodeAgentRequest({
    body: request,
    path: nodeRuntimeNetworkReservationCleanupPathname,
    socketPath,
  });

  return nodeRuntimeNetworkReservationCleanupResponseSchema.parse(JSON.parse(responseBody));
}

async function sendNodeAgentRequest(input: NodeAgentRequestInput): Promise<string> {
  const requestBody: string = JSON.stringify(input.body);

  return await new Promise<string>(
    (resolveRequest: (value: string) => void, reject: (reason?: Error) => void): void => {
      const request: ClientRequest = createHttpRequest(
        {
          headers: {
            authorization: `Bearer ${runtimeControlToken}`,
            'content-length': Buffer.byteLength(requestBody),
            'content-type': 'application/json',
          },
          method: 'POST',
          path: input.path,
          socketPath: input.socketPath,
        },
        (response: IncomingMessage): void => {
          const chunks: Buffer<ArrayBufferLike>[] = [];
          response.on('data', (chunk: Buffer | string): void => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on('end', (): void => {
            const responseText: string = Buffer.concat(chunks).toString('utf8');
            if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) {
              resolveRequest(responseText);
              return;
            }

            reject(new Error(responseText));
          });
        },
      );
      request.on('error', reject);
      request.write(requestBody);
      request.end();
    },
  );
}

async function inspectDockerContainer(containerRef: string): Promise<DockerContainerInspect> {
  const { stdout } = await runDockerCommand(['inspect', containerRef]);
  const [container] = JSON.parse(stdout) as DockerContainerInspect[];
  if (container === undefined) {
    throw new Error(`Missing docker inspect result for ${containerRef}.`);
  }

  return container;
}

async function readProjectContainerIds(dockerNamespace: string, projectId: string): Promise<string[]> {
  const { stdout } = await runDockerCommand([
    'ps',
    '-aq',
    '--filter',
    `label=${compartmentDockerNamespaceLabelName}=${dockerNamespace}`,
    '--filter',
    `label=${projectIdLabelName}=${projectId}`,
  ]);

  return stdout
    .trim()
    .split('\n')
    .filter((containerId: string): boolean => containerId !== '');
}

async function readProjectNetworkNames(dockerNamespace: string, projectId: string): Promise<string[]> {
  const { stdout } = await runDockerCommand([
    'network',
    'ls',
    '--format',
    '{{.Name}}',
    '--filter',
    `label=${compartmentDockerNamespaceLabelName}=${dockerNamespace}`,
    '--filter',
    `label=${projectIdLabelName}=${projectId}`,
  ]);

  return stdout
    .trim()
    .split('\n')
    .filter((networkName: string): boolean => networkName !== '');
}

async function readDockerNetworkExists(networkName: string): Promise<boolean> {
  try {
    await runDockerCommand(['network', 'inspect', networkName]);
    return true;
  } catch {
    return false;
  }
}

async function inspectDockerNetworkGateway(networkName: string): Promise<string> {
  const network: DockerNetworkInspect = await inspectDockerNetwork(networkName);
  const gateway: string | undefined = network.IPAM.Config?.find(
    (config: DockerNetworkIpamInspect): boolean => config.Gateway !== undefined,
  )?.Gateway;
  if (gateway === undefined) {
    throw new Error(`Missing docker network gateway for ${networkName}.`);
  }

  return gateway;
}

async function inspectDockerNetwork(networkName: string): Promise<DockerNetworkInspect> {
  const { stdout } = await runDockerCommand(['network', 'inspect', networkName]);
  const [network] = JSON.parse(stdout) as DockerNetworkInspect[];
  if (network === undefined) {
    throw new Error(`Missing docker network inspect result for ${networkName}.`);
  }

  return network;
}

function readPublishedPortBindings(container: DockerContainerInspect): { HostIp: string; HostPort: string }[] {
  return Object.values(container.NetworkSettings.Ports).flatMap(
    (bindings: { HostIp: string; HostPort: string }[] | null): { HostIp: string; HostPort: string }[] => bindings ?? [],
  );
}

async function installCurl(containerId: string): Promise<void> {
  await runDockerCommand(['exec', containerId, 'sh', '-lc', 'apk add --no-cache curl >/dev/null']);
}

async function expectContainerCurlFails(containerId: string, url: string): Promise<void> {
  await expect(
    runDockerCommand([
      'exec',
      containerId,
      'curl',
      '--connect-timeout',
      '2',
      '--max-time',
      '3',
      '--fail',
      '--silent',
      '--show-error',
      url,
    ]),
  ).rejects.toThrow();
}

async function safeSyncDockerNetworkEgressDenyRules(input: DockerNetworkEgressDenyCleanupInput): Promise<void> {
  try {
    await syncDockerNetworkEgressDenyRules(input);
  } catch {
    return;
  }
}

function canManageHostFirewallRules(): boolean {
  return process.platform === 'linux' && process.getuid?.() === 0;
}

function canInspectHostIpv4Routes(): boolean {
  try {
    execFileSync('ip', ['-4', 'route', 'show'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function buildIpv4Address(octets: readonly [number, number, number, number]): string {
  return octets.join('.');
}

function readServerPort(server: Server): number {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected mock API server to listen on a TCP port.');
  }

  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose: () => void, reject: (reason?: Error) => void): void => {
    server.close((error?: Error): void => {
      if (error === undefined) {
        resolveClose();
        return;
      }
      reject(error);
    });
  });
}

async function runDockerCommand(args: string[]): Promise<{ stderr: string; stdout: string }> {
  return await executeFileAsync('docker', args, {
    cwd: resolve(__dirname, '../../..'),
  });
}

async function pullDockerImageIfMissing(imageRef: string): Promise<void> {
  try {
    await runDockerCommand(['image', 'inspect', imageRef]);
    return;
  } catch {
    await runDockerCommand(['pull', imageRef]);
  }
}

async function safeDockerCommand(args: string[]): Promise<void> {
  try {
    await runDockerCommand(args);
  } catch {
    return;
  }
}

async function safeRemoveNamespaceVolumes(dockerNamespace: string): Promise<void> {
  try {
    const { stdout } = await runDockerCommand([
      'volume',
      'ls',
      '-q',
      '--filter',
      `label=${compartmentDockerNamespaceLabelName}=${dockerNamespace}`,
    ]);
    const volumeNames: string[] = stdout
      .trim()
      .split('\n')
      .filter((volumeName: string): boolean => volumeName !== '');
    for (const volumeName of volumeNames) {
      await safeDockerCommand(['volume', 'rm', volumeName]);
    }
  } catch {
    return;
  }
}
