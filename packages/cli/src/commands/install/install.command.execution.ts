import type { SelfHostedInstallPreflightOptions, SelfHostedInstallServiceOptions } from '../../install.types';
import type { ManagedDomainInstallState } from '../../self-hosted-install-state.types';
import {
  readResolvedInstallBaseDomain,
  resolveManagedDomainInstallState,
  type ResolvedManagedDomainInstallState,
} from './install.command.managed-domain';
import {
  readInstallImageRegistry,
  readInstallImageSource,
  type InstallVersionSelection,
} from './install.command.options';
import type {
  InstallCommandOptions,
  ResolvedInstallIdentityPrompts,
  ResolvedInstallPrompts,
  ResolvedSelfHostedInstallExecution,
} from './install.command.types';
import type { InstallPublicPorts } from './install.command.public-ports';
import type { InstallCommandProgress } from './install.command.progress.types';

export function resolveSelfHostedInstallPreflightOptions(
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  publicPorts: InstallPublicPorts,
): SelfHostedInstallPreflightOptions {
  return {
    imageRegistry: readInstallImageRegistry(options.imageRegistry),
    imageSource: readInstallImageSource(options.imageSource),
    publicHttpPort: publicPorts.publicHttpPort,
    publicHttpsPort: publicPorts.publicHttpsPort,
    version: versionSelection.value,
  };
}

export async function resolveSelfHostedInstallExecution(
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  publicPorts: InstallPublicPorts,
  installationId: string,
  identityPrompts: ResolvedInstallIdentityPrompts,
  progress: InstallCommandProgress,
): Promise<ResolvedSelfHostedInstallExecution> {
  const managedDomainState: ResolvedManagedDomainInstallState | undefined = await resolveInstallManagedDomainState(
    options,
    versionSelection,
    installationId,
    identityPrompts,
    progress,
  );

  return {
    selfHostedInstallOptions: buildSelfHostedInstallOptions(
      options,
      buildResolvedInstallPrompts(identityPrompts, publicPorts),
      versionSelection,
      installationId,
      managedDomainState,
    ),
  };
}

async function resolveInstallManagedDomainState(
  options: InstallCommandOptions,
  versionSelection: InstallVersionSelection,
  installationId: string,
  identityPrompts: ResolvedInstallIdentityPrompts,
  progress: InstallCommandProgress,
): Promise<ResolvedManagedDomainInstallState | undefined> {
  return await resolveManagedDomainInstallState(
    progress,
    options,
    identityPrompts.adminEmail,
    installationId,
    identityPrompts.organizationName,
    versionSelection.value,
  );
}

function buildResolvedInstallPrompts(
  identityPrompts: ResolvedInstallIdentityPrompts,
  publicPorts: InstallPublicPorts,
): ResolvedInstallPrompts {
  return {
    ...identityPrompts,
    ...publicPorts,
  };
}

function buildSelfHostedInstallOptions(
  options: InstallCommandOptions,
  prompts: ResolvedInstallPrompts,
  versionSelection: InstallVersionSelection,
  installationId: string,
  managedDomainState: ResolvedManagedDomainInstallState | undefined,
): SelfHostedInstallServiceOptions {
  const managedDomain: ManagedDomainInstallState | undefined = managedDomainState?.managedDomain;

  return {
    adminEmail: prompts.adminEmail,
    adminPassword: prompts.adminPassword,
    baseDomain: readResolvedInstallBaseDomain(options, managedDomain),
    imageRegistry: readInstallImageRegistry(options.imageRegistry),
    imageSource: readInstallImageSource(options.imageSource),
    installationId,
    ...(managedDomain === undefined ? {} : { managedDomain }),
    organizationName: prompts.organizationName,
    ...(options.organizationSlug !== undefined ? { organizationSlug: options.organizationSlug } : {}),
    publicHttpPort: prompts.publicHttpPort,
    publicHttpsPort: prompts.publicHttpsPort,
    publicIngressIpv4: managedDomainState?.publicIngressIpv4 ?? '',
    publicIngressIpv6: managedDomainState?.publicIngressIpv6 ?? '',
    version: versionSelection.value,
  };
}
