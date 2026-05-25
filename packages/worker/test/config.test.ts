import { describe, expect, it } from 'vitest';
import { readWorkerConfig, type WorkerConfig } from '../src/config';

describe('readWorkerConfig', (): void => {
  it('reads the required worker runtime config from env', (): void => {
    const config: WorkerConfig = readWorkerConfig({
      BUILDKIT_ADDR: 'tcp://builder:1234',
      COMPARTMENT_API_INTERNAL_HOST: '127.0.0.1',
      COMPARTMENT_API_PORT: '9443',
      COMPARTMENT_ARTIFACT_REGISTRY_HOST: '127.0.0.1',
      COMPARTMENT_ARTIFACT_REGISTRY_PORT: '5517',
      COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: 'registry',
      COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_PORT: '5000',
      COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: 'read-password',
      COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: 'reader',
      COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD: 'write-password',
      COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME: 'writer',
      COMPARTMENT_DOCKER_NAMESPACE: 'compartment-local',
      COMPARTMENT_LOG_LEVEL: 'info',
      COMPARTMENT_WORKER_POLL_INTERVAL_MS: '1000',
      COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
      COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: 'github.enterprise.example, idp.example.com:8443, idp.example.com:443',
    });

    expect(config.apiUrl).toBe('http://127.0.0.1:9443');
    expect(config.artifactRegistry.address).toBe('127.0.0.1:5517');
    expect(config.artifactRegistry.internalUrl).toBe('http://registry:5000');
    expect(config.artifactRegistry.readCredentials).toEqual({ password: 'read-password', username: 'reader' });
    expect(config.artifactRegistry.writeCredentials).toEqual({ password: 'write-password', username: 'writer' });
    expect(config.buildKitAddress).toBe('tcp://builder:1234');
    expect(config.pollIntervalMs).toBe(1000);
    expect(config.runtimeControlToken).toBe('runtime-control-token');
  });

  it('rejects unsafe worker trusted outbound host entries', (): void => {
    expect((): WorkerConfig => {
      return readWorkerConfig({
        BUILDKIT_ADDR: 'tcp://builder:1234',
        COMPARTMENT_API_INTERNAL_HOST: '127.0.0.1',
        COMPARTMENT_API_PORT: '9443',
        COMPARTMENT_ARTIFACT_REGISTRY_HOST: '127.0.0.1',
        COMPARTMENT_ARTIFACT_REGISTRY_PORT: '5517',
        COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: 'registry',
        COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_PORT: '5000',
        COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: 'read-password',
        COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: 'reader',
        COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD: 'write-password',
        COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME: 'writer',
        COMPARTMENT_DOCKER_NAMESPACE: 'compartment-local',
        COMPARTMENT_LOG_LEVEL: 'info',
        COMPARTMENT_WORKER_POLL_INTERVAL_MS: '1000',
        COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
        COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: 'https://github.enterprise.example',
      });
    }).toThrow('COMPARTMENT_TRUSTED_OUTBOUND_HOSTS must be empty or a comma-separated list');
  });

  it('rejects missing required runtime env values instead of silently falling back', (): void => {
    expect((): WorkerConfig => {
      return readWorkerConfig({
        COMPARTMENT_API_PORT: '9443',
        COMPARTMENT_DOCKER_NAMESPACE: 'compartment-local',
        COMPARTMENT_LOG_LEVEL: 'info',
        COMPARTMENT_WORKER_POLL_INTERVAL_MS: '1000',
        COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
      });
    }).toThrow();
  });
});
