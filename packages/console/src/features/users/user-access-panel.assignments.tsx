import {
  type AccessAssignmentScopeType,
  type AccessAssignmentSummary,
  type AccessRoleSummary,
  type UserAccessDetail,
} from '@compartment/contracts/browser';
import { type ChangeEvent, type FormEvent, type JSX, type ReactNode } from 'react';
import type { BrowserUsersPageResult } from '../../services/browser-users.service.types';
import { Select } from '../../components/select';
import { formatBrowserAccessAssignmentScope } from '../../lib/access-assignment-browser';
import { Button } from '../../components/ui/button';
import { Plus } from '../../components/ui/icons';
import { formatAssignmentAccessSummary } from '../access/access-display';
import { AccessDrawerList, AccessDrawerListEmpty, AccessDrawerListRow } from '../access/access-drawer-list';
import {
  accessAssignmentConnectorClassName,
  accessAssignmentPrimaryRowClassName,
  accessAssignmentSubmitButtonClassName,
  AccessScopeInputs,
  isAccessScopeSelectionReady,
} from '../access/access-scope-inputs';
import {
  accessDrawerAssignmentRowClassName,
  accessDrawerRowActionButtonClassName,
  AccessDrawerSection,
} from '../access/access-ui';
import type { UserAccessPanelSetter } from './user-access-panel.actions';
import {
  type UserAssignmentMutation,
  useUserAssignmentCreateMutation,
  useUserAssignmentDeleteMutation,
} from './user-access-panel.assignment-mutations';

export interface UserDirectAssignmentsCardProps {
  access: UserAccessDetail;
  actions?: ReactNode;
  canManageRoles: boolean;
  data: BrowserUsersPageResult;
  environmentValues: string[];
  projectNames: string[];
  roleId: string;
  scopeType: AccessAssignmentScopeType;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
  setEnvironmentValues: (value: string[]) => void;
  setProjectNames: (value: string[]) => void;
  setRoleId: (value: string) => void;
  setScopeType: (value: AccessAssignmentScopeType) => void;
}

interface UserRoleSelectProps {
  availableRoles: AccessRoleSummary[];
  roleId: string;
  setRoleId: (value: string) => void;
}

interface UserScopeSelectProps {
  scopeType: AccessAssignmentScopeType;
  setScopeType: (value: AccessAssignmentScopeType) => void;
}

export interface UserDirectAssignmentRowProps {
  assignment: AccessAssignmentSummary;
  canManageRoles: boolean;
  data: BrowserUsersPageResult;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
}

export function UserDirectAssignmentsCard(props: Readonly<UserDirectAssignmentsCardProps>): JSX.Element {
  return (
    <AccessDrawerSection actions={props.actions} title="Direct assignments">
      <div className="space-y-4">
        {props.canManageRoles ? <UserDirectAssignmentForm {...props} /> : null}
        <UserDirectAssignmentRows
          assignments={props.access.directAssignments}
          canManageRoles={props.canManageRoles}
          data={props.data}
          setData={props.setData}
          setErrorMessage={props.setErrorMessage}
        />
      </div>
    </AccessDrawerSection>
  );
}

function UserDirectAssignmentForm(props: Readonly<UserDirectAssignmentsCardProps>): JSX.Element {
  const mutation: UserAssignmentMutation = useUserAssignmentCreateMutation(props);

  return (
    <form className="space-y-2" onSubmit={createUserAssignmentSubmitHandler(props, mutation)}>
      <div className={accessAssignmentPrimaryRowClassName}>
        <UserScopeSelect scopeType={props.scopeType} setScopeType={props.setScopeType} />
        <span aria-hidden="true" className={accessAssignmentConnectorClassName}>
          →
        </span>
        <UserRoleSelect availableRoles={props.data.availableRoles} roleId={props.roleId} setRoleId={props.setRoleId} />
        <UserDirectAssignmentSubmitButton isPending={mutation.isPending} isReady={isUserAssignmentFormReady(props)} />
      </div>
      <AccessScopeInputs
        environmentValues={props.environmentValues}
        projectNames={props.projectNames}
        scopeProjects={props.data.scopeProjects}
        scopeType={props.scopeType}
        setEnvironmentValues={props.setEnvironmentValues}
        setProjectNames={props.setProjectNames}
      />
    </form>
  );
}

function UserDirectAssignmentSubmitButton({
  isPending,
  isReady,
}: Readonly<{ isPending: boolean; isReady: boolean }>): JSX.Element {
  return (
    <Button
      className={accessAssignmentSubmitButtonClassName}
      disabled={!isReady || isPending}
      size="sm"
      type="submit"
      variant="default"
    >
      {isPending ? null : <Plus className="size-4" />}
      {isPending ? 'Adding...' : 'Add assignment'}
    </Button>
  );
}

function createUserAssignmentSubmitHandler(
  props: UserDirectAssignmentsCardProps,
  mutation: UserAssignmentMutation,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!isUserAssignmentFormReady(props) || mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}

function UserRoleSelect(props: Readonly<UserRoleSelectProps>): JSX.Element {
  return (
    <Select
      containerClassName="w-full"
      onChange={(event: ChangeEvent<HTMLSelectElement>): void => props.setRoleId(event.target.value)}
      required
      value={props.roleId}
    >
      <option value="">Select role</option>
      {props.availableRoles.map(
        (role: AccessRoleSummary): JSX.Element => (
          <option key={role.id} value={role.id}>
            {role.name}
          </option>
        ),
      )}
    </Select>
  );
}

function UserScopeSelect(props: Readonly<UserScopeSelectProps>): JSX.Element {
  return (
    <Select
      containerClassName="w-full"
      onChange={(event: ChangeEvent<HTMLSelectElement>): void =>
        props.setScopeType(event.target.value as AccessAssignmentScopeType)
      }
      value={props.scopeType}
    >
      <option value="organization">Organization</option>
      <option value="project">Project</option>
      <option value="environment">Environment</option>
    </Select>
  );
}

function UserDirectAssignmentRows({
  assignments,
  canManageRoles,
  data,
  setData,
  setErrorMessage,
}: Readonly<{
  assignments: AccessAssignmentSummary[];
  canManageRoles: boolean;
  data: BrowserUsersPageResult;
  setData: UserAccessPanelSetter;
  setErrorMessage: (value: string | undefined) => void;
}>): JSX.Element {
  return (
    <AccessDrawerList>
      {renderAssignmentRows(assignments, canManageRoles, data, setData, setErrorMessage)}
    </AccessDrawerList>
  );
}

function renderAssignmentRows(
  assignments: AccessAssignmentSummary[],
  canManageRoles: boolean,
  data: BrowserUsersPageResult,
  setData: UserAccessPanelSetter,
  setErrorMessage: (value: string | undefined) => void,
): JSX.Element[] {
  if (assignments.length === 0) {
    return [<AccessDrawerListEmpty key="empty" message="No direct assignments." />];
  }

  return assignments.map(
    (assignment: AccessAssignmentSummary): JSX.Element => (
      <UserDirectAssignmentRow
        assignment={assignment}
        canManageRoles={canManageRoles}
        data={data}
        key={assignment.id}
        setData={setData}
        setErrorMessage={setErrorMessage}
      />
    ),
  );
}

function UserDirectAssignmentRow(props: Readonly<UserDirectAssignmentRowProps>): JSX.Element {
  return (
    <AccessDrawerListRow className={accessDrawerAssignmentRowClassName}>
      <div className="text-[13px] font-semibold leading-[18px]">{props.assignment.roleName}</div>
      <div className="text-[12px] leading-4 text-[var(--cpt-text-secondary,#485259)]">
        {formatBrowserAccessAssignmentScope(props.assignment.scope)}
      </div>
      <div className="text-[12px] leading-4 text-[var(--cpt-text-secondary,#485259)]">
        {formatAssignmentAccessSummary(props.assignment, props.data.availableRoles)}
      </div>
      {props.canManageRoles ? <UserAssignmentRemoveButton props={props} /> : null}
    </AccessDrawerListRow>
  );
}

function isUserAssignmentFormReady(props: UserDirectAssignmentsCardProps): boolean {
  if (props.roleId === '') {
    return false;
  }

  return isAccessScopeSelectionReady(props.scopeType, props.projectNames, props.environmentValues);
}
function UserAssignmentRemoveButton({ props }: Readonly<{ props: UserDirectAssignmentRowProps }>): JSX.Element {
  const mutation: UserAssignmentMutation = useUserAssignmentDeleteMutation(props);

  return (
    <Button
      className={accessDrawerRowActionButtonClassName}
      disabled={mutation.isPending}
      onClick={createUserAssignmentDeleteHandler(mutation)}
      size="sm"
      type="button"
      variant="outline"
    >
      {mutation.isPending ? 'Removing...' : 'Remove'}
    </Button>
  );
}

function createUserAssignmentDeleteHandler(mutation: UserAssignmentMutation): () => void {
  return (): void => {
    if (mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}
