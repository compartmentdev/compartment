import type { DomainHostPlan } from '@compartment/contracts';
import type { ManagedDomainInstallState } from './managed-domain.types';
import { assertManagedDomainTlsMetadata } from './managed-domain-validation';
import { assertRequiredDomainEnvironmentVariables } from './self-hosted-domain-environment-required-vars';
import {
  readSelfHostedEnvironmentAssignmentName,
  renderSelfHostedEnvironmentAssignment,
} from './self-hosted-env-assignment';
import { readSelfHostedEnvironmentValues, readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';
import {
  selfHostedCustomCertCaddyTlsMode,
  selfHostedCustomHttpCaddyTlsMode,
  selfHostedManagedAcmeCaUrl,
  selfHostedManagedCaddyTlsMode,
} from './self-hosted-domain-constants';
import { buildManagedSystemDomainHostPlan } from './system-domain-host-plan';
import type { SystemDomainRuntimeCertificateInput } from './system-domain.types';

interface DomainEnvironmentRenderInput {
  certificate?: SystemDomainRuntimeCertificateInput | undefined;
  hostPlan: DomainHostPlan;
  managedDomain?: ManagedDomainInstallState | undefined;
}

export function renderSelfHostedDomainEnvironment(
  environmentText: string,
  hostPlan: DomainHostPlan,
  certificate?: SystemDomainRuntimeCertificateInput,
): string {
  return renderSelfHostedDomainEnvironmentInput(environmentText, { certificate, hostPlan });
}

export function renderSelfHostedManagedDomainEnvironment(
  environmentText: string,
  managedDomain: ManagedDomainInstallState,
): string {
  return renderSelfHostedDomainEnvironmentInput(environmentText, {
    hostPlan: buildManagedSystemDomainHostPlan(managedDomain),
    managedDomain,
  });
}

function renderSelfHostedDomainEnvironmentInput(environmentText: string, input: DomainEnvironmentRenderInput): string {
  const currentValues: Record<string, string> = readSelfHostedEnvironmentValues(environmentText);
  assertSupportedRuntimeHostPlan(input);
  assertRequiredDomainEnvironmentVariables(currentValues);

  return environmentText
    .split('\n')
    .map((line: string): string => renderDomainEnvironmentLine(line, input, currentValues))
    .join('\n');
}

function assertSupportedRuntimeHostPlan(input: DomainEnvironmentRenderInput): void {
  const hostPlan: DomainHostPlan = input.hostPlan;
  if (hostPlan.domainKind === 'managed') {
    assertSupportedManagedRuntimeHostPlan(input);
    return;
  }
  if (hostPlan.domainKind === 'custom') {
    assertSupportedCustomRuntimeHostPlan(hostPlan);
    return;
  }

  throwUnsupportedRuntimeHostPlan();
}

function assertSupportedManagedRuntimeHostPlan(input: DomainEnvironmentRenderInput): void {
  const hostPlan: DomainHostPlan = input.hostPlan;
  if (
    hostPlan.tlsMode === 'broker-dns01' &&
    hostPlan.publicScheme === 'https' &&
    hostPlan.caddyMode === 'managed' &&
    input.managedDomain !== undefined
  ) {
    assertManagedDomainTlsMetadata(input.managedDomain);
    return;
  }

  throwUnsupportedRuntimeHostPlan();
}

function assertSupportedCustomRuntimeHostPlan(hostPlan: DomainHostPlan): void {
  switch (hostPlan.caddyMode) {
    case 'custom-http':
      if (hostPlan.tlsMode === 'external') {
        return;
      }
      break;
    case 'custom-cert':
      if (hostPlan.tlsMode === 'custom-cert' && hostPlan.publicScheme === 'https') {
        return;
      }
      break;
    case 'internal':
    case 'managed':
      break;
  }

  throwUnsupportedRuntimeHostPlan();
}

function renderDomainEnvironmentLine(
  line: string,
  input: DomainEnvironmentRenderInput,
  currentValues: Record<string, string>,
): string {
  const variableName: string | null = readSelfHostedEnvironmentAssignmentName(line);
  if (variableName === null) {
    return line;
  }

  const domainValue: string | null = readDomainEnvironmentValue(variableName, input, currentValues);
  return domainValue === null ? line : renderSelfHostedEnvironmentAssignment(variableName, domainValue);
}

function readDomainEnvironmentValue(
  variableName: string,
  input: DomainEnvironmentRenderInput,
  currentValues: Record<string, string>,
): string | null {
  const acmeValue: string | null = readAcmeEnvironmentValue(variableName, input, currentValues);
  if (acmeValue !== null) {
    return acmeValue;
  }

  const hostPlanValue: string | null = readHostPlanEnvironmentValue(variableName, input.hostPlan);
  if (hostPlanValue !== null) {
    return hostPlanValue;
  }

  return readCertificateEnvironmentValue(variableName, currentValues, input.certificate);
}

function readAcmeEnvironmentValue(
  variableName: string,
  input: DomainEnvironmentRenderInput,
  currentValues: Record<string, string>,
): string | null {
  switch (variableName) {
    case 'COMPARTMENT_ACME_CA_URL':
      return readAcmeCaUrl(input);
    case 'COMPARTMENT_ACME_EMAIL':
      return readAcmeEmailValue(input, currentValues);
    default:
      return null;
  }
}

function readAcmeCaUrl(input: DomainEnvironmentRenderInput): string {
  if (input.hostPlan.domainKind === 'managed') {
    return selfHostedManagedAcmeCaUrl;
  }
  if (input.hostPlan.domainKind === 'custom' && input.hostPlan.caddyMode === 'custom-cert') {
    return selfHostedManagedAcmeCaUrl;
  }

  return '';
}

function readAcmeEmailValue(input: DomainEnvironmentRenderInput, currentValues: Record<string, string>): string {
  if (input.hostPlan.domainKind === 'managed') {
    return input.managedDomain?.acmeEmail ?? '';
  }
  if (input.hostPlan.domainKind === 'custom' && input.hostPlan.caddyMode === 'custom-cert') {
    return readRequiredSelfHostedEnvironmentValue(currentValues, 'COMPARTMENT_ACME_EMAIL');
  }

  return '';
}

function readHostPlanEnvironmentValue(variableName: string, hostPlan: DomainHostPlan): string | null {
  switch (variableName) {
    case 'COMPARTMENT_BASE_DOMAIN':
      return hostPlan.baseDomain;
    case 'COMPARTMENT_CADDY_TLS_MODE':
      return readHostPlanCaddyTlsMode(hostPlan);
    case 'COMPARTMENT_PUBLIC_PROTOCOL':
      return hostPlan.publicScheme;
    default:
      return null;
  }
}

function readHostPlanCaddyTlsMode(hostPlan: DomainHostPlan): string {
  switch (hostPlan.caddyMode) {
    case 'custom-cert':
      return selfHostedCustomCertCaddyTlsMode;
    case 'custom-http':
      return selfHostedCustomHttpCaddyTlsMode;
    case 'managed':
      return selfHostedManagedCaddyTlsMode;
    case 'internal':
      throwUnsupportedRuntimeHostPlan();
  }
}

function readCertificateEnvironmentValue(
  variableName: string,
  currentValues: Record<string, string>,
  certificate: SystemDomainRuntimeCertificateInput | undefined,
): string | null {
  switch (variableName) {
    case 'COMPARTMENT_CUSTOM_TLS_CERT_FILE':
      return certificate?.certificatePath ?? readRequiredSelfHostedEnvironmentValue(currentValues, variableName);
    case 'COMPARTMENT_CUSTOM_TLS_KEY_FILE':
      return certificate?.privateKeyPath ?? readRequiredSelfHostedEnvironmentValue(currentValues, variableName);
    default:
      return null;
  }
}

function throwUnsupportedRuntimeHostPlan(): never {
  throw new Error('Only managed, custom external TLS, or custom certificate domains can be applied in this command.');
}
