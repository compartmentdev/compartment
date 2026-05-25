import {
  buildDisabledSsoOidcProvisioningPolicy,
  type CompartmentMembershipRole,
  type DisabledSsoOidcProvisioningPolicy,
  type SsoOidcProvisioningPolicy,
} from '@compartment/contracts';
import { splitCommaSeparatedValues } from '../comma-separated-values.command.helpers';

export interface SsoOidcProvisioningCommandOptions {
  autoJoin?: 'disabled' | 'enabled' | undefined;
  autoJoinDomains?: string | undefined;
  autoJoinRole?: CompartmentMembershipRole | undefined;
}

export function buildSsoOidcProvisioningPolicy(
  options: SsoOidcProvisioningCommandOptions,
): SsoOidcProvisioningPolicy | undefined {
  if (isProvisioningPolicyOmitted(options)) {
    return undefined;
  }

  return options.autoJoin === 'disabled'
    ? buildDisabledProvisioningPolicy(options)
    : buildEnabledProvisioningPolicy(requireAutoJoinState(options), options);
}

function isProvisioningPolicyOmitted(options: SsoOidcProvisioningCommandOptions): boolean {
  return options.autoJoin === undefined && options.autoJoinDomains === undefined && options.autoJoinRole === undefined;
}

function requireAutoJoinState(options: SsoOidcProvisioningCommandOptions): 'disabled' | 'enabled' {
  if (options.autoJoin === undefined) {
    throw new Error('OIDC auto-join requires --auto-join enabled or --auto-join disabled.');
  }

  return options.autoJoin;
}

function buildEnabledProvisioningPolicy(
  autoJoin: 'disabled' | 'enabled',
  options: SsoOidcProvisioningCommandOptions,
): SsoOidcProvisioningPolicy {
  if (autoJoin !== 'enabled') {
    return buildDisabledProvisioningPolicy(options);
  }
  if (options.autoJoinRole === undefined) {
    throw new Error('OIDC auto-join requires --auto-join-role when enabled.');
  }

  const allowedEmailDomains: string[] = splitCommaSeparatedValues(options.autoJoinDomains);
  if (allowedEmailDomains.length === 0) {
    throw new Error('OIDC auto-join requires at least one --auto-join-domains value when enabled.');
  }

  return {
    allowedEmailDomains,
    autoJoinEnabled: true,
    defaultRole: options.autoJoinRole,
  };
}

function buildDisabledProvisioningPolicy(
  options: SsoOidcProvisioningCommandOptions,
): DisabledSsoOidcProvisioningPolicy {
  if (options.autoJoinDomains !== undefined || options.autoJoinRole !== undefined) {
    throw new Error('OIDC auto-join domains and role may only be set when --auto-join enabled.');
  }

  return buildDisabledSsoOidcProvisioningPolicy();
}
