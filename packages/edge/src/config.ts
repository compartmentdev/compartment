import { buildControlPlaneHost } from '@compartment/contracts';
import { buildInternalHttpUrl } from '@compartment/utils';
import { z } from 'zod';

interface EdgeConfigEnvironment {
  COMPARTMENT_API_INTERNAL_HOST: string;
  COMPARTMENT_API_PORT: number;
  COMPARTMENT_BASE_DOMAIN: string;
  COMPARTMENT_EDGE_BIND_HOST: string;
  COMPARTMENT_EDGE_INTERNAL_HOST: string;
  COMPARTMENT_EDGE_PORT: number;
  COMPARTMENT_EDGE_TOKEN: string;
  COMPARTMENT_LOG_LEVEL: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  COMPARTMENT_PUBLIC_PROTOCOL: 'http' | 'https';
  // SPIKE-T7: throwaway persisted last-known-good configuration.
  COMPARTMENT_EDGE_SNAPSHOT_MAX_AGE_MS: number;
  COMPARTMENT_EDGE_SNAPSHOT_PATH: string;
}

const edgeConfigSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_API_INTERNAL_HOST: z.string().min(1),
  COMPARTMENT_API_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_BASE_DOMAIN: z.string().min(1),
  COMPARTMENT_EDGE_BIND_HOST: z.string().min(1),
  COMPARTMENT_EDGE_INTERNAL_HOST: z.string().min(1),
  COMPARTMENT_EDGE_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_EDGE_TOKEN: z.string().min(1),
  COMPARTMENT_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  COMPARTMENT_PUBLIC_PROTOCOL: z.enum(['http', 'https']),
  // SPIKE-T7: 24h bounds stale authorization exposure during a control-plane outage.
  COMPARTMENT_EDGE_SNAPSHOT_MAX_AGE_MS: z.coerce.number().int().positive().default(86_400_000),
  COMPARTMENT_EDGE_SNAPSHOT_PATH: z.string().min(1).default('/var/lib/compartment-edge/access-state.json'),
});

export interface EdgeConfig {
  apiUrl: string;
  bindHost: string;
  edgeToken: string;
  internalHost: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  port: number;
  controlPlaneHost: string;
  publicProtocol: 'http' | 'https';
  // SPIKE-T7: prototype-only local persistence settings.
  snapshotMaxAgeMs: number;
  snapshotPath: string;
}

export function readEdgeConfig(env: NodeJS.ProcessEnv = process.env): EdgeConfig {
  const parsed: EdgeConfigEnvironment = edgeConfigSchema.parse(env) as EdgeConfigEnvironment;

  return {
    apiUrl: buildInternalHttpUrl(parsed.COMPARTMENT_API_INTERNAL_HOST, parsed.COMPARTMENT_API_PORT),
    bindHost: parsed.COMPARTMENT_EDGE_BIND_HOST,
    edgeToken: parsed.COMPARTMENT_EDGE_TOKEN,
    internalHost: parsed.COMPARTMENT_EDGE_INTERNAL_HOST,
    logLevel: parsed.COMPARTMENT_LOG_LEVEL,
    port: parsed.COMPARTMENT_EDGE_PORT,
    controlPlaneHost: buildControlPlaneHost(parsed.COMPARTMENT_BASE_DOMAIN.trim().toLowerCase()),
    publicProtocol: parsed.COMPARTMENT_PUBLIC_PROTOCOL,
    snapshotMaxAgeMs: parsed.COMPARTMENT_EDGE_SNAPSHOT_MAX_AGE_MS,
    snapshotPath: parsed.COMPARTMENT_EDGE_SNAPSHOT_PATH,
  };
}
