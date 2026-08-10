import type { SignupResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { promptOrganizationName } from '../../prompts/prompt';
import { signUp } from '../../services/signup.service';
import { readCliConfig } from '../../store/config.store';
import type { CliConfig, CliOrganizationConfig } from '../../store/config.types';
import { createApiContext } from '../command-context';
import type { CliCommandDependencies, SignupCommandOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';
import { resolveLoginRemote, type ResolvedLoginRemote } from './auth-remote.command';
import { persistResolvedLoginSession, type PersistResolvedLoginSessionResult } from './login-session.helpers';

export function registerSignupCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('signup')
      .description('Create a Compartment account and its first organization')
      .option('--api-url <url>')
      .option('--email <email>')
      .option('--organization <name>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: SignupCommandOptions): Promise<void> => await executeSignupCommand(dependencies, options));
}

async function executeSignupCommand(
  dependencies: CliCommandDependencies,
  options: SignupCommandOptions,
): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const remote: ResolvedLoginRemote = await resolveLoginRemote(
    dependencies.io,
    config,
    options.output,
    options.remote,
    options.apiUrl,
  );
  const response: SignupResponse = await signUp(createApiContext(remote.apiUrl), {
    ...(options.email === undefined ? {} : { email: options.email }),
    organizationName: await promptOrganizationName(dependencies.io, options.organization),
  });
  const persistedSession: PersistResolvedLoginSessionResult = await persistResolvedLoginSession({
    config,
    remote,
    response,
  });

  renderOutput(
    dependencies.io,
    options.output,
    response,
    createSignupResultMessage(response, persistedSession.currentOrganization),
  );
}

function createSignupResultMessage(
  response: SignupResponse,
  currentOrganization: CliOrganizationConfig | undefined,
): string {
  const organizationSlug: string = currentOrganization?.slug ?? response.organizations[0]?.slug ?? '';

  return `Signed up ${response.principal.email} in ${organizationSlug}
Run \`compartment auth claim\` to bind a real email and password for console sign-in.`;
}
