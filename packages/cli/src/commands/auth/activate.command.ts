import type { Command } from 'commander';
import type { ActivateResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { promptActivationToken, promptLoginEmail, promptNewPassword } from '../../prompts/prompt';
import { activate } from '../../services/activation.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig, CliOrganizationConfig } from '../../store/config.types';
import { createApiContext } from '../command-context';
import type { ActivateCommandOptions, CliCommandDependencies } from '../command.types';
import { resolveLoginIdentityPrompt } from './login-email.helpers';
import { persistLoginBindingIfNeeded } from './login-binding.service';
import { persistResolvedLoginSession, type PersistResolvedLoginSessionResult } from './login-session.helpers';
import type { ResolvedLoginRemote } from './auth-remote.command';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

interface ResolvedActivationPrompt {
  email: string;
  remote: ResolvedLoginRemote;
  token: string;
}

export function registerActivateCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('activate')
      .option('--api-url <url>')
      .option('--email <email>')
      .option('--token <token>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: ActivateCommandOptions): Promise<void> => await executeActivateCommand(dependencies, options),
  );
}

async function executeActivateCommand(
  dependencies: CliCommandDependencies,
  options: ActivateCommandOptions,
): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const prompt: ResolvedActivationPrompt = await resolveActivationPrompt(dependencies, config, options);
  const response: ActivateResponse = await activateResolvedPrompt(dependencies, prompt);
  const persistedSession: PersistResolvedLoginSessionResult = await persistActivateAndBinding(
    dependencies,
    options,
    config,
    prompt.remote,
    response,
  );

  renderOutput(
    dependencies.io,
    options.output,
    response,
    createActivateResultMessage(response, persistedSession.currentOrganization),
  );
}

async function activateResolvedPrompt(
  dependencies: CliCommandDependencies,
  prompt: ResolvedActivationPrompt,
): Promise<ActivateResponse> {
  return await activate(createApiContext(prompt.remote.apiUrl), {
    bootstrapToken: prompt.token,
    email: prompt.email,
    password: await promptNewPassword(dependencies.io, 'Password'),
  });
}

async function persistActivateAndBinding(
  dependencies: CliCommandDependencies,
  options: ActivateCommandOptions,
  config: CliConfig,
  remote: ResolvedLoginRemote,
  response: ActivateResponse,
): Promise<PersistResolvedLoginSessionResult> {
  const persistedSession: PersistResolvedLoginSessionResult = await persistResolvedLoginSession({
    config,
    remote,
    response,
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

function createActivateResultMessage(
  response: ActivateResponse,
  currentOrganization: CliOrganizationConfig | undefined,
): string {
  const currentOrganizationText: string = currentOrganization !== undefined ? ` in ${currentOrganization.slug}` : '';

  return `Activated ${response.principal.email}${currentOrganizationText}`;
}

async function resolveActivationPrompt(
  dependencies: CliCommandDependencies,
  config: CliConfig,
  options: ActivateCommandOptions,
): Promise<ResolvedActivationPrompt> {
  const prompt: { email?: string | undefined; remote: ResolvedLoginRemote } = await resolveLoginIdentityPrompt(
    dependencies.io,
    config,
    options.output,
    options.remote,
    options.apiUrl,
    options.email,
  );

  return {
    email: await promptLoginEmail(dependencies.io, prompt.email),
    remote: prompt.remote,
    token: await promptActivationToken(dependencies.io, options.token),
  };
}
