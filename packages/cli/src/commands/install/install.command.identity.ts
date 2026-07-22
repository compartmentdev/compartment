import { promptNewPassword, promptRegisterEmail, promptRegisterOrganization } from '../../prompts/prompt';
import type { InstallInput } from '../../services/install.service.types';
import type { CliIoCommandDependencies } from '../command.types';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';

export async function resolveInstallIdentityPrompts(
  dependencies: CliIoCommandDependencies,
  options: InstallCommandOptions,
): Promise<ResolvedInstallIdentityPrompts> {
  const adminEmail: string = await promptRegisterEmail(dependencies.io, options.email);
  const organizationName: string = await promptRegisterOrganization(dependencies.io, adminEmail, options.organization);
  const adminPassword: string = await promptNewPassword(dependencies.io);

  return {
    adminEmail,
    adminPassword,
    organizationName,
  };
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
