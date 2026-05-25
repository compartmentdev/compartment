import {
  deleteAccessAssignmentWithExecutor,
  findAccessAssignmentByIdWithExecutor,
} from '../queries/rbac-assignments.query';
import type { AccessAssignmentRow, RbacTransaction } from '../queries/rbac.query.types';
import {
  assertSelfAdminAccessAssignmentDeletionAllowed,
  isOrganizationAdminPathAssignment,
} from './access-assignment-delete-guard.service';
import type { DeleteOrganizationAccessAssignmentInput } from './access-assignments.service.types';
import { runOrganizationAccessMutationTransaction } from './rbac-admin-invariant.service';

export async function deleteOrganizationAccessAssignment(
  input: DeleteOrganizationAccessAssignmentInput,
): Promise<void> {
  await runOrganizationAccessMutationTransaction({
    organizationId: input.organizationId,
    mutation: async (tx: RbacTransaction): Promise<void> => await deleteAccessAssignmentInTransaction(tx, input),
  });
}

async function deleteAccessAssignmentInTransaction(
  tx: RbacTransaction,
  input: DeleteOrganizationAccessAssignmentInput,
): Promise<void> {
  if ((await readOrganizationAdminPathAssignmentOrDeleteRegular(tx, input)) !== undefined) {
    await deleteOrganizationAdminPathAccessAssignment(tx, input);
  }
}

async function deleteOrganizationAdminPathAccessAssignment(
  tx: RbacTransaction,
  input: DeleteOrganizationAccessAssignmentInput,
): Promise<void> {
  const assignment: AccessAssignmentRow | undefined = await readOrganizationAdminPathAssignmentOrDeleteRegular(
    tx,
    input,
  );
  if (assignment === undefined) {
    return;
  }

  await assertSelfAdminAccessAssignmentDeletionAllowed(tx, input, assignment);
  await deleteAccessAssignmentWithExecutor(tx, input.organizationId, input.assignmentId);
}

async function readOrganizationAdminPathAssignmentOrDeleteRegular(
  tx: RbacTransaction,
  input: DeleteOrganizationAccessAssignmentInput,
): Promise<AccessAssignmentRow | undefined> {
  const assignment: AccessAssignmentRow | undefined = await findAccessAssignmentByIdWithExecutor(
    tx,
    input.organizationId,
    input.assignmentId,
  );
  if (assignment === undefined) {
    return undefined;
  }

  if (!(await isOrganizationAdminPathAssignment(tx, input.organizationId, assignment))) {
    await deleteAccessAssignmentWithExecutor(tx, input.organizationId, input.assignmentId);
    return undefined;
  }

  return assignment;
}
