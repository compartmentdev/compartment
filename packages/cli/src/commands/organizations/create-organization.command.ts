import type { Command } from 'commander';
import type { CreateOrganizationResponse } from '@compartment/contracts';
import { renderOutput } from '../../output/render';
import { promptOrganizationName } from '../../prompts/prompt';
import { createOrganization } from '../../services/create-organization.service';
import type { AuthenticatedContext } from '../../services/context.types';
import { readCliConfig, writeCliConfig } from '../../store/config.store';
import { buildOrganizationSelectionConfig } from '../../store/config.mutations';
import type { CliConfig } from '../../store/config.types';
import { createAuthenticatedContext } from '../command-context';
import type { CliCommandDependencies, CreateOrganizationCommandOptions } from '../command.types';
import { addRemoteOption, assertValidRemoteOption } from '../remote.command.helpers';

export function registerCreateOrganizationCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    program
      .command('create')
      .option('--name <name>')
      .option('--slug <slug>')
      .option('--output <format>', 'text or json', 'text'),
  ).action(async (options: CreateOrganizationCommandOptions): Promise<void> => {
    await executeCreateOrganizationCommand(dependencies, options);
  });
}

async function executeCreateOrganizationCommand(
  dependencies: CliCommandDependencies,
  options: CreateOrganizationCommandOptions,
): Promise<void> {
  assertValidRemoteOption(options);
  const config: CliConfig = await readCliConfig();
  const name: string = await promptOrganizationName(dependencies.io, options.name);
  const context: AuthenticatedContext = await createAuthenticatedContext(config, {
    cwd: process.cwd(),
    remoteName: options.remote,
  });
  const response: CreateOrganizationResponse = await createOrganization(context, {
    name,
    ...(options.slug !== undefined ? { slug: options.slug } : {}),
  });

  await persistCreatedOrganization(config, context.remoteName, response);
  renderOutput(dependencies.io, options.output, response, createCreateOrganizationMessage(response));
}

function createCreateOrganizationMessage(response: CreateOrganizationResponse): string {
  return `Created organization ${response.organization.slug}. Using organization ${response.organization.slug}`;
}

async function persistCreatedOrganization(
  config: CliConfig,
  remoteName: string,
  response: CreateOrganizationResponse,
): Promise<void> {
  await writeCliConfig(
    buildOrganizationSelectionConfig(config, remoteName, {
      id: response.organization.id,
      name: response.organization.name,
      slug: response.organization.slug,
    }),
  );
}
