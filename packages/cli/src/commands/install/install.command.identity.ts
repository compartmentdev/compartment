import { promptNewPassword, promptRegisterEmail, promptRegisterOrganization } from '../../prompts/prompt';
import { validatePassword } from '../../prompts/prompt.validation';
import type { InstallInput } from '../../services/install.service.types';
import type { CliIoCommandDependencies } from '../command.types';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';

const adminPasswordEnvName: string = ['COMPARTMENT', 'ADMIN', 'PASSWORD'].join('_');

export async function resolveInstallIdentityPrompts(
  dependencies: CliIoCommandDependencies,
  options: InstallCommandOptions,
): Promise<ResolvedInstallIdentityPrompts> {
  const adminEmail: string = await promptRegisterEmail(dependencies.io, options.email);
  const organizationName: string = await promptRegisterOrganization(dependencies.io, adminEmail, options.organization);
  const adminPassword: string = await resolveInstallAdminPassword(dependencies);

  return {
    adminEmail,
    adminPassword,
    organizationName,
  };
}

async function resolveInstallAdminPassword(dependencies: CliIoCommandDependencies): Promise<string> {
  const configuredPassword: string | undefined = process.env[adminPasswordEnvName];
  if (configuredPassword === undefined) {
    return await promptNewPassword(dependencies.io);
  }

  const validationError: string | undefined = validatePassword(configuredPassword);
  if (validationError !== undefined) {
    throw new Error(`${adminPasswordEnvName}: ${validationError}`);
  }
  return configuredPassword;
}

export function buildOwnerInstallInput(
  prompts: ResolvedInstallIdentityPrompts,
  options: InstallCommandOptions,
): Omit<InstallInput, 'baseDomain'> {
  return {
    adminEmail: prompts.adminEmail,
    adminPassword: prompts.adminPassword,
    organizationName: prompts.organizationName,
    ...(options.organizationSlug === undefined ? {} : { organizationSlug: options.organizationSlug }),
  };
}
