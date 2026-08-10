import type { ClaimAccountResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import { promptLoginEmail, promptNewPassword } from '../../prompts/prompt';
import { claimAccount } from '../../services/claim-account.service';
import type { AuthenticatedContext } from '../../services/context.types';
import { buildPrincipalEmailConfig } from '../../store/config.mutations';
import { readCliConfig, writeCliConfig } from '../../store/config.store';
import type { CliConfig } from '../../store/config.types';
import type { ClaimCommandOptions, CliCommandDependencies } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';

export function registerClaimCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('claim')
      .description('Bind a real email and password to the signed-in account')
      .option('--email <email>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: ClaimCommandOptions): Promise<void> => await executeClaimCommand(dependencies, options));
}

async function executeClaimCommand(dependencies: CliCommandDependencies, options: ClaimCommandOptions): Promise<void> {
  const context: AuthenticatedContext = await createRemoteAuthenticatedContext(options);
  const response: ClaimAccountResponse = await claimAccount(context, {
    email: await promptLoginEmail(dependencies.io, options.email),
    password: await promptNewPassword(dependencies.io, 'Password'),
  });
  await persistClaimedPrincipalEmail(context, response);

  renderOutput(dependencies.io, options.output, response, `Claimed this account as ${response.principal.email}.`);
}

async function persistClaimedPrincipalEmail(
  context: AuthenticatedContext,
  response: ClaimAccountResponse,
): Promise<void> {
  const config: CliConfig = await readCliConfig();

  await writeCliConfig(buildPrincipalEmailConfig(config, context.remoteName, response.principal.email));
}
