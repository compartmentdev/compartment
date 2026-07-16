import type { InstallResponse } from '@compartment/contracts';
import { buildCompartmentBrowserEntryUrl } from '../../compartment-url';
import type { CliInstallResult } from '../../install.types';

export function toInstallResponse(result: CliInstallResult): InstallResponse {
  return {
    adminEmail: result.adminEmail,
    baseDomain: result.baseDomain,
    compartmentUrl: result.compartmentUrl,
    dnsRecords: result.dnsRecords,
    operation: result.operation,
    organization: result.organization,
    sessionToken: result.sessionToken,
  };
}

export function createInstallResultMessage(result: CliInstallResult, development: boolean): string {
  const installKind: string = development ? 'local development Compartment' : 'Compartment';
  const onboardingUrl: string = buildCompartmentBrowserEntryUrl(result.compartmentUrl, result.adminEmail, {
    startOnboarding: true,
  });

  return `Installed ${installKind} at ${result.compartmentUrl}. Logged in as ${result.adminEmail}.\nContinue setup: ${onboardingUrl}`;
}
