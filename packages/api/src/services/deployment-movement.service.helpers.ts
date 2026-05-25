import type { ResolvedEnvironmentContext } from './deployments.service.types';
import { resolveExistingEnvironmentContext, resolveOrCreateEnvironmentContext } from './deployment-context.service';
import type { PromoteDeploymentInput } from './deployment-movement.service.types';

export async function resolvePromotionEnvironmentContext(
  input: PromoteDeploymentInput,
  environmentName: string,
): Promise<ResolvedEnvironmentContext> {
  return await resolveExistingEnvironmentContext(
    input.actorPrincipalId,
    input.organizationSlug,
    input.projectName,
    environmentName,
    'deployment.promote',
  );
}

export async function resolveWritablePromotionEnvironmentContext(
  input: PromoteDeploymentInput,
): Promise<ResolvedEnvironmentContext> {
  return await resolveOrCreateEnvironmentContext(
    input.actorPrincipalId,
    input.organizationSlug,
    input.projectName,
    input.targetEnvironmentName,
    'deployment.promote',
  );
}
