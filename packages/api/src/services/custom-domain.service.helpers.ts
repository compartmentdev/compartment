import { readApiPublicIngressConfig, type ApiConfig } from '../config';
import { createCustomDomainNotFoundError, isApiBusinessError } from '../errors/api-business-error';
import { requireScopedPermission } from './access-scope.service';
import type { CustomDomainDnsConfig } from './custom-domain-dns.service.types';

export function buildCustomDomainDnsConfig(config: ApiConfig): CustomDomainDnsConfig {
  return {
    ...readApiPublicIngressConfig(),
    sessionSecret: config.sessionSecret,
  };
}

export async function requireVisibleCustomDomainPermission(
  principalId: string,
  organizationId: string,
  environmentId: string,
  permission: 'domain.read' | 'domain.write',
): Promise<void> {
  try {
    await requireCustomDomainPermission(principalId, organizationId, environmentId, permission);
  } catch (error) {
    const businessError: Error | undefined = error instanceof Error ? error : undefined;
    if (isApiBusinessError(businessError) && businessError.code === 'forbidden') {
      throw createCustomDomainNotFoundError();
    }
    throw error;
  }
}

export async function requireOrganizationPermission(
  principalId: string,
  organizationId: string,
  permission: 'domain.read' | 'domain.write',
): Promise<void> {
  await requireScopedPermission({
    organizationId,
    permission,
    principalId,
    routeScope: {
      scopeId: organizationId,
      scopeType: 'organization',
    },
  });
}

export async function requireCustomDomainPermission(
  principalId: string,
  organizationId: string,
  environmentId: string,
  permission: 'domain.read' | 'domain.write',
): Promise<void> {
  await requireScopedPermission({
    organizationId,
    permission,
    principalId,
    routeScope: {
      scopeId: environmentId,
      scopeType: 'environment',
    },
  });
}
