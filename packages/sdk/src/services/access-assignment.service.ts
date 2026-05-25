import {
  accessAssignmentListResponseSchema,
  accessAssignmentResponseSchema,
  compartmentAssignmentsPathname,
  createAccessAssignmentRequestSchema,
  type AccessAssignmentListResponse,
  type AccessAssignmentResponse,
  type CreateAccessAssignmentRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function listAccessAssignments(request: CompartmentRequester): Promise<AccessAssignmentListResponse> {
  return await request({
    method: 'GET',
    path: compartmentAssignmentsPathname,
    schema: accessAssignmentListResponseSchema,
  });
}

export async function createAccessAssignment(
  request: CompartmentRequester,
  body: CreateAccessAssignmentRequest,
): Promise<AccessAssignmentResponse> {
  return await request({
    body: createAccessAssignmentRequestSchema.parse(body),
    method: 'POST',
    path: compartmentAssignmentsPathname,
    schema: accessAssignmentResponseSchema,
  });
}

export async function deleteAccessAssignment(
  request: CompartmentRequester,
  assignmentId: string,
): Promise<AccessAssignmentResponse> {
  return await request({
    method: 'DELETE',
    path: `${compartmentAssignmentsPathname}/${encodeURIComponent(assignmentId)}`,
    schema: accessAssignmentResponseSchema,
  });
}
