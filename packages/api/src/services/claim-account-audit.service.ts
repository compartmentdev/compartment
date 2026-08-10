import { listOrganizationRowsForPrincipal } from '../queries/organizations.query';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { recordAuditEvent } from './audit-events.service';
import type { RecordAccountClaimAuditInput } from './claim-account-audit.service.types';

/**
 * Recorded once per organization the principal belongs to, the way login audit events are, so a change of account
 * identity stays readable by the admins it affects and falls under their organization retention window.
 */
export async function recordAccountClaimAuditEvents(input: RecordAccountClaimAuditInput): Promise<void> {
  const organizations: OrganizationRow[] = await listOrganizationRowsForPrincipal(input.principalId);

  for (const organization of organizations) {
    await recordAuditEvent({
      actor: {
        email: input.previousEmail,
        principalId: input.principalId,
        sessionId: input.context.sessionId,
        sourceIp: input.context.sourceIp,
        transport: input.context.transport,
        type: 'user',
        userAgent: input.context.userAgent,
      },
      eventType: 'authentication.account_claimed',
      metadata: {
        email: input.email,
        previousEmail: input.previousEmail,
      },
      organizationId: organization.id,
      target: {
        displayName: input.email,
        id: input.principalId,
        type: 'principal',
      },
    });
  }
}
