import type { FastifyRequest } from 'fastify';
import { requireAnyGrantedPermission } from '../../services/access-scope.service';

export async function requireAnyResourceAccess(request: FastifyRequest): Promise<void> {
  await requireAnyGrantedPermission({
    organizationId: request.currentOrganization.id,
    permission: 'deployment.create',
    principalId: request.actor.principalId,
  });
}
