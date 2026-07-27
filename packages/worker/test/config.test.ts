import { describe, expect, it } from 'vitest';
import { readWorkerConfig, type WorkerConfig } from '../src/config';

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
    expect(config.buildKitAddress).toBe('tcp://builder:1234');
    expect(config.pollIntervalMs).toBe(1000);
    expect(config.runtimeControlToken).toBe('runtime-control-token');
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

  it('rejects missing required runtime env values instead of silently falling back', (): void => {
    expect((): WorkerConfig => {
      return readWorkerConfig({
        COMPARTMENT_API_PORT: '9443',
        COMPARTMENT_LOG_LEVEL: 'info',
        COMPARTMENT_WORKER_POLL_INTERVAL_MS: '1000',
        COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
      });
    }).toThrow();
  });
});

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    BUILDKIT_ADDR: 'tcp://builder:1234',
    COMPARTMENT_API_INTERNAL_HOST: '127.0.0.1',
    COMPARTMENT_API_PORT: '9443',
    COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: 'registry-signing-key-with-at-least-32-characters',
    COMPARTMENT_ARTIFACT_REGISTRY_HOST: 'registry.apps.example.com',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_HOST: 'registry.apps.example.com:443',
    COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: 'https://registry.apps.example.com',
    COMPARTMENT_ARTIFACT_REGISTRY_PORT: '443',
    COMPARTMENT_LOG_LEVEL: 'info',
    COMPARTMENT_WORKER_POLL_INTERVAL_MS: '1000',
    COMPARTMENT_RUNTIME_CONTROL_TOKEN: 'runtime-control-token',
    COMPARTMENT_TRUSTED_OUTBOUND_HOSTS: 'github.enterprise.example, idp.example.com:8443, idp.example.com:443',
  };
}
