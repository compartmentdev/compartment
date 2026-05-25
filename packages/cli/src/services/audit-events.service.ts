import type { AuditEventExportQuery, AuditEventListQuery, AuditEventListResponse } from '@compartment/contracts';
import { exportAuditEvents, listAuditEvents } from '@compartment/sdk';
import {
  createAuthenticatedBinaryRequester,
  createAuthenticatedRequester,
  requireOrganizationContext,
} from './context.service';
import type { AuthenticatedContext } from './context.types';

export async function listOrganizationAuditEvents(
  context: AuthenticatedContext,
  query: AuditEventListQuery,
): Promise<AuditEventListResponse> {
  return await listAuditEvents(
    createAuthenticatedRequester(requireOrganizationContext(context), {
      includeCurrentOrganization: true,
    }),
    query,
  );
}

export async function exportOrganizationAuditEvents(
  context: AuthenticatedContext,
  query: AuditEventExportQuery,
): Promise<Buffer> {
  return await exportAuditEvents(
    createAuthenticatedBinaryRequester(requireOrganizationContext(context), {
      includeCurrentOrganization: true,
    }),
    query,
  );
}
