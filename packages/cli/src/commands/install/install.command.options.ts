import { organizationSlugSchema } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import type { SafeParseReturnType } from 'zod';
import { assertValidRemoteName } from '../../services/remote-name.service';
import {
  readSelfHostedImageRegistry,
  readSelfHostedImageSource,
  resolveSelfHostedVersionSelection,
} from '../self-hosted.command.options';
import { defaultPublicHttpPort, defaultPublicHttpsPort, readInstallPublicPortOption } from './install.command.helpers';
import type { InstallCommandOptions } from './install.command.types';

const localRuntimeInstallBaseDomain: string = '127.0.0.1.sslip.io';
const managedDomainBrokerUrlEnvName: string = 'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL';
const defaultManagedDomainBrokerUrl: string = 'https://broker.compartment.run';
export {
  readSelfHostedImageRegistry as readInstallImageRegistry,
  readSelfHostedImageSource as readInstallImageSource,
  assertSelfHostedVersionMatchesPackagedNodeAgent as assertInstallVersionMatchesPackagedNodeAgent,
  resolveSelfHostedVersionSelection as resolveInstallVersionSelection,
} from '../self-hosted.command.options';
export type { SelfHostedVersionSelection as InstallVersionSelection } from '../self-hosted.command.options';

export function assertInstallModeSelection(options: InstallCommandOptions): void {
  assertBrokerUrlOptionSelection(options);
  assertManagedDomainOptionSelection(options);
  assertDevModeOptionSelection(options);
}

export function assertInstallOptionValues(options: InstallCommandOptions): void {
  if (options.remote !== undefined) {
    assertValidRemoteName(options.remote);
  }
  readInstallBaseDomain(options);
  readInstallManagedDomainBrokerUrl(options);
  readSelfHostedImageRegistry(options.imageRegistry);
  readSelfHostedImageSource(options.imageSource);
  resolveSelfHostedVersionSelection(options.version);
  assertInstallOrganizationSlugOption(options.organizationSlug);

  if (options.publicHttpPort !== undefined) {
    readInstallPublicPortOption(options.publicHttpPort, 'Public HTTP port', defaultPublicHttpPort);
  }
  if (options.publicHttpsPort !== undefined) {
    readInstallPublicPortOption(options.publicHttpsPort, 'Public HTTPS port', defaultPublicHttpsPort);
  }
}

function assertInstallOrganizationSlugOption(organizationSlug: string | undefined): void {
  if (organizationSlug === undefined) {
    return;
  }

  const parsedOrganizationSlug: SafeParseReturnType<string, string> =
    organizationSlugSchema.safeParse(organizationSlug);
  if (!parsedOrganizationSlug.success) {
    throw new Error(parsedOrganizationSlug.error.issues[0]?.message ?? 'Organization slug is invalid.');
  }
}

export function readInstallBaseDomain(options: InstallCommandOptions): string | undefined {
  if (options.managedDomain === true && options.baseDomain !== undefined) {
    throw new Error('Choose either `--base-domain` or `--managed-domain` for install, not both.');
  }
  if (options.localRuntime === true && options.baseDomain !== undefined) {
    throw new Error('Choose either `--base-domain` or `--local-runtime` for install, not both.');
  }
  if (options.managedDomain === true && options.localRuntime === true) {
    throw new Error('Choose either `--local-runtime` or `--managed-domain` for install, not both.');
  }

  if (options.localRuntime === true) {
    return localRuntimeInstallBaseDomain;
  }

  return options.baseDomain;
}

export function readInstallManagedDomainBrokerUrl(
  options: InstallCommandOptions,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!usesManagedInstallDomain(options)) {
    return undefined;
  }

  const envBrokerUrl: string | undefined = readOptionalEnvText(env[managedDomainBrokerUrlEnvName]);
  const configuredBrokerUrl: string = options.brokerUrl ?? envBrokerUrl ?? defaultManagedDomainBrokerUrl;

  try {
    return new URL(configuredBrokerUrl).toString().replace(/\/$/, '');
  } catch {
    throw new Error('Managed domain broker URL must be a valid absolute URL.');
  }
}

function readOptionalEnvText(value: string | undefined): string | undefined {
  return hasText(value) ? value : undefined;
}

function assertManagedDomainOptionSelection(options: InstallCommandOptions): void {
  if (options.managedDomain !== true) {
    return;
  }

  assertDevOptionUnset(options.baseDomain, '`--managed-domain` cannot be combined with `--base-domain`.');
  assertDevFlagDisabled(options.localRuntime, '`--managed-domain` cannot be combined with `--local-runtime`.');
}

function assertBrokerUrlOptionSelection(options: InstallCommandOptions): void {
  if (options.brokerUrl !== undefined && !usesManagedInstallDomain(options)) {
    throw new Error('`--broker-url` requires a managed-domain install.');
  }
}

export function usesManagedInstallDomain(options: InstallCommandOptions): boolean {
  if (options.managedDomain === true) {
    return true;
  }
  if (options.dev === true) {
    return false;
  }
  if (options.baseDomain !== undefined) {
    return false;
  }
  if (options.localRuntime === true) {
    return false;
  }

  return true;
}

function assertDevModeOptionSelection(options: InstallCommandOptions): void {
  if (options.dev !== true) {
    if (options.remote !== undefined) {
      throw new Error('`--remote` requires `--dev`.');
    }
    return;
  }

  assertDevOptionUnset(options.imageSource, '`--dev` cannot be combined with `--image-source`.');
  assertDevOptionUnset(options.imageRegistry, '`--dev` cannot be combined with `--image-registry`.');
  assertDevOptionUnset(options.version, '`--dev` cannot be combined with `--version`.');
  assertDevOptionUnset(options.baseDomain, '`--dev` cannot be combined with `--base-domain`.');
  assertDevOptionUnset(options.brokerUrl, '`--dev` cannot be combined with `--broker-url`.');
  assertDevFlagDisabled(options.localRuntime, '`--dev` cannot be combined with `--local-runtime`.');
  assertDevFlagDisabled(options.managedDomain, '`--dev` cannot be combined with `--managed-domain`.');
  assertDevPublicPortSelection(options);
}

function assertDevOptionUnset(value: string | undefined, errorMessage: string): void {
  if (value !== undefined) {
    throw new Error(errorMessage);
  }
}

function assertDevFlagDisabled(value: boolean | undefined, errorMessage: string): void {
  if (value === true) {
    throw new Error(errorMessage);
  }
}

function assertDevPublicPortSelection(options: InstallCommandOptions): void {
  if (options.publicHttpPort !== undefined || options.publicHttpsPort !== undefined) {
    throw new Error('`--dev` cannot be combined with public port options.');
  }
}
