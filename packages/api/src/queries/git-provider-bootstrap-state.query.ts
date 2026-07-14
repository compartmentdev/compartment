import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { gitProviderBootstrapStates, gitProviderRegistrations } from '../db/schema';
import { getApiDatabase } from '../runtime/runtime-access';
import { requirePersistedRow } from './persisted-row.query.shared';
import type {
  CreateGitProviderBootstrapStateInput,
  FindGitProviderBootstrapStateByIdInput,
  GitProviderBootstrapStateRow,
  GitProviderMutationTransaction,
  GitProviderReadExecutor,
  GitProviderWriteExecutor,
  PersistedGitProviderBootstrapStateRow,
} from './git-provider-registration.query.types';

interface PersistedGitProviderBootstrapStateScopeRow {
  registrationOrganizationId: string;
  state: PersistedGitProviderBootstrapStateRow;
}

export async function createGitProviderBootstrapState(
  executor: GitProviderWriteExecutor,
  input: CreateGitProviderBootstrapStateInput,
): Promise<GitProviderBootstrapStateRow> {
  const [state]: PersistedGitProviderBootstrapStateRow[] = await executor
    .insert(gitProviderBootstrapStates)
    .values({
      createdByPrincipalId: input.createdByPrincipalId,
      expiresAt: input.expiresAt,
      id: input.id,
      providerHost: input.providerHost,
      providerRegistrationId: input.providerRegistrationId,
      repositoryName: input.repositoryName,
      repositoryOwner: input.repositoryOwner,
      returnTo: input.returnTo,
      stateNonce: input.stateNonce,
    })
    .returning();

  return mapRequiredGitProviderBootstrapStateRow(
    requirePersistedRow(state, 'git provider bootstrap state'),
    input.organizationId,
  );
}

export async function findGitProviderBootstrapStateById(
  input: FindGitProviderBootstrapStateByIdInput,
): Promise<GitProviderBootstrapStateRow | undefined> {
  return await findGitProviderBootstrapStateByIdWithExecutor(getApiDatabase(), input);
}

export async function findGitProviderBootstrapStateByIdForPublicFlow(
  stateId: string,
): Promise<GitProviderBootstrapStateRow | undefined> {
  return await findGitProviderBootstrapStateByIdForPublicFlowWithExecutor(getApiDatabase(), stateId);
}

export async function findGitProviderBootstrapStateByIdForPublicFlowWithExecutor(
  executor: GitProviderReadExecutor,
  stateId: string,
): Promise<GitProviderBootstrapStateRow | undefined> {
  return await findGitProviderBootstrapStateScopeRow(executor, eq(gitProviderBootstrapStates.id, stateId));
}

export async function findGitProviderBootstrapStateByNonceWithExecutor(
  executor: GitProviderReadExecutor,
  stateNonce: string,
): Promise<GitProviderBootstrapStateRow | undefined> {
  return await findGitProviderBootstrapStateScopeRow(
    executor,
    and(eq(gitProviderBootstrapStates.stateNonce, stateNonce), isNull(gitProviderBootstrapStates.completedAt)),
  );
}

export async function markGitProviderBootstrapStateCompleted(
  executor: GitProviderWriteExecutor,
  organizationId: string,
  stateId: string,
  completedAt: Date,
): Promise<void> {
  const state: GitProviderBootstrapStateRow | undefined = await findGitProviderBootstrapStateByIdWithExecutor(
    executor,
    {
      bootstrapStateId: stateId,
      organizationId,
    },
  );
  if (state === undefined) {
    return;
  }

  await executor
    .update(gitProviderBootstrapStates)
    .set({ completedAt })
    .where(eq(gitProviderBootstrapStates.id, stateId));
}

export async function findGitProviderBootstrapStateByIdWithExecutor(
  executor: GitProviderReadExecutor,
  input: FindGitProviderBootstrapStateByIdInput,
): Promise<GitProviderBootstrapStateRow | undefined> {
  return await findGitProviderBootstrapStateScopeRow(
    executor,
    and(
      eq(gitProviderBootstrapStates.id, input.bootstrapStateId),
      eq(gitProviderRegistrations.organizationId, input.organizationId),
    ),
  );
}

export async function lockGitProviderBootstrapStateMutationWithExecutor(
  executor: GitProviderMutationTransaction,
  stateId: string,
): Promise<void> {
  await executor.execute(
    sql`select ${gitProviderBootstrapStates.id} from ${gitProviderBootstrapStates} where ${gitProviderBootstrapStates.id} = ${stateId} for update`,
  );
}

async function findGitProviderBootstrapStateScopeRow(
  executor: GitProviderReadExecutor,
  condition: SQL | undefined,
): Promise<GitProviderBootstrapStateRow | undefined> {
  const rows: PersistedGitProviderBootstrapStateScopeRow[] = await executor
    .select({
      registrationOrganizationId: gitProviderRegistrations.organizationId,
      state: gitProviderBootstrapStates,
    })
    .from(gitProviderBootstrapStates)
    .innerJoin(
      gitProviderRegistrations,
      eq(gitProviderRegistrations.id, gitProviderBootstrapStates.providerRegistrationId),
    )
    .where(condition)
    .limit(1);

  return mapGitProviderBootstrapStateScopeRow(rows[0]);
}

function mapGitProviderBootstrapStateScopeRow(
  row: PersistedGitProviderBootstrapStateScopeRow | undefined,
): GitProviderBootstrapStateRow | undefined {
  if (row === undefined) {
    return undefined;
  }

  return mapRequiredGitProviderBootstrapStateRow(row.state, row.registrationOrganizationId);
}

function mapRequiredGitProviderBootstrapStateRow(
  row: PersistedGitProviderBootstrapStateRow,
  organizationId: string,
): GitProviderBootstrapStateRow {
  return { ...row, organizationId };
}
