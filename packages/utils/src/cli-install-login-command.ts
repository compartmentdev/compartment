import { quoteShellArgumentWhenNeeded } from './shell-argument';
import type { CliInstallLoginCommandInput } from './cli-install-login-command.types';

export type { CliInstallLoginCommandInput } from './cli-install-login-command.types';

const compartmentPublicInstallerUrl: string = 'https://compartment.dev/install.sh';
const localConsoleHostname: string = 'console.localhost';
const localCliApiHostname: string = '127.0.0.1';
const cliInstallLoginCommandPrefix: readonly string[] = [
  'curl',
  '-fsSL',
  compartmentPublicInstallerUrl,
  '|',
  'sh',
  '-s',
  '--',
  '--init-login',
];

export function buildCliInstallLoginCommand(input: CliInstallLoginCommandInput): string {
  const commandParts: string[] = [
    ...cliInstallLoginCommandPrefix,
    '--api-url',
    quoteShellArgumentWhenNeeded(input.apiUrl),
    '--email',
    quoteShellArgumentWhenNeeded(input.email),
    '--organization',
    quoteShellArgumentWhenNeeded(input.organizationSlug),
  ];

  if (input.onboardingSessionId !== undefined) {
    commandParts.push('--onboarding-session', quoteShellArgumentWhenNeeded(input.onboardingSessionId));
  }

  return commandParts.join(' ');
}

export function readCliInstallLoginApiUrl(consoleOrigin: string): string {
  try {
    const url: URL = new URL(consoleOrigin);
    if (url.hostname === localConsoleHostname) {
      return readLocalhostCliApiUrl(url);
    }
  } catch {
    return consoleOrigin;
  }

  return consoleOrigin;
}

function readLocalhostCliApiUrl(url: URL): string {
  const port: string = url.port === '' ? '' : `:${url.port}`;
  return `${url.protocol}//${localCliApiHostname}${port}`;
}
