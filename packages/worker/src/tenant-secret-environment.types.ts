export interface TenantSecretsKeyring {
  current: Buffer;
  previous?: Buffer | undefined;
}
