export interface RegistryPullSecretProjectionRow {
  dockerConfigJson: string;
  namespaceId: string;
  secretId: string;
}

export interface SecretProjectionRow {
  data: Readonly<Record<string, string>>;
  deploymentId: string;
  namespaceId: string;
  secretId: string;
}
