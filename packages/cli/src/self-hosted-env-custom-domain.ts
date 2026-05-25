import { selfHostedCustomTlsDirectory } from './self-hosted-domain-constants';

export function buildCustomTlsOverrides(): Record<string, string> {
  return {
    COMPARTMENT_CUSTOM_TLS_CERT_FILE: `${selfHostedCustomTlsDirectory}/fullchain.pem`,
    COMPARTMENT_CUSTOM_TLS_DIR: selfHostedCustomTlsDirectory,
    COMPARTMENT_CUSTOM_TLS_KEY_FILE: `${selfHostedCustomTlsDirectory}/privkey.pem`,
  };
}
