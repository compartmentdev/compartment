import {
  readRequiredSelfHostedEnvironmentRawValue,
  readRequiredSelfHostedEnvironmentValue,
} from './self-hosted-env-file';

const currentValuePreservedCanonicalVariables: string[] = [
  'COMPARTMENT_ROLLBACK_RETENTION_LIMIT',
  'COMPARTMENT_AUDIT_FILE_SINK_ENABLED',
  'COMPARTMENT_AUDIT_FILE_SINK_DIR',
  'COMPARTMENT_AUDIT_FILE_SINK_ROTATE_INTERVAL',
  'COMPARTMENT_AUDIT_FILE_SINK_ROTATE_SIZE',
  'COMPARTMENT_AUDIT_FILE_SINK_RETENTION_FILES',
  'COMPARTMENT_AUDIT_RETENTION_DAYS',
  'COMPARTMENT_AUDIT_RETENTION_CLEANUP_CRON',
  'COMPARTMENT_AUDIT_RETENTION_CLEANUP_BATCH_SIZE',
  'COMPARTMENT_AUDIT_RETENTION_CLEANUP_MAX_BATCHES',
];

export function readUpdatedCanonicalOverrides(
  currentValues: Record<string, string>,
  canonicalOverrides: Record<string, string>,
): Record<string, string> {
  const brokerEnvOverrides: Record<string, string> = readCurrentBrokerEnvOverrides(currentValues);
  const updatedCanonicalOverrides: Record<string, string> = {
    ...canonicalOverrides,
    ...readCurrentDomainOverrides(currentValues),
    ...brokerEnvOverrides,
  };
  if (brokerEnvOverrides.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL === undefined) {
    delete updatedCanonicalOverrides.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL;
  }
  if (brokerEnvOverrides.COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN === undefined) {
    delete updatedCanonicalOverrides.COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN;
  }

  readRequiredSelfHostedEnvironmentValue(currentValues, 'COMPARTMENT_DOCKER_NAMESPACE');
  delete updatedCanonicalOverrides.COMPARTMENT_DOCKER_NAMESPACE;
  for (const variableName of currentValuePreservedCanonicalVariables) {
    deleteCanonicalOverrideWhenCurrentValueExists(updatedCanonicalOverrides, currentValues, variableName);
  }

  return updatedCanonicalOverrides;
}

function readCurrentDomainOverrides(currentValues: Record<string, string>): Record<string, string> {
  const baseDomain: string = readRequiredSelfHostedEnvironmentValue(currentValues, 'COMPARTMENT_BASE_DOMAIN');
  const caddyTlsMode: string = readRequiredSelfHostedEnvironmentValue(currentValues, 'COMPARTMENT_CADDY_TLS_MODE');
  const publicProtocol: string = readRequiredSelfHostedEnvironmentValue(currentValues, 'COMPARTMENT_PUBLIC_PROTOCOL');

  return {
    COMPARTMENT_ACME_CA_URL: readRequiredSelfHostedEnvironmentRawValue(currentValues, 'COMPARTMENT_ACME_CA_URL'),
    COMPARTMENT_ACME_EMAIL: readRequiredSelfHostedEnvironmentRawValue(currentValues, 'COMPARTMENT_ACME_EMAIL'),
    COMPARTMENT_BASE_DOMAIN: baseDomain,
    COMPARTMENT_CADDY_TLS_MODE: caddyTlsMode,
    COMPARTMENT_CUSTOM_TLS_CERT_FILE: readRequiredSelfHostedEnvironmentValue(
      currentValues,
      'COMPARTMENT_CUSTOM_TLS_CERT_FILE',
    ),
    COMPARTMENT_CUSTOM_TLS_DIR: readRequiredSelfHostedEnvironmentValue(currentValues, 'COMPARTMENT_CUSTOM_TLS_DIR'),
    COMPARTMENT_CUSTOM_TLS_KEY_FILE: readRequiredSelfHostedEnvironmentValue(
      currentValues,
      'COMPARTMENT_CUSTOM_TLS_KEY_FILE',
    ),
    COMPARTMENT_PUBLIC_PROTOCOL: publicProtocol,
  };
}

function readCurrentBrokerEnvOverrides(currentValues: Record<string, string>): Record<string, string> {
  const overrides: Record<string, string> = {};
  const brokerUrl: string = readRequiredSelfHostedEnvironmentRawValue(
    currentValues,
    'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL',
  );
  const brokerToken: string = readRequiredSelfHostedEnvironmentRawValue(
    currentValues,
    'COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN',
  );

  if (brokerUrl.trim() !== '') {
    overrides.COMPARTMENT_MANAGED_DOMAIN_BROKER_URL = brokerUrl;
  }
  if (brokerToken.trim() !== '') {
    overrides.COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN = brokerToken;
  }

  return overrides;
}

function deleteCanonicalOverrideWhenCurrentValueExists(
  updatedCanonicalOverrides: Record<string, string>,
  currentValues: Record<string, string>,
  variableName: string,
): void {
  if (currentValues[variableName] !== undefined) {
    delete updatedCanonicalOverrides[variableName];
  }
}
