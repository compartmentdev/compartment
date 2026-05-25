import type {
  FirstDeployOnboardingSession,
  FirstDeployOnboardingStatusResponse,
  PatchFirstDeployOnboardingSessionRequest,
} from '@compartment/contracts';
import { createOnboardingSessionNotFoundError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { findLatestCliLoginAttemptByOnboardingSessionId } from '../queries/cli-login.query';
import type { CliLoginAttemptRow } from '../queries/cli-login.query.types';
import { listJoinedDeploymentsForEnvironmentRun } from '../queries/deployment-joined.query';
import { findLatestDeploymentRunByOnboardingSessionId } from '../queries/deployment-runs.query';
import type { DeploymentRunRow } from '../queries/deployment-runs.query.types';
import type { DeploymentJoinedRow, DeploymentRow } from '../queries/deployments.query.types';
import {
  createFirstDeployOnboardingSession,
  findFirstDeployOnboardingSessionForPrincipal,
  patchFirstDeployOnboardingSessionForPrincipal,
} from '../queries/onboarding-first-deploy.query';
import type { FirstDeployOnboardingSessionRow } from '../queries/onboarding-first-deploy.query.types';
import { getApiConfig } from '../runtime/runtime-access';
import {
  resolveFirstDeployDeploymentRowsStatus,
  type FirstDeployDeploymentStatusResolution as StatusResolution,
} from './onboarding-first-deploy-deployment-status.service';
import { toFirstDeployOnboardingSession } from './onboarding-first-deploy.presenter';

interface FirstDeployOnboardingContextInput {
  actorPrincipalId: string;
  organizationId: string;
  organizationSlug: string;
}

interface CreateFirstDeployOnboardingInput extends FirstDeployOnboardingContextInput {
  method?: 'cli' | undefined;
}

interface ReadFirstDeployOnboardingInput extends FirstDeployOnboardingContextInput {
  sessionId: string;
}

interface PatchFirstDeployOnboardingInput extends ReadFirstDeployOnboardingInput {
  patch: PatchFirstDeployOnboardingSessionRequest;
}

export async function createFirstDeployOnboarding(
  input: CreateFirstDeployOnboardingInput,
): Promise<FirstDeployOnboardingSession> {
  const now: Date = new Date();
  return toFirstDeployOnboardingSession(
    await createFirstDeployOnboardingSession({
      createdByPrincipalId: input.actorPrincipalId,
      id: createId('fdo'),
      method: input.method,
      organizationId: input.organizationId,
      updatedAt: now,
    }),
    input.organizationSlug,
  );
}

export async function readFirstDeployOnboarding(
  input: ReadFirstDeployOnboardingInput,
): Promise<FirstDeployOnboardingSession> {
  return toFirstDeployOnboardingSession(await requireFirstDeployOnboardingSession(input), input.organizationSlug);
}

export async function patchFirstDeployOnboarding(
  input: PatchFirstDeployOnboardingInput,
): Promise<FirstDeployOnboardingSession> {
  const now: Date = new Date();
  const patched: FirstDeployOnboardingSessionRow | undefined = await patchFirstDeployOnboardingSessionForPrincipal(
    input.organizationId,
    input.sessionId,
    input.actorPrincipalId,
    {
      method: input.patch.method,
      skippedAt: input.patch.skipped === true ? now : undefined,
      state: readPatchedState(input.patch),
      updatedAt: now,
    },
  );
  if (patched === undefined) {
    throw createOnboardingSessionNotFoundError();
  }

  return toFirstDeployOnboardingSession(patched, input.organizationSlug);
}

export async function readFirstDeployOnboardingStatus(
  input: ReadFirstDeployOnboardingInput,
): Promise<FirstDeployOnboardingStatusResponse> {
  const session: FirstDeployOnboardingSessionRow = await requireFirstDeployOnboardingSession(input);
  const status: StatusResolution = await resolveFirstDeployOnboardingStatus(session);
  return {
    session: toFirstDeployOnboardingSession(session, input.organizationSlug),
    status: status.status,
    statusText: status.statusText,
  };
}

async function requireFirstDeployOnboardingSession(
  input: ReadFirstDeployOnboardingInput,
): Promise<FirstDeployOnboardingSessionRow> {
  const session: FirstDeployOnboardingSessionRow | undefined = await findFirstDeployOnboardingSessionForPrincipal(
    input.organizationId,
    input.sessionId,
    input.actorPrincipalId,
  );
  if (session === undefined) {
    throw createOnboardingSessionNotFoundError();
  }

  return session;
}

async function resolveFirstDeployOnboardingStatus(session: FirstDeployOnboardingSessionRow): Promise<StatusResolution> {
  if (session.state === 'skipped') {
    return { status: 'type_required', statusText: 'First deploy onboarding was skipped.' };
  }
  if (session.method === null) {
    return { status: 'type_required', statusText: 'Choose CLI.' };
  }

  const deploymentStatus: StatusResolution | null = await resolveDeploymentStatus(session);
  if (deploymentStatus !== null) {
    return deploymentStatus;
  }

  return await resolveCliStatus(session);
}

async function resolveCliStatus(session: FirstDeployOnboardingSessionRow): Promise<StatusResolution> {
  const attempt: CliLoginAttemptRow | undefined = await findLatestCliLoginAttemptByOnboardingSessionId(
    session.id,
    session.organizationId,
  );
  if (attempt?.authenticatedAt !== null && attempt?.authenticatedAt !== undefined) {
    return { status: 'cli_login_authenticated', statusText: 'CLI login is confirmed.' };
  }

  return { status: 'cli_login_pending', statusText: 'Waiting for CLI login.' };
}

async function resolveDeploymentStatus(session: FirstDeployOnboardingSessionRow): Promise<StatusResolution | null> {
  const run: DeploymentRunRow | undefined = await findLatestDeploymentRunByOnboardingSessionId(
    session.id,
    session.organizationId,
  );
  if (run === undefined) {
    return null;
  }

  const deployments: DeploymentJoinedRow[] = await listJoinedDeploymentsForEnvironmentRun(
    run.environmentId,
    run.id,
    getApiConfig().baseDomain,
  );
  return resolveFirstDeployDeploymentRowsStatus(
    deployments.map((deployment: DeploymentJoinedRow): DeploymentRow => deployment.deployment),
  );
}

function readPatchedState(patch: PatchFirstDeployOnboardingSessionRequest): 'active' | 'skipped' | undefined {
  if (patch.skipped === true) {
    return 'skipped';
  }

  return undefined;
}
