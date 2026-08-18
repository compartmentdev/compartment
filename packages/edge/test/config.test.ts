import { describe, expect, it } from 'vitest';
import { readEdgeConfig, type EdgeConfig } from '../src/config';

describe('readEdgeConfig', (): void => {
  it('reads the required edge runtime config from internal env values', (): void => {
    const config: EdgeConfig = readEdgeConfig({
      COMPARTMENT_API_INTERNAL_HOST: '127.0.0.1',
      COMPARTMENT_API_PORT: '9443',
      COMPARTMENT_BASE_DOMAIN: 'localhost',
      COMPARTMENT_EDGE_BIND_HOST: '127.0.0.1',
      COMPARTMENT_EDGE_INTERNAL_HOST: '127.0.0.1',
      COMPARTMENT_EDGE_PORT: '39548',
      COMPARTMENT_EDGE_REPLICA_COUNT: '2',
      COMPARTMENT_EDGE_SNAPSHOT_PATH: '/tmp/edge-snapshot.json',
      COMPARTMENT_EDGE_TOKEN: 'edge-token',
      COMPARTMENT_LOG_LEVEL: 'info',
      COMPARTMENT_EDGE_METRICS_PORT: '9466',
      COMPARTMENT_PUBLIC_PROTOCOL: 'http',
    });

    expect(config.apiUrl).toBe('http://127.0.0.1:9443');
    expect(config.bindHost).toBe('127.0.0.1');
    expect(config.controlPlaneHost).toBe('console.localhost');
    expect(config.internalHost).toBe('127.0.0.1');
    expect(config.metricsPort).toBe(9466);
    expect(config.port).toBe(39548);
    expect(config.publicProtocol).toBe('http');
    expect(config.replicaCount).toBe(2);
    expect(config.snapshotMaxAgeMs).toBe(86_400_000);
    expect(config.snapshotPath).toBe('/tmp/edge-snapshot.json');
  });

  it('rejects missing required runtime env values instead of silently falling back', (): void => {
    expect((): EdgeConfig => {
      return readEdgeConfig({
        COMPARTMENT_API_PORT: '9443',
        COMPARTMENT_EDGE_BIND_HOST: '127.0.0.1',
        COMPARTMENT_EDGE_INTERNAL_HOST: '127.0.0.1',
        COMPARTMENT_EDGE_PORT: '39548',
        COMPARTMENT_EDGE_SNAPSHOT_PATH: '/tmp/edge-snapshot.json',
        COMPARTMENT_EDGE_TOKEN: 'edge-token',
        COMPARTMENT_LOG_LEVEL: 'info',
      });
    }).toThrow();
  });
});
