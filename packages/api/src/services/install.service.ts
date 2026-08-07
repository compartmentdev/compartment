import argon2 from 'argon2';
import type { ApiConfig } from '../config';
import { createAlreadyInstalledError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { insertInitialInstallationWithExecutor, withInitialInstallationGuard } from '../queries/install.query';
import type { CreateInitialInstallationInput, InstallTransaction } from '../queries/install.query.types';
import type { InsertOperationInput, OperationRecord } from '../queries/operations.query.types';
import { findOperationRecordByType } from '../queries/operations.query';
import { getApiConfig } from '../runtime/runtime-access';
import { synchronizeEdgeAppAccessState } from './app-access-edge.service';
import { createAuthSessionPlan } from './auth-session.service';
import { buildInstallationHostPlan } from './public-hosts.service';
import type { InstallationHostPlan } from './public-hosts.service.types';
import type { InstallPlan, InstallResult, InstallServiceInput } from './install.service.types';
import { resolveOrganizationSlug } from './organization-slug.service';
import { login } from './login.service';
import type { LoginServiceResult } from './login.service.types';
import type { OrganizationRow } from '../queries/organizations.query.types';

export async function install(input: InstallServiceInput): Promise<InstallResult> {
  const config: ApiConfig = getApiConfig();
  const plan: InstallPlan = buildInstallPlan(input, config);
  const operation: OperationRecord | null = await withInitialInstallationGuard(
    async (tx: InstallTransaction): Promise<OperationRecord> =>
      await insertInitialInstallationWithExecutor(
        tx,
        await buildInitialInstallationInput(input, plan),
        buildInstallOperationInput(plan),
      ),
  );

  if (operation === null) {
    return await resumeExistingInstall(input, plan, config);
  }
  await synchronizeEdgeAppAccessState();

  return buildInstallResult(input, plan, operation);
}

function buildInstallPlan(input: InstallServiceInput, config: ApiConfig): InstallPlan {
  const hostPlan: InstallationHostPlan = buildInstallationHostPlan(input.baseDomain, config);
  const organizationId: string = createId('org');
  const principalId: string = createId('prn');

  return {
    baseDomain: hostPlan.baseDomain,
    dnsRecords: hostPlan.dnsRecords,
    adminAssignmentId: createId('asg'),
    organizationMembershipId: createId('mem'),
    organizationId,
    organizationSlug: resolveOrganizationSlug(input.organizationName, input.organizationSlug),
    compartmentUrl: hostPlan.compartmentUrl,
    principalId,
    session: createAuthSessionPlan(
      {
        authMethodKind: 'password',
        oidcProviderId: null,
        organizationId,
        principalId,
      },
      config,
    ),
  };
}

async function buildInitialInstallationInput(
  input: InstallServiceInput,
  plan: InstallPlan,
): Promise<CreateInitialInstallationInput> {
  return {
    adminAssignmentId: plan.adminAssignmentId,
    organizationId: plan.organizationId,
    organizationMembershipId: plan.organizationMembershipId,
    organizationName: input.organizationName,
    organizationSlug: plan.organizationSlug,
    passwordHash: await argon2.hash(input.adminPassword),
    principalEmail: input.adminEmail,
    principalId: plan.principalId,
    sessionExpiresAt: plan.session.expiresAt,
    sessionId: plan.session.sessionId,
    sessionTokenHash: plan.session.tokenHash,
  };
}

function buildInstallOperationInput(plan: InstallPlan): InsertOperationInput {
  return {
    actorPrincipalId: plan.principalId,
    completedAt: new Date(),
    organizationId: plan.organizationId,
    status: 'succeeded',
    summary: `Installed compartment with organization ${plan.organizationSlug}`,
    targetId: plan.organizationId,
    targetType: 'organization',
    type: 'compartment.install',
  };
}

function buildInstallResult(input: InstallServiceInput, plan: InstallPlan, operation: OperationRecord): InstallResult {
  return {
    adminEmail: input.adminEmail,
    baseDomain: plan.baseDomain,
    createdOwner: true,
    dnsRecords: plan.dnsRecords,
    operation,
    organizationId: plan.organizationId,
    organizationName: input.organizationName,
    organizationSlug: plan.organizationSlug,
    principalId: plan.principalId,
    sessionId: plan.session.sessionId,
    compartmentUrl: plan.compartmentUrl,
    sessionToken: plan.session.sessionToken,
  };
}

async function resumeExistingInstall(
  input: InstallServiceInput,
  plan: InstallPlan,
  config: ApiConfig,
): Promise<InstallResult> {
  assertExistingInstallDomain(plan, config);
  const authenticated: LoginServiceResult = await authenticateExistingOwner(input);
  const organization: OrganizationRow = requireExistingInstallOrganization(input, plan, authenticated);
  const operation: OperationRecord | undefined = await findOperationRecordByType('compartment.install');
  assertOriginalInstallOwner(authenticated, organization, operation);
  await synchronizeEdgeAppAccessState();
  return buildRepeatedInstallResult(plan, authenticated, organization, operation);
}

function buildRepeatedInstallResult(
  plan: InstallPlan,
  authenticated: LoginServiceResult,
  organization: OrganizationRow,
  operation: OperationRecord,
): InstallResult {
  return {
    adminEmail: authenticated.principalEmail,
    baseDomain: plan.baseDomain,
    compartmentUrl: plan.compartmentUrl,
    createdOwner: false,
    dnsRecords: plan.dnsRecords,
    operation,
    organizationId: organization.id,
    organizationName: organization.name,
    organizationSlug: organization.slug,
    principalId: authenticated.principalId,
    sessionId: authenticated.sessionId,
    sessionToken: authenticated.sessionToken,
  };
}

function assertExistingInstallDomain(plan: InstallPlan, config: ApiConfig): void {
  if (plan.baseDomain !== config.baseDomain) {
    throw createAlreadyInstalledError();
  }
}

function requireExistingInstallOrganization(
  input: InstallServiceInput,
  plan: InstallPlan,
  authenticated: LoginServiceResult,
): OrganizationRow {
  const organization: OrganizationRow | undefined = authenticated.organizations.find(
    (candidate: OrganizationRow): boolean =>
      candidate.name === input.organizationName && candidate.slug === plan.organizationSlug,
  );
  if (organization === undefined) {
    throw createAlreadyInstalledError();
  }
  return organization;
}

function assertOriginalInstallOwner(
  authenticated: LoginServiceResult,
  organization: OrganizationRow,
  operation: OperationRecord | undefined,
): asserts operation is OperationRecord {
  if (operation?.actorPrincipalId !== authenticated.principalId || operation.targetId !== organization.id) {
    throw createAlreadyInstalledError();
  }
}

async function authenticateExistingOwner(input: InstallServiceInput): Promise<LoginServiceResult> {
  try {
    return await login({ email: input.adminEmail, password: input.adminPassword });
  } catch {
    throw createAlreadyInstalledError();
  }
}
