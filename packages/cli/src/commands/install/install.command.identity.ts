import {
  promptNewPassword,
  promptRegisterEmail,
  promptRegisterOrganization,
  writeInstallOrganizationDetailsHeading,
} from '../../prompts/prompt';
import { validatePassword } from '../../prompts/prompt.validation';
import type { InstallInput } from '../../services/install.service.types';
import type { CliIoCommandDependencies } from '../command.types';
import type { InstallCommandOptions, ResolvedInstallIdentityPrompts } from './install.command.types';
import { readFile } from 'node:fs/promises';

const adminPasswordEnvName: string = ['COMPARTMENT', 'ADMIN', 'PASSWORD'].join('_');

export async function resolveInstallIdentityPrompts(
  dependencies: CliIoCommandDependencies,
  options: InstallCommandOptions,
): Promise<ResolvedInstallIdentityPrompts> {
  writeInstallOrganizationDetailsHeading(dependencies.io, options.email, options.organization);
  const adminEmail: string = await promptRegisterEmail(dependencies.io, options.email);
  const organizationName: string = await promptRegisterOrganization(dependencies.io, adminEmail, options.organization);
  const adminPassword: string = await resolveInstallAdminPassword(dependencies, options);

  return {
    adminEmail,
    adminPassword,
    organizationName,
  };
}

export function withResolvedInstallIdentity(
  options: InstallCommandOptions,
  identity: ResolvedInstallIdentityPrompts,
): InstallCommandOptions {
  return {
    ...options,
    adminPassword: identity.adminPassword,
    email: identity.adminEmail,
    organization: identity.organizationName,
  };
}

async function resolveInstallAdminPassword(
  dependencies: CliIoCommandDependencies,
  options: InstallCommandOptions,
): Promise<string> {
  const boundaryPassword: string | undefined = await readBoundaryInstallAdminPassword(dependencies, options);
  if (boundaryPassword !== undefined) {
    return boundaryPassword;
  }
  return await promptNewPassword(dependencies.io);
}

export async function readBoundaryInstallAdminPassword(
  dependencies: CliIoCommandDependencies,
  options: InstallCommandOptions,
): Promise<string | undefined> {
  if (options.adminPasswordFile !== undefined) {
    return await readValidatedPasswordFile(dependencies, options.adminPasswordFile);
  }
  if (options.adminPassword !== undefined) {
    const validationError: string | undefined = validatePassword(options.adminPassword);
    if (validationError !== undefined) {
      throw new Error(`--admin-password: ${validationError}`);
    }
    return options.adminPassword;
  }
  const configuredPassword: string | undefined = readConfiguredInstallAdminPassword();
  return configuredPassword;
}

async function readValidatedPasswordFile(dependencies: CliIoCommandDependencies, path: string): Promise<string> {
  const password: string =
    path === '-' ? await readPasswordFromStdin(dependencies) : (await readFile(path, 'utf8')).trim();
  const validationError: string | undefined = validatePassword(password);
  if (validationError !== undefined) {
    throw new Error(`--admin-password-file: ${validationError}`);
  }
  return password;
}

async function readPasswordFromStdin(dependencies: CliIoCommandDependencies): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of dependencies.io.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function readConfiguredInstallAdminPassword(): string | undefined {
  const configuredPassword: string | undefined = process.env[adminPasswordEnvName];
  if (configuredPassword === undefined) {
    return undefined;
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
