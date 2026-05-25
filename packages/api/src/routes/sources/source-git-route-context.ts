import type { FastifyRequest } from 'fastify';
import type { GitSourceContextInput } from '../../services/git-source/git-source.service.types';

export function buildGitSourceRouteContext(request: FastifyRequest): GitSourceContextInput {
  return {
    actor: request.actor,
    organizationId: request.currentOrganization.id,
  };
}
