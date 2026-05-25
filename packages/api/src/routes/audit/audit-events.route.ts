import {
  auditEventExportQuerySchema,
  auditEventListQuerySchema,
  auditEventListResponseSchema,
  compartmentAuditEventsExportPathname,
  compartmentAuditEventsPathname,
  type AuditEventExportFormat,
  type AuditEventExportQuery,
  type AuditEventListQuery,
  type AuditEventListResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import {
  exportOrganizationAuditEvents,
  listOrganizationAuditEvents,
  recordAuditEvent,
} from '../../services/audit-events.service';
import { buildAuditExportCreatedAuditMetadata } from '../../services/audit-event-metadata.service';
import {
  createCurrentOrganizationRouteOptions,
  createCurrentOrganizationRouteResponseOptions,
} from '../protected/current-organization-route';
import { buildAuditEventForRequest } from './audit-event-route-context';

export function registerAuditEventRoutes(app: ApiApp): void {
  registerAuditEventListRoute(app);
  registerAuditEventExportRoute(app);
}

function registerAuditEventListRoute(app: ApiApp): void {
  app.get(
    compartmentAuditEventsPathname,
    createCurrentOrganizationRouteResponseOptions('organization.audit.read', { 200: auditEventListResponseSchema }),
    handleAuditEventList,
  );
}

function registerAuditEventExportRoute(app: ApiApp): void {
  app.post(
    compartmentAuditEventsExportPathname,
    createCurrentOrganizationRouteOptions('organization.audit.read'),
    handleAuditEventExport,
  );
}

async function handleAuditEventList(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: AuditEventListQuery = parseRequestValue(
    auditEventListQuerySchema,
    request.query,
    'invalid_audit_events_query',
  );
  const response: AuditEventListResponse = await listOrganizationAuditEvents({
    ...query,
    organizationId: request.currentOrganization.id,
  });

  return await reply.send(response);
}

async function handleAuditEventExport(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: AuditEventExportQuery = parseRequestValue(
    auditEventExportQuerySchema,
    request.query,
    'invalid_audit_events_export_query',
  );
  const body: string = await exportOrganizationAuditEvents({
    ...query,
    organizationId: request.currentOrganization.id,
  });
  await recordAuditEvent(
    buildAuditEventForRequest(request, {
      eventType: 'audit.export.created',
      metadata: buildAuditExportCreatedAuditMetadata({ format: query.format }),
      target: {
        displayName: null,
        id: request.currentOrganization.id,
        type: 'organization',
      },
    }),
  );

  return await reply.type(readAuditExportContentType(query.format)).send(body);
}

function readAuditExportContentType(format: AuditEventExportFormat): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8';
}
