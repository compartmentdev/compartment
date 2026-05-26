import {
  buildCliInstallLoginCommand,
  quoteShellArgumentWhenNeeded,
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
  return buildCliInstallLoginCommand(readCliInstallLoginCommandInput(input));
}

export function readCliLoginCommand(input: CliInstallerLoginCommandInput): string {
  const commandInput: CliInstallLoginCommandInput = readCliInstallLoginCommandInput(input);

  return [
    'compartment',
    'login',
    '--api-url',
    quoteShellArgumentWhenNeeded(commandInput.apiUrl),
    '--email',
    quoteShellArgumentWhenNeeded(commandInput.email),
    '--organization',
    quoteShellArgumentWhenNeeded(commandInput.organizationSlug),
    '--onboarding-session',
    quoteShellArgumentWhenNeeded(input.sessionId),
  ].join(' ');
}

function readCliInstallLoginCommandInput(input: CliInstallerLoginCommandInput): CliInstallLoginCommandInput {
  const commandInput: CliInstallLoginCommandInput = {
    apiUrl: readCliInstallLoginApiUrl(input.consoleOrigin),
    email: input.principalEmail,
    onboardingSessionId: input.sessionId,
    organizationSlug: input.selectedOrganizationSlug,
  };

  return commandInput;
}
