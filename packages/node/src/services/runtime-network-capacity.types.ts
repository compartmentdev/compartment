import type { RuntimeConnectivityMode, RuntimeNetworkPoolConfig } from './runtime.types';

export type RuntimeNetworkKind = 'resource' | 'service';

export interface RuntimeNetworkSpec {
  environmentId: string;
  kind: RuntimeNetworkKind;
  networkName: string;
  projectId: string;
  serviceId?: string | undefined;
}

export interface RuntimeNetworkCreateInput {
  reservationId?: string | undefined;
  reservationExpiresAt?: string | undefined;
  spec: RuntimeNetworkSpec;
}

export interface RuntimeNetworkCapacityConfig {
  dockerNamespace: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
  runtimeNetworkPool: RuntimeNetworkPoolConfig;
}
