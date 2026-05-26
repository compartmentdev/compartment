import { describe, expect, it } from 'vitest';
import { readNodeConfig, type NodeConfig } from '../src/config';

describe('readNodeConfig', (): void => {
  it('reads the required node runtime config from env', (): void => {
    const config: NodeConfig = readNodeConfig({
      COMPARTMENT_API_URL: 'http://127.0.0.1:9443',
      COMPARTMENT_ARTIFACT_REGISTRY_HOST: '127.0.0.1',
      COMPARTMENT_ARTIFACT_REGISTRY_PORT: '5000',
      COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: 'registry-read-password',
      COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: 'registry-read',
      COMPARTMENT_DOCKER_NAMESPACE: 'compartment-local',
      COMPARTMENT_LOG_LEVEL: 'info',
      COMPARTMENT_NODE_APP_PORT_END: '31999',
      COMPARTMENT_NODE_APP_PORT_START: '31000',
      COMPARTMENT_NODE_AGENT_SOCKET: '/tmp/compartment/node-test/node/agent.sock',
      COMPARTMENT_NODE_NAME: 'local-node',
      COMPARTMENT_NODE_VERSION: '0.1.0',
      COMPARTMENT_RESOURCE_BACKUP_DIR: '/var/lib/compartment/resource-backups',
      COMPARTMENT_RUNTIME_CONNECTIVITY_MODE: 'loopback',
      COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: '127.0.0.1',
      COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
      COMPARTMENT_RUNTIME_PROBE_IMAGE: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
    });

    expect(config.apiUrl).toBe('http://127.0.0.1:9443');
    expect(config.runtimeProbeImageRef).toBe('ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0');
    expect(config.nodeSocketPath).toBe('/tmp/compartment/node-test/node/agent.sock');
    expect(config.resourceBackupDirectory).toBe('/var/lib/compartment/resource-backups');
    expect(config.runtimeRegistryCredentials).toEqual({
      password: 'registry-read-password',
      serverAddress: '127.0.0.1:5000',
      username: 'registry-read',
    });
    expect(config.runtimeConnectivityMode).toBe('loopback');
    expect(config.runtimeDefaultUpstreamHost).toBe('127.0.0.1');
  });

  it('does not read the API image as node runtime config', (): void => {
    const config: NodeConfig = readNodeConfig({
      ...createNodeConfigEnv(),
      COMPARTMENT_API_IMAGE: 'ghcr.io/compartmentdev/compartment-api:0.1.0',
    });

    expect(config.runtimeProbeImageRef).toBe('ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0');
  });

  it('rejects missing runtime probe image config', (): void => {
    const env: NodeJS.ProcessEnv = createNodeConfigEnv();
    delete env.COMPARTMENT_RUNTIME_PROBE_IMAGE;

    expect((): NodeConfig => readNodeConfig(env)).toThrow();
  });

  it('rejects missing required runtime env values instead of silently falling back', (): void => {
    expect((): NodeConfig => {
      return readNodeConfig({
        COMPARTMENT_DOCKER_NAMESPACE: 'compartment-local',
        COMPARTMENT_LOG_LEVEL: 'info',
        COMPARTMENT_NODE_APP_PORT_END: '31999',
        COMPARTMENT_NODE_APP_PORT_START: '31000',
        COMPARTMENT_NODE_AGENT_SOCKET: '/tmp/compartment/node-test/node/agent.sock',
        COMPARTMENT_NODE_NAME: 'local-node',
        COMPARTMENT_NODE_VERSION: '0.1.0',
        COMPARTMENT_RESOURCE_BACKUP_DIR: '/var/lib/compartment/resource-backups',
        COMPARTMENT_RUNTIME_CONNECTIVITY_MODE: 'loopback',
        COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: '127.0.0.1',
        COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
      });
    }).toThrow();
  });

  it('rejects relative node agent socket paths', (): void => {
    expect((): NodeConfig => {
      return readNodeConfig({
        ...createNodeConfigEnv(),
        COMPARTMENT_NODE_AGENT_SOCKET: 'compartment/node/agent.sock',
      });
    }).toThrow('COMPARTMENT_NODE_AGENT_SOCKET must be an absolute socket path.');
  });

  it('rejects relative resource backup directories', (): void => {
    expect((): NodeConfig => {
      return readNodeConfig({
        ...createNodeConfigEnv(),
        COMPARTMENT_RESOURCE_BACKUP_DIR: '.compartment/resource-backups',
      });
    }).toThrow('COMPARTMENT_RESOURCE_BACKUP_DIR must be an absolute path.');
  });
});

function createNodeConfigEnv(): NodeJS.ProcessEnv {
  return {
    COMPARTMENT_API_URL: 'http://127.0.0.1:9443',
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: '127.0.0.1',
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: '5000',
    COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: 'registry-read-password',
    COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: 'registry-read',
    COMPARTMENT_DOCKER_NAMESPACE: 'compartment-local',
    COMPARTMENT_LOG_LEVEL: 'info',
    COMPARTMENT_NODE_APP_PORT_END: '31999',
    COMPARTMENT_NODE_APP_PORT_START: '31000',
    COMPARTMENT_NODE_AGENT_SOCKET: '/tmp/compartment/node-test/node/agent.sock',
    COMPARTMENT_NODE_NAME: 'local-node',
    COMPARTMENT_NODE_VERSION: '0.1.0',
    COMPARTMENT_RESOURCE_BACKUP_DIR: '/var/lib/compartment/resource-backups',
    COMPARTMENT_RUNTIME_CONNECTIVITY_MODE: 'loopback',
    COMPARTMENT_RUNTIME_DEFAULT_UPSTREAM_HOST: '127.0.0.1',
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
    COMPARTMENT_RUNTIME_PROBE_IMAGE: 'ghcr.io/compartmentdev/compartment-runtime-probe:0.1.0',
  };
}
