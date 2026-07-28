import type {
  CreateCustomDomainResponse,
  CustomDomainResponse,
  ListCustomDomainsResponse,
  RemoveCustomDomainResponse,
  VerifyCustomDomainResponse,
} from '@compartment/contracts';
import type { Command } from 'commander';
import { renderOutput } from '../../output/render';
import {
  addCustomDomain,
  listCustomDomains,
  removeCustomDomain,
  showCustomDomain,
  verifyCustomDomain,
} from '../../services/custom-domains.service';
import type { CliCommandDependencies, CustomDomainCommandOptions } from '../command.types';
import { addRemoteOption, createRemoteAuthenticatedContext } from '../remote.command.helpers';
import {
  createCustomDomainAddMessage,
  createCustomDomainListMessage,
  createCustomDomainRemoveMessage,
  createCustomDomainShowMessage,
  createCustomDomainVerifyMessage,
} from './domain.command.output';

export function registerDomainCommands(program: Command, dependencies: CliCommandDependencies): void {
  const domainCommand: Command = program.command('domain').description('Custom app domain commands');
  registerAddDomainCommand(domainCommand, dependencies);
  registerListDomainCommand(domainCommand, dependencies);
  registerShowDomainCommand(domainCommand, dependencies);
  registerVerifyDomainCommand(domainCommand, dependencies);
  registerRemoveDomainCommand(domainCommand, dependencies);
}

function registerAddDomainCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    addDomainTargetOptions(program.command('add').argument('<host>')).option(
      '--output <format>',
      'text or json',
      'text',
    ),
  ).action(
    async (host: string, options: CustomDomainCommandOptions): Promise<void> =>
      await executeAddDomainCommand(dependencies, host, options),
  );
}

function registerListDomainCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    addDomainTargetOptions(program.command('list')).option('--output <format>', 'text or json', 'text'),
  ).action(
    async (options: CustomDomainCommandOptions): Promise<void> => await executeListDomainCommand(dependencies, options),
  );
}

function registerShowDomainCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    addDomainTargetOptions(program.command('show').argument('<host>')).option(
      '--output <format>',
      'text or json',
      'text',
    ),
  ).action(
    async (host: string, options: CustomDomainCommandOptions): Promise<void> =>
      await executeShowDomainCommand(dependencies, host, options),
  );
}

function registerVerifyDomainCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    addDomainTargetOptions(program.command('verify').argument('<host>')).option(
      '--output <format>',
      'text or json',
      'text',
    ),
  ).action(
    async (host: string, options: CustomDomainCommandOptions): Promise<void> =>
      await executeVerifyDomainCommand(dependencies, host, options),
  );
}

function registerRemoveDomainCommand(program: Command, dependencies: CliCommandDependencies): void {
  addRemoteOption(
    addDomainTargetOptions(program.command('remove').argument('<host>')).option(
      '--output <format>',
      'text or json',
      'text',
    ),
  ).action(
    async (host: string, options: CustomDomainCommandOptions): Promise<void> =>
      await executeRemoveDomainCommand(dependencies, host, options),
  );
}

function addDomainTargetOptions(command: Command): Command {
  return command.option('--project <name>').option('--env <name>').option('--service <name>');
}

async function executeAddDomainCommand(
  dependencies: CliCommandDependencies,
  host: string,
  options: CustomDomainCommandOptions,
): Promise<void> {
  const response: CreateCustomDomainResponse = await addCustomDomain(await createRemoteAuthenticatedContext(options), {
    cwd: process.cwd(),
    environmentName: options.env,
    host,
    projectName: options.project,
    serviceName: options.service,
  });

  renderOutput(dependencies.io, options.output, response, createCustomDomainAddMessage(response));
}

async function executeListDomainCommand(
  dependencies: CliCommandDependencies,
  options: CustomDomainCommandOptions,
): Promise<void> {
  const response: ListCustomDomainsResponse = await listCustomDomains(await createRemoteAuthenticatedContext(options), {
    cwd: process.cwd(),
    environmentName: options.env,
    projectName: options.project,
    serviceName: options.service,
  });

  renderOutput(dependencies.io, options.output, response, createCustomDomainListMessage(response));
}

async function executeShowDomainCommand(
  dependencies: CliCommandDependencies,
  host: string,
  options: CustomDomainCommandOptions,
): Promise<void> {
  const response: CustomDomainResponse = await showCustomDomain(await createRemoteAuthenticatedContext(options), {
    host,
  });

  renderOutput(dependencies.io, options.output, response, createCustomDomainShowMessage(response));
}

async function executeVerifyDomainCommand(
  dependencies: CliCommandDependencies,
  host: string,
  options: CustomDomainCommandOptions,
): Promise<void> {
  const response: VerifyCustomDomainResponse = await verifyCustomDomain(
    await createRemoteAuthenticatedContext(options),
    { host },
  );

  renderOutput(dependencies.io, options.output, response, createCustomDomainVerifyMessage(response));
  if (response.domain.status !== 'reconciling' && response.domain.status !== 'active') {
    throw new Error(response.domain.failureMessage ?? 'Custom domain verification failed.');
  }
}

async function executeRemoveDomainCommand(
  dependencies: CliCommandDependencies,
  host: string,
  options: CustomDomainCommandOptions,
): Promise<void> {
  const response: RemoveCustomDomainResponse = await removeCustomDomain(
    await createRemoteAuthenticatedContext(options),
    { host },
  );

  renderOutput(dependencies.io, options.output, response, createCustomDomainRemoveMessage(response));
}
