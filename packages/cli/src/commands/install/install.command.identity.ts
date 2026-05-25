import { promptNewPassword, promptRegisterEmail, promptRegisterOrganization } from '../../prompts/prompt';
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
