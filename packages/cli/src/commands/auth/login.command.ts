import { Option, type Command } from 'commander';
import type { LoginResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import type { ApiContext } from '../../services/context.types';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import { createApiContext } from '../command-context';
import type { CliCommandDependencies, LoginCommandOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';
import type { ResolvedLoginRemote } from './auth-remote.command';
import { resolveLoginIdentityPrompt } from './login-email.helpers';
import { persistLoginBindingIfNeeded } from './login-binding.service';
import { performLoginCommandFlow } from './login.command.flow';
import type { LoginCommandResult } from './login.command.types';
import { persistResolvedLoginSession, type PersistResolvedLoginSessionResult } from './login-session.helpers';

interface ResolvedLoginPrompt {
  email?: string | undefined;
  remote: ResolvedLoginRemote;
}

export function registerLoginCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('login')
      .option('--api-url <url>')
      .option('--email <email>', 'Prefill the browser login email')
      .option('--organization <slug>', 'Use this organization during browser login')
      .addOption(
        new Option(
          '--onboarding-session <id>',
          'Attach this CLI login to a first-deploy onboarding session',
        ).hideHelp(),
      )
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: LoginCommandOptions): Promise<void> => await executeLoginCommand(dependencies, options));
}

async function executeLoginCommand(dependencies: CliCommandDependencies, options: LoginCommandOptions): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const prompt: ResolvedLoginPrompt = await resolveLoginPrompt(dependencies, config, options);
  const context: ApiContext = createApiContext(prompt.remote.apiUrl);
  const response: LoginResponse = await performLoginCommandFlow(
    dependencies,
    context,
    prompt.email,
    options.onboardingSession,
    options.organization,
  );
  const persistedSession: PersistResolvedLoginSessionResult = await persistLoginAndBinding(
    dependencies,
    options,
    config,
    prompt.remote,
    response,
  );
  const result: LoginCommandResult = {
    currentOrganization: persistedSession.currentOrganization,
    response,
  };

  renderOutput(dependencies.io, options.output, result.response, createLoginResultMessage(result));
}

async function persistLoginAndBinding(
  dependencies: CliCommandDependencies,
  options: LoginCommandOptions,
  config: CliConfig,
  remote: ResolvedLoginRemote,
  response: LoginResponse,
): Promise<PersistResolvedLoginSessionResult> {
  const persistedSession: PersistResolvedLoginSessionResult = await persistResolvedLoginSession({
    config,
    firstDeployOnboardingSessionId: options.onboardingSession,
    remote,
    response,
    selectedOrganizationSlug: options.organization,
  });
  await persistLoginBindingIfNeeded({
    config: persistedSession.config,
    cwd: process.cwd(),
    io: dependencies.io,
    output: options.output,
    remoteName: remote.remoteName,
  });
  return persistedSession;
}

function createLoginResultMessage(result: LoginCommandResult): string {
  const currentOrganizationText: string =
    result.currentOrganization !== undefined ? ` in ${result.currentOrganization.slug}` : '';

  return `Logged in as ${result.response.principal.email}${currentOrganizationText}`;
}

async function resolveLoginPrompt(
  dependencies: CliCommandDependencies,
  config: CliConfig,
  options: LoginCommandOptions,
): Promise<ResolvedLoginPrompt> {
  return await resolveLoginIdentityPrompt(
    dependencies.io,
    config,
    options.output,
    options.remote,
    options.apiUrl,
    options.email,
  );
}
