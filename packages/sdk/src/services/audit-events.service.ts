import {
  auditEventExportQuerySchema,
  auditEventListQuerySchema,
  auditEventListResponseSchema,
  compartmentAuditEventsExportPathname,
  compartmentAuditEventsPathname,
  type AuditEventExportQuery,
  type AuditEventListQuery,
  type AuditEventListResponse,
} from '@compartment/contracts';
import type { CompartmentBinaryRequester, CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function listAuditEvents(
  request: CompartmentRequester,
  query: AuditEventListQuery = {},
): Promise<AuditEventListResponse> {
  const parsedQuery: AuditEventListQuery = auditEventListQuerySchema.parse(query);

  return await request<AuditEventListResponse, undefined>({
    method: 'GET',
    path: buildAuditEventsListPath(parsedQuery),
    schema: auditEventListResponseSchema,
  });
}

export async function exportAuditEvents(
  request: CompartmentBinaryRequester,
  query: AuditEventExportQuery,
): Promise<Buffer> {
  const parsedQuery: AuditEventExportQuery = auditEventExportQuerySchema.parse(query);

  return await request({
    method: 'POST',
    path: buildAuditEventsExportPath(parsedQuery),
  });
}

function buildAuditEventsListPath(query: AuditEventListQuery): string {
  return buildListPath(compartmentAuditEventsPathname, [
    { name: 'actor', value: query.actor },
    { name: 'eventType', value: query.eventType },
    { name: 'from', value: query.from },
    { name: 'page', value: query.page },
    { name: 'perPage', value: query.perPage },
    { name: 'project', value: query.project },
    { name: 'targetType', value: query.targetType },
    { name: 'to', value: query.to },
  ]);
}

function buildAuditEventsExportPath(query: AuditEventExportQuery): string {
  return buildListPath(compartmentAuditEventsExportPathname, [
    { name: 'actor', value: query.actor },
    { name: 'eventType', value: query.eventType },
    { name: 'format', value: query.format },
    { name: 'from', value: query.from },
    { name: 'project', value: query.project },
    { name: 'targetType', value: query.targetType },
    { name: 'to', value: query.to },
  ]);
}
