export interface RegistryAuthProxyConfig {
  bindHost: string;
  buildKitSeedCacheRepository: string;
  buildKitSeedCacheTargetUrl: URL;
  credentialSigningKey: string;
  internalPort?: number | undefined;
  port: number;
  targetUrl: URL;
  tlsCertificateFile?: string | undefined;
  tlsPrivateKeyFile?: string | undefined;
}

export interface RegistryAuthProxyEnvironment {
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_INTERNAL_PORT?: number | undefined;
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL: string;
  COMPARTMENT_ARTIFACT_REGISTRY_TLS_CERTIFICATE_FILE?: string | undefined;
  COMPARTMENT_ARTIFACT_REGISTRY_TLS_PRIVATE_KEY_FILE?: string | undefined;
  COMPARTMENT_BUILDKIT_SEED_CACHE_PROXY_TARGET_URL: string;
  COMPARTMENT_BUILDKIT_SEED_CACHE_REPOSITORY: string;
}
