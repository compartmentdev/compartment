import { and, eq } from 'drizzle-orm';
import { onboardingFirstDeploySessions } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  CreateFirstDeployOnboardingSessionInput,
  FirstDeployOnboardingSessionMethod,
  FirstDeployOnboardingSessionRow,
  FirstDeployOnboardingSessionState,
  PatchFirstDeployOnboardingSessionInput,
  PersistedFirstDeployOnboardingSessionRow,
} from './onboarding-first-deploy.query.types';

export async function createFirstDeployOnboardingSession(
  input: CreateFirstDeployOnboardingSessionInput,
): Promise<FirstDeployOnboardingSessionRow> {
  const [session]: PersistedFirstDeployOnboardingSessionRow[] = await getApiDatabase()
    .insert(onboardingFirstDeploySessions)
    .values({
      createdAt: input.updatedAt,
      createdByPrincipalId: input.createdByPrincipalId,
      id: input.id,
      method: input.method ?? null,
      organizationId: input.organizationId,
      state: 'active',
      updatedAt: input.updatedAt,
    })
    .returning();

  return toFirstDeployOnboardingSessionRow(requirePersistedRow(session, 'first deploy onboarding session'));
}

export async function findFirstDeployOnboardingSessionForPrincipal(
  organizationId: string,
  sessionId: string,
  createdByPrincipalId: string,
): Promise<FirstDeployOnboardingSessionRow | undefined> {
  const [session]: PersistedFirstDeployOnboardingSessionRow[] = await getApiDatabase()
    .select()
    .from(onboardingFirstDeploySessions)
    .where(
      and(
        eq(onboardingFirstDeploySessions.createdByPrincipalId, createdByPrincipalId),
        eq(onboardingFirstDeploySessions.id, sessionId),
        eq(onboardingFirstDeploySessions.organizationId, organizationId),
      ),
    )
    .limit(1);

  return session === undefined ? undefined : toFirstDeployOnboardingSessionRow(session);
}

export async function patchFirstDeployOnboardingSessionForPrincipal(
  organizationId: string,
  sessionId: string,
  createdByPrincipalId: string,
  input: PatchFirstDeployOnboardingSessionInput,
): Promise<FirstDeployOnboardingSessionRow | undefined> {
  const [session]: PersistedFirstDeployOnboardingSessionRow[] = await getApiDatabase()
    .update(onboardingFirstDeploySessions)
    .set(toFirstDeployOnboardingSessionPatch(input))
    .where(
      and(
        eq(onboardingFirstDeploySessions.createdByPrincipalId, createdByPrincipalId),
        eq(onboardingFirstDeploySessions.id, sessionId),
        eq(onboardingFirstDeploySessions.organizationId, organizationId),
      ),
    )
    .returning();

  return session === undefined ? undefined : toFirstDeployOnboardingSessionRow(session);
}

function toFirstDeployOnboardingSessionPatch(
  input: PatchFirstDeployOnboardingSessionInput,
): Partial<PersistedFirstDeployOnboardingSessionRow> {
  return {
    ...(input.method !== undefined ? { method: input.method } : {}),
    ...(input.skippedAt !== undefined ? { skippedAt: input.skippedAt } : {}),
    ...(input.state !== undefined ? { state: input.state } : {}),
    updatedAt: input.updatedAt,
  };
}

function toFirstDeployOnboardingSessionRow(
  row: PersistedFirstDeployOnboardingSessionRow,
): FirstDeployOnboardingSessionRow {
  return {
    createdAt: row.createdAt,
    createdByPrincipalId: row.createdByPrincipalId,
    id: row.id,
    method: readMethod(row.method),
    organizationId: row.organizationId,
    skippedAt: row.skippedAt,
    state: readSessionState(row.state),
    updatedAt: row.updatedAt,
  };
}

function readMethod(value: string | null): FirstDeployOnboardingSessionMethod | null {
  if (value === null || value === 'cli') {
    return value;
  }

  throw new Error(`Unsupported first deploy onboarding method ${value}.`);
}

function readSessionState(value: string): FirstDeployOnboardingSessionState {
  if (value === 'active' || value === 'skipped') {
    return value;
  }

  throw new Error(`Unsupported first deploy onboarding state ${value}.`);
}
