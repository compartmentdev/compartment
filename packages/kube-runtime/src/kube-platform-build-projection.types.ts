export interface PlatformBuildProjectionInput {
  buildkitImage: string;
  dnsNamespaceSelector: Readonly<Record<string, string>>;
  dnsPodSelector: Readonly<Record<string, string>>;
  internetEgress: PlatformInternetEgressProjection;
  platformId: string;
  registry: PlatformRegistryProjection;
  workerNamespaceSelector: Readonly<Record<string, string>>;
  workerPodSelector: Readonly<Record<string, string>>;
}

export interface PlatformInternetEgressProjection {
  podCidr: string;
  serviceCidr: string;
}

export type PlatformRegistryProjection = BundledPlatformRegistryProjection | ExternalPlatformRegistryProjection;

export interface BundledPlatformRegistryProjection {
  credentials: PlatformRegistryCredentials;
  image: string;
  mode: 'bundled';
  secretId: string;
}

export interface ExternalPlatformRegistryProjection {
  credentials: PlatformRegistryPullCredentials;
  endpoint: string;
  egressCidr: string;
  port: number;
  mode: 'external';
}

export interface PlatformRegistryCredentials extends PlatformRegistryPullCredentials {
  htpasswd: string;
}

export interface PlatformRegistryPullCredentials {
  dockerConfigJson: string;
  secretId: string;
}
