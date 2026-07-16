import type { InstallResponse } from '@compartment/contracts';
import type { Command } from 'commander';
import type { DevInstallResult } from '../../install.types';
import { installDev } from '../../install';
import { renderOutput } from '../../output/render';
import type { CliCommandDependencies } from '../command.types';
import { resolveInstallIdentityPrompts } from './install.command.identity';
import { persistDevInstallSession } from './install.command.session';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';

export function registerInstallCommand(program: Command, dependencies: CliCommandDependencies): void {
  program
    .command('install')
    .requiredOption('--dev', 'Install against the local repo dev API')
    .option('--email <email>', 'First admin email')
    .option('--organization <name>', 'First organization name')
    .option('--organization-slug <slug>')
    .option('--remote <name>', 'Remote name for the local development session')
    .option('--output <format>', 'text or json', 'text')
    .action(
      async (options: InstallCommandOptions): Promise<void> => await executeInstallCommand(dependencies, options),
    );
}

async function executeInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  const prompts: ResolvedInstallIdentityPrompts = await resolveInstallIdentityPrompts(dependencies, options);
  const result: DevInstallResult = await installDev({
    adminEmail: prompts.adminEmail,
    adminPassword: prompts.adminPassword,
    organizationName: prompts.organizationName,
    ...(options.organizationSlug !== undefined ? { organizationSlug: options.organizationSlug } : {}),
  });

  await persistDevInstallSession(result, options.remote);
  renderOutput(dependencies.io, options.output, toInstallResponse(result), createInstallResultMessage(result));
}

function toInstallResponse(result: DevInstallResult): InstallResponse {
  return {
    adminEmail: result.adminEmail,
    baseDomain: result.baseDomain,
    compartmentUrl: result.compartmentUrl,
    dnsRecords: result.dnsRecords,
    operation: result.operation,
    organization: result.organization,
    sessionToken: result.sessionToken,
  };
}

function createInstallResultMessage(result: DevInstallResult): string {
  return `Installed local development compartment at ${result.compartmentUrl}. Logged in as ${result.adminEmail}.`;
}
