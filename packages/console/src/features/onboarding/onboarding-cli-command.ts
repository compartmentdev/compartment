import {
  buildCliInstallLoginCommand,
  readCliInstallLoginApiUrl,
  type CliInstallLoginCommandInput,
} from '@compartment/utils';

interface CliInstallerLoginCommandInput {
  consoleOrigin: string;
  principalEmail: string;
  selectedOrganizationSlug: string;
  sessionId: string;
}

export function readCliInstallerLoginCommand(input: CliInstallerLoginCommandInput): string {
  const commandInput: CliInstallLoginCommandInput = {
    apiUrl: readCliInstallLoginApiUrl(input.consoleOrigin),
    email: input.principalEmail,
    onboardingSessionId: input.sessionId,
    organizationSlug: input.selectedOrganizationSlug,
  };

  return buildCliInstallLoginCommand(commandInput);
}
