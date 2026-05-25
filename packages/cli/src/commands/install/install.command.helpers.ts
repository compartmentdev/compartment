import { installResponseSchema, type InstallResponse } from '@compartment/contracts';
import {
  buildCliInstallLoginCommand,
  quoteShellArgumentWhenNeeded,
  type CliInstallLoginCommandInput,
  type JsonValue,
} from '@compartment/utils';
import type { SelfHostedInstallPreflightOptions, SelfHostedInstallResult } from '../../install.types';
import { buildCompartmentBrowserEntryUrl } from '../../compartment-url';
import { readJsonRecord, readRequiredString, type JsonRecord } from '../../json.helpers';
import { parsePort } from '../../prompts/prompt.validation';
import { formatTerminalBold } from '../terminal-style.helpers';
import type { InstallVersionSelection } from './install.command.options';

export const defaultPublicHttpPort: number = 80;
export const defaultPublicHttpsPort: number = 443;

const installResultLogo: string = `⠀⠀⠀⣠⣴⡆⣶⣦⣄⠠⣴⣾⣷⣦⠄⠀⠀⠀
⠀⠀⠀⣿⡿⠃⠻⢿⣿⠀⠀⠉⣫⣶⣿⠀⠀⠀
⠀⢀⣤⣄⡀⠀⠀⢀⣠⣄⡀⠀⢿⠿⠋⢠⡀⠀
⣬⣛⠿⠿⠛⠁⣬⣛⠿⠿⣛⣥⠀⠀⠀⢸⣿⣷    Welcome to Compartment
⢿⣿⡇⠀⠀⠀⢿⣿⣷⣾⣿⡿⢀⣤⣶⣶⣭⡛
⠀⠈⠃⣠⣶⣷⠀⠈⠉⠉⠁⠀⠀⠈⠙⠛⠁⠀
⠀⠀⠀⣿⠿⣫⣀⠀⠀⣿⣷⣦⢠⣾⣿⠀⠀⠀
⠀⠀⠀⠐⠻⢿⡿⠟⠂⠙⠻⠿⠸⠟⠋⠀⠀⠀`;

export function createSelfHostedInstallResultMessage(
  result: SelfHostedInstallResult,
  sessionPersisted: boolean,
  useTerminalStyles: boolean,
): string {
  const sessionMessage: string = sessionPersisted
    ? `Logged in as ${result.adminEmail}`
    : `Initial admin created as ${result.adminEmail}`;
  const localLoginCommand: string = createLocalLoginCommand(result);

  return `
${installResultLogo}

Installed on this server:
  Config: ${result.configDir}
  Data: ${result.dataDir}
  CLI session: ${sessionMessage}.

${formatTerminalBold('Continue setup here:', useTerminalStyles)}
  ${buildCompartmentBrowserEntryUrl(result.compartmentUrl, result.adminEmail, { startOnboarding: true })}

Alternatively, install the CLI on this server and log in to this runtime:
  ${localLoginCommand}

  If the CLI is already installed:
  ${createCliLoginCommand(result)}`;
}

export function toInstallResponse(result: SelfHostedInstallResult): InstallResponse {
  return {
    adminEmail: result.adminEmail,
    baseDomain: result.baseDomain,
    dnsRecords: result.dnsRecords,
    operation: result.operation,
    organization: result.organization,
    compartmentUrl: result.compartmentUrl,
    sessionToken: result.sessionToken,
  };
}

export function parseSelfHostedInstallResultJson(output: string): SelfHostedInstallResult {
  const parsed: JsonValue = parseJsonObject(output);
  const record: JsonRecord = readJsonRecord(parsed, 'Sudo install result');
  const response: InstallResponse = installResponseSchema.parse({
    adminEmail: record.adminEmail,
    baseDomain: record.baseDomain,
    dnsRecords: record.dnsRecords,
    operation: record.operation,
    organization: record.organization,
    compartmentUrl: record.compartmentUrl,
    sessionToken: record.sessionToken,
  });

  return {
    ...response,
    apiUrl: readRequiredString(record, 'apiUrl', 'Sudo install result'),
    baseDomain: readRequiredString(record, 'baseDomain', 'Sudo install result'),
    configDir: readRequiredString(record, 'configDir', 'Sudo install result'),
    dataDir: readRequiredString(record, 'dataDir', 'Sudo install result'),
  };
}

export function readInstallPublicPortOption(value: string | undefined, label: string, defaultPort: number): number {
  if (value === undefined) {
    return defaultPort;
  }

  const port: number | undefined = parsePort(value);
  if (port === undefined) {
    throw new Error(createInstallPublicPortErrorMessage(label));
  }

  return port;
}

export function readInstallImageSelectionMessage(
  options: SelfHostedInstallPreflightOptions,
  versionSelection: InstallVersionSelection,
): string {
  const imageSelectionMessage: string =
    options.imageSource === 'local'
      ? `Using local self-hosted image tag ${options.version} from the local Docker daemon`
      : `Using published self-hosted image tag ${options.version}`;
  const implicitVersionReason: string | undefined = readImplicitInstallVersionReason(versionSelection);

  return implicitVersionReason === undefined
    ? `${imageSelectionMessage}.`
    : `${imageSelectionMessage} because ${implicitVersionReason}.`;
}

function createInstallPublicPortErrorMessage(label: string): string {
  return `${label} must be an integer between 1 and 65535.`;
}

function parseJsonObject(output: string): JsonValue {
  try {
    return JSON.parse(output.trim()) as JsonValue;
  } catch {
    throw new Error('Failed to parse sudo install result.');
  }
}

function createLocalLoginCommand(result: SelfHostedInstallResult): string {
  const commandInput: CliInstallLoginCommandInput = {
    apiUrl: result.apiUrl,
    email: result.adminEmail,
    organizationSlug: result.organization.slug,
  };

  return buildCliInstallLoginCommand(commandInput);
}

function createCliLoginCommand(result: SelfHostedInstallResult): string {
  const apiUrlArgument: string = quoteShellArgumentWhenNeeded(result.apiUrl);
  const adminEmailArgument: string = quoteShellArgumentWhenNeeded(result.adminEmail);
  const organizationSlugArgument: string = quoteShellArgumentWhenNeeded(result.organization.slug);

  return `compartment login --api-url ${apiUrlArgument} --email ${adminEmailArgument} --organization ${organizationSlugArgument}`;
}

function readImplicitInstallVersionReason(versionSelection: InstallVersionSelection): string | undefined {
  if (versionSelection.usesCliDefault !== true) {
    return undefined;
  }

  if (versionSelection.sourceChannel === 'main') {
    return 'this compartment CLI was installed from the main channel';
  }

  if (versionSelection.sourceChannel === 'release' && versionSelection.value !== 'latest') {
    return 'this compartment CLI was installed from a stable release build';
  }

  return undefined;
}
