import { readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';

export function assertRequiredDomainEnvironmentVariables(currentValues: Record<string, string>): void {
  for (const variableName of ['COMPARTMENT_ACME_CA_URL', 'COMPARTMENT_ACME_EMAIL']) {
    assertEnvironmentVariableExists(currentValues, variableName);
  }

  const requiredTextVariableNames: string[] = [
    'COMPARTMENT_BASE_DOMAIN',
    'COMPARTMENT_CADDY_TLS_MODE',
    'COMPARTMENT_PUBLIC_PROTOCOL',
    'COMPARTMENT_CUSTOM_TLS_CERT_FILE',
    'COMPARTMENT_CUSTOM_TLS_KEY_FILE',
  ];

  for (const variableName of requiredTextVariableNames) {
    readRequiredSelfHostedEnvironmentValue(currentValues, variableName);
  }
}

function assertEnvironmentVariableExists(currentValues: Record<string, string>, variableName: string): void {
  if (currentValues[variableName] !== undefined) {
    return;
  }

  throw new Error(`The self-hosted environment is missing ${variableName}.`);
}
