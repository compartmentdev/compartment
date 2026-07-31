import type { OrganizationRow } from '../queries/organizations.query.types';
import { findOrganizationBySlug, listOrganizationRowsForPrincipalEmail } from '../queries/organizations.query';
import { recordAuditEvent } from './audit-events.service';
import type {
  LoginAuditActor,
  RecordFailedLoginAuditInput,
  RecordSuccessfulLoginAuditInput,
} from './authentication-audit.service.types';

export async function recordSuccessfulLoginAuditEvents(input: RecordSuccessfulLoginAuditInput): Promise<void> {
  const actor: LoginAuditActor = {
    ...input.context,
    email: input.result.principalEmail,
    principalId: input.result.principalId,
    sessionId: input.result.sessionId,
    type: 'user',
  };
  for (const organization of readLoginAuditOrganizations(input)) {
    await recordLoginAuditEvent(organization, actor, 'succeeded');
  }
}

function readLoginAuditOrganizations(input: RecordSuccessfulLoginAuditInput): OrganizationRow[] {
  const organizationId: string | null = input.result.authSession.organizationId;
  return organizationId === null
    ? input.result.organizations
    : input.result.organizations.filter((organization: OrganizationRow): boolean => organization.id === organizationId);
}

export async function recordFailedLoginAuditEvent(input: RecordFailedLoginAuditInput): Promise<void> {
  const organizations: OrganizationRow[] = await listOrganizationRowsForPrincipalEmail(input.email);
  const targets: OrganizationRow[] = await readFailedLoginAuditOrganizations(input, organizations);
  for (const organization of targets) {
    await recordLoginAuditEvent(
      organization,
      {
        ...input.context,
        email: input.email,
        principalId: null,
        sessionId: null,
        type: 'user',
      },
      'failed',
    );
  }
}

async function readFailedLoginAuditOrganizations(
  input: RecordFailedLoginAuditInput,
  memberships: OrganizationRow[],
): Promise<OrganizationRow[]> {
  if (input.organizationSlug === undefined) {
    return memberships;
  }
  const organization: OrganizationRow | undefined = await findOrganizationBySlug(input.organizationSlug);
  return organization === undefined ? [] : [organization];
}

async function recordLoginAuditEvent(
  organization: OrganizationRow,
  actor: LoginAuditActor,
  status: 'failed' | 'succeeded',
): Promise<void> {
  await recordAuditEvent({
    actor,
    eventType: 'authentication.login',
    metadata: {},
    organizationId: organization.id,
    status,
    target: {
      displayName: organization.slug,
      id: organization.id,
      type: 'organization',
    },
  });
}
