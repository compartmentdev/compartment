import type { DockerRegistryCredentials } from '@compartment/docker';

export type RuntimeConnectivityMode = 'loopback' | 'network';

export interface RuntimeDeployConfig {
  appPortEnd: number;
  appPortStart: number;
  dockerNamespace: string;
  runtimeConnectivityMode: RuntimeConnectivityMode;
  runtimeDefaultUpstreamHost: string;
  runtimeRegistryCredentials: DockerRegistryCredentials;
  runtimeProbeImageRef: string;
}

export interface ResolvedRuntimeDeploymentContext {
  containerName: string;
  containerPort: number;
  dockerNamespace: string;
  networkAliases?: string[] | undefined;
  networkName?: string | undefined;
  publishedPort?: number | undefined;
  runtimeCommand?: string[] | undefined;
  runtimeEnv: Record<string, string>;
  upstreamHost: string;
  upstreamPort: number;
}
