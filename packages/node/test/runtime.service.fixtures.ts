import type {
  NodeDeployRequest,
  ResolvedCompartmentServiceRunConfig,
  ResolvedServiceReadinessConfig,
} from '@compartment/contracts';
import type { DockerRegistryCredentials } from '@compartment/docker';
import type { NodeConfig } from '../src/config';
import type { RuntimeDeployConfig } from '../src/services/runtime.types';
import { createRuntimeNetworkPoolConfig } from './runtime-network-pool.fixture';

export function createReadiness(): ResolvedServiceReadinessConfig {
  return {
    path: '/healthz',
    timeoutMs: 30000,
    type: 'http',
  };
}

export function createRun(
  overrides: Partial<ResolvedCompartmentServiceRunConfig> = {},
): ResolvedCompartmentServiceRunConfig {
  return {
    restart: {
      policy: 'on-failure',
    },
    ...overrides,
  };
}

export function createDeployRequest(overrides: Partial<NodeDeployRequest> = {}): NodeDeployRequest {
  return {
    deploymentId: 'dep_123456',
    environmentId: 'env_production',
    environmentName: 'production',
    imageRef: 'sha256:image',
    projectId: 'prj_smoke_web',
    projectName: 'smoke-web',
    readiness: createReadiness(),
    run: createRun(),
    routeHost: 'smoke-web.localhost',
    runtimeNetwork: {
      requiresResourceNetwork: false,
    },
    runtimeEnv: {},
    serviceId: 'svc_web',
    serviceName: 'web',
    ...overrides,
  };
}

export function createNodeConfig(overrides: Partial<NodeConfig> = {}): NodeConfig {
  return {
    apiUrl: 'http://127.0.0.1:9443',
    appPortEnd: 31999,
    appPortStart: 31000,
    dockerNamespace: 'compartment-e2e',
    logLevel: 'silent',
    name: 'local-node',
    nodeSocketPath: '/tmp/compartment/node-test/node/runtime.sock',
    resourceBackupDirectory: '/var/lib/compartment/resource-backups',
    runtimeConnectivityMode: 'loopback',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
    runtimeRegistryCredentials: createRuntimeRegistryCredentials(),
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    version: '0.1.0',
    runtimeControlToken: 'test-runtime-control-token',
    ...overrides,
  };
}

export function createRuntimeDeployConfig(overrides: Partial<RuntimeDeployConfig> = {}): RuntimeDeployConfig {
  return {
    appPortEnd: 31010,
    appPortStart: 31000,
    dockerNamespace: 'compartment-e2e',
    runtimeConnectivityMode: 'loopback',
    runtimeDefaultUpstreamHost: '127.0.0.1',
    runtimeNetworkPool: createRuntimeNetworkPoolConfig(),
    runtimeRegistryCredentials: createRuntimeRegistryCredentials(),
    runtimeProbeImageRef: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    ...overrides,
  };
}

function createRuntimeRegistryCredentials(): DockerRegistryCredentials {
  return {
    password: ['registry', 'read', 'secret'].join('-'),
    serverAddress: '127.0.0.1:39461',
    username: 'registry-reader',
  };
}
