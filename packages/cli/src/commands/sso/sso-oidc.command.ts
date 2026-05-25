import {
  hasSsoOidcProviderUpdateChanges,
  type ConfigureSsoOidcProviderRequest,
  type DeleteSsoOidcProviderResponse,
  type SsoOidcProviderListResponse,
  type SsoOidcProviderResponse,
  type SsoOidcProviderSummary,
  type UpdateSsoOidcProviderRequest,
} from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, OutputOnlyOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';
import type { AuthenticatedContext } from '../../services/context.types';
import { readCliConfig } from '../../store/config.store';
import {
  createOrganizationSsoOidcProvider,
  deleteOrganizationSsoOidcProvider,
  readOrganizationSsoOidcProviders,
  updateOrganizationSsoOidcProvider,
} from '../../services/sso-oidc-provider.service';
import {
  buildSsoOidcIdentityVerificationConfig,
  type SsoOidcIdentityVerificationCommandOptions,
} from './sso-oidc-identity-verification.command';
import {
  buildSsoOidcProvisioningPolicy,
  type SsoOidcProvisioningCommandOptions,
} from './sso-oidc-provisioning.command';

interface SsoOidcSharedCommandOptions
  extends OutputOnlyOptions, SsoOidcIdentityVerificationCommandOptions, SsoOidcProvisioningCommandOptions {
  buttonText?: string | undefined;
  clientId?: string | undefined;
  displayName?: string | undefined;
  issuerUrl?: string | undefined;
  preset?: 'generic' | 'google' | undefined;
  scope?: string | undefined;
}

interface SsoOidcCreateCommandOptions extends SsoOidcSharedCommandOptions {
  clientId: string;
  clientSecret: string;
  key: string;
  preset: 'generic' | 'google';
}

interface SsoOidcUpdateCommandOptions extends SsoOidcSharedCommandOptions {
  clientSecret?: string | undefined;
  key?: string | undefined;
}

interface SsoOidcSharedOptionConfig {
  clientIdRequired: boolean;
  presetDefault?: 'generic' | 'google' | undefined;
}

export function registerSsoOidcCommands(program: Command, dependencies: CliCommandDependencies): void {
  const oidcCommand: Command = program.command('oidc').description('OIDC SSO provider configuration');
  registerSsoOidcListCommand(oidcCommand, dependencies);
  registerSsoOidcAddCommand(oidcCommand, dependencies);
  registerSsoOidcUpdateCommand(oidcCommand, dependencies);
  registerSsoOidcRemoveCommand(oidcCommand, dependencies);
}

function registerSsoOidcListCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(program.command('list').option('--output <format>', 'text or json', 'text')).action(
    async (options: OutputOnlyOptions): Promise<void> => {
      const response: SsoOidcProviderListResponse = await readOrganizationSsoOidcProviders(
        await createSsoOidcCommandContext(options),
      );

      renderOutput(dependencies.io, options.output, response, createSsoOidcProviderListMessage(response));
    },
  );
}

function registerSsoOidcAddCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(addSsoOidcCreateOptions(program.command('add'))).action(
    async (options: SsoOidcCreateCommandOptions): Promise<void> => {
      const response: SsoOidcProviderResponse = await createOrganizationSsoOidcProvider(
        await createSsoOidcCommandContext(options),
        buildCreateSsoOidcProviderRequest(options),
      );

      renderOutput(dependencies.io, options.output, response, createSsoOidcProviderMessage(response, 'Added'));
    },
  );
}

function registerSsoOidcUpdateCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(addSsoOidcUpdateOptions(program.command('update').argument('<providerId>'))).action(
    async (providerId: string, options: SsoOidcUpdateCommandOptions): Promise<void> => {
      const response: SsoOidcProviderResponse = await updateOrganizationSsoOidcProvider(
        await createSsoOidcCommandContext(options),
        providerId,
        buildUpdateSsoOidcProviderRequest(options),
      );

      renderOutput(dependencies.io, options.output, response, createSsoOidcProviderMessage(response, 'Updated'));
    },
  );
}

function registerSsoOidcRemoveCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program.command('remove').argument('<providerId>').option('--output <format>', 'text or json', 'text'),
  ).action(async (providerId: string, options: OutputOnlyOptions): Promise<void> => {
    const response: DeleteSsoOidcProviderResponse = await deleteOrganizationSsoOidcProvider(
      await createSsoOidcCommandContext(options),
      providerId,
    );

    renderOutput(dependencies.io, options.output, response, 'Removed the selected OIDC SSO provider.');
  });
}

function addSsoOidcCreateOptions(command: Command): Command {
  return addSsoOidcSharedOptions(command, {
    clientIdRequired: true,
    presetDefault: 'generic',
  })
    .requiredOption('--client-secret <clientSecret>')
    .requiredOption('--key <key>');
}

function addSsoOidcUpdateOptions(command: Command): Command {
  return addSsoOidcSharedOptions(command, {
    clientIdRequired: false,
  })
    .option('--client-secret <clientSecret>')
    .option('--key <key>');
}

function addSsoOidcSharedOptions(command: Command, config: SsoOidcSharedOptionConfig): Command {
  const commandWithClientId: Command = config.clientIdRequired
    ? command.requiredOption('--client-id <clientId>')
    : command.option('--client-id <clientId>');
  const configuredCommand: Command = commandWithClientId
    .option('--button-text <buttonText>')
    .option('--auto-join <state>', 'enabled or disabled')
    .option('--auto-join-domains <domains>')
    .option('--auto-join-role <role>')
    .option('--display-name <displayName>')
    .option('--email-claims <claims>')
    .option('--email-verified-claims <claims>')
    .option('--issuer-url <issuerUrl>')
    .option('--output <format>', 'text or json', 'text')
    .option('--scope <scope>')
    .option('--verified-email-claims <claims>');

  return config.presetDefault === undefined
    ? configuredCommand.option('--preset <preset>', 'generic or google')
    : configuredCommand.option('--preset <preset>', 'generic or google', config.presetDefault);
}

function buildCreateSsoOidcProviderRequest(options: SsoOidcCreateCommandOptions): ConfigureSsoOidcProviderRequest {
  return {
    ...buildSsoOidcProviderMutationRequest(options),
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    key: options.key,
    preset: options.preset,
  };
}

function buildUpdateSsoOidcProviderRequest(options: SsoOidcUpdateCommandOptions): UpdateSsoOidcProviderRequest {
  const request: UpdateSsoOidcProviderRequest = buildSsoOidcProviderMutationRequest(options);

  if (!hasSsoOidcProviderUpdateChanges(request)) {
    throw new Error('Provide at least one OIDC provider option to update.');
  }

  return request;
}

function buildSsoOidcProviderMutationRequest(
  options: SsoOidcSharedCommandOptions & { clientSecret?: string | undefined; key?: string | undefined },
): UpdateSsoOidcProviderRequest {
  return {
    buttonText: options.buttonText,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    displayName: options.displayName,
    identityVerification: buildSsoOidcIdentityVerificationConfig(options),
    issuerUrl: options.issuerUrl,
    key: options.key,
    preset: options.preset,
    provisioning: buildSsoOidcProvisioningPolicy(options),
    scope: options.scope,
  };
}

async function createSsoOidcCommandContext(options: OutputOnlyOptions): Promise<AuthenticatedContext> {
  assertValidRemoteOption(options);

  return await createAuthenticatedContext(await readCliConfig(), {
    cwd: process.cwd(),
    remoteName: options.remote,
  });
}

function createSsoOidcProviderListMessage(response: SsoOidcProviderListResponse): string {
  if (response.providers.length === 0) {
    return 'No OIDC SSO providers are configured for the current organization.';
  }

  return renderSsoOidcProviderListMessage(response.providers);
}

function createSsoOidcProviderMessage(response: SsoOidcProviderResponse, action: string): string {
  if (response.provider === null) {
    return `${action} OIDC SSO provider.`;
  }

  return `${action} OIDC SSO provider ${formatSsoOidcProvider(response.provider)}.`;
}

function formatSsoOidcProvider(provider: SsoOidcProviderSummary): string {
  return `${provider.displayName} [${provider.key}] (${provider.preset})`;
}

function formatSsoOidcProviderListRow(provider: SsoOidcProviderSummary): string {
  return [provider.displayName, provider.key, provider.id, provider.preset, provider.issuerUrl].join('\t');
}

function renderSsoOidcProviderListMessage(providers: SsoOidcProviderSummary[]): string {
  return `Display name\tKey\tId\tPreset\tIssuer URL
${providers.map(formatSsoOidcProviderListRow).join('\n')}`;
}
