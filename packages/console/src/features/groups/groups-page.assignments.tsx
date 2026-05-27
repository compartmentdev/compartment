import {
  type AccessAssignmentScopeType,
  type AccessAssignmentSummary,
  type AccessGroupSummary,
  type AccessRoleSummary,
} from '@compartment/contracts/browser';
import { type ChangeEvent, type FormEvent, type JSX, type ReactNode } from 'react';
import { Select } from '../../components/select';
import { Button } from '../../components/ui/button';
import type { BrowserGroupsPageResult } from '../../services/browser-groups.service.types';
import { formatBrowserAccessAssignmentScope } from '../../lib/access-assignment-browser';
import { formatAssignmentAccessSummary } from '../access/access-display';
import { AccessDrawerList, AccessDrawerListEmpty, AccessDrawerListRow } from '../access/access-drawer-list';
import {
  AccessAssignmentSubmitButton,
  accessAssignmentConnectorClassName,
  accessAssignmentPrimaryRowClassName,
  AccessScopeInputs,
  isAccessScopeSelectionReady,
} from '../access/access-scope-inputs';
import {
  accessDrawerAssignmentRowClassName,
  accessDrawerRowActionButtonClassName,
  AccessDrawerSection,
} from '../access/access-ui';
import type { GroupsPageSetter } from './groups-page.actions';
import {
  type GroupAssignmentMutation,
  useGroupAssignmentCreateMutation,
  useGroupAssignmentDeleteMutation,
} from './groups-page.assignment-mutations';

export interface GroupAssignmentsCardProps {
  actions?: ReactNode;
  canManageRoles: boolean;
  data: BrowserGroupsPageResult;
  environmentValues: string[];
  groupAssignments: AccessAssignmentSummary[];
  projectNames: string[];
  roleId: string;
  scopeType: AccessAssignmentScopeType;
  selectedGroup: AccessGroupSummary;
  setData: GroupsPageSetter;
  setErrorMessage: (value: string | undefined) => void;
  setEnvironmentValues: (value: string[]) => void;
  setProjectNames: (value: string[]) => void;
  setRoleId: (value: string) => void;
  setScopeType: (value: AccessAssignmentScopeType) => void;
}

export interface GroupAssignmentRowProps {
  assignment: AccessAssignmentSummary;
  canManageRoles: boolean;
  data: BrowserGroupsPageResult;
  setData: GroupsPageSetter;
  setErrorMessage: (value: string | undefined) => void;
}

interface GroupRoleSelectProps {
  roleId: string;
  roles: AccessRoleSummary[];
  setRoleId: (value: string) => void;
}

interface GroupScopeSelectProps {
  scopeType: AccessAssignmentScopeType;
  setScopeType: (value: AccessAssignmentScopeType) => void;
}

export function GroupAssignmentsCard(props: Readonly<GroupAssignmentsCardProps>): JSX.Element {
  return (
    <AccessDrawerSection actions={props.actions} title="Assignments">
      <div className="space-y-3">
        {props.canManageRoles ? <GroupAssignmentsForm {...props} /> : null}
        <GroupAssignmentRows
          assignments={props.groupAssignments}
          canManageRoles={props.canManageRoles}
          data={props.data}
          setData={props.setData}
          setErrorMessage={props.setErrorMessage}
        />
      </div>
    </AccessDrawerSection>
  );
}

function GroupAssignmentsForm(props: Readonly<GroupAssignmentsCardProps>): JSX.Element {
  const mutation: GroupAssignmentMutation = useGroupAssignmentCreateMutation(props);
  const isSubmitDisabled: boolean = !isGroupAssignmentFormReady(props) || mutation.isPending;
  return (
    <form className="space-y-2" onSubmit={createGroupAssignmentSubmitHandler(props, mutation)}>
      <div className={accessAssignmentPrimaryRowClassName}>
        <GroupScopeSelect scopeType={props.scopeType} setScopeType={props.setScopeType} />
        <span aria-hidden="true" className={accessAssignmentConnectorClassName}>
          {'→'}
        </span>
        <GroupRoleSelect roleId={props.roleId} roles={props.data.roles} setRoleId={props.setRoleId} />
        <AccessAssignmentSubmitButton disabled={isSubmitDisabled} isPending={mutation.isPending} />
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

function GroupScopeSelect(props: Readonly<GroupScopeSelectProps>): JSX.Element {
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

function GroupRoleSelect(props: Readonly<GroupRoleSelectProps>): JSX.Element {
  return (
    <Select
      containerClassName="w-full"
      onChange={(event: ChangeEvent<HTMLSelectElement>): void => props.setRoleId(event.target.value)}
      required
      value={props.roleId}
    >
      <option value="">Select role</option>
      {props.roles.map(
        (role: AccessRoleSummary): JSX.Element => (
          <option key={role.id} value={role.id}>
            {role.name}
          </option>
        ),
      )}
    </Select>
  );
}

function createGroupAssignmentSubmitHandler(
  props: GroupAssignmentsCardProps,
  mutation: GroupAssignmentMutation,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!isGroupAssignmentFormReady(props) || mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}

function isGroupAssignmentFormReady(props: GroupAssignmentsCardProps): boolean {
  if (props.roleId === '') {
    return false;
  }

  return isAccessScopeSelectionReady(props.scopeType, props.projectNames, props.environmentValues);
}

function GroupAssignmentRows({
  assignments,
  canManageRoles,
  data,
  setData,
  setErrorMessage,
}: Readonly<{
  assignments: AccessAssignmentSummary[];
  canManageRoles: boolean;
  data: BrowserGroupsPageResult;
  setData: GroupsPageSetter;
  setErrorMessage: (value: string | undefined) => void;
}>): JSX.Element {
  return (
    <AccessDrawerList>
      {renderGroupAssignmentRows(assignments, canManageRoles, data, setData, setErrorMessage)}
    </AccessDrawerList>
  );
}

function renderGroupAssignmentRows(
  assignments: AccessAssignmentSummary[],
  canManageRoles: boolean,
  data: BrowserGroupsPageResult,
  setData: GroupsPageSetter,
  setErrorMessage: (value: string | undefined) => void,
): JSX.Element[] {
  if (assignments.length === 0) {
    return [<AccessDrawerListEmpty key="empty" message="No assignments." />];
  }

  return assignments.map(
    (assignment: AccessAssignmentSummary): JSX.Element => (
      <GroupAssignmentRow
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

function GroupAssignmentRow(props: Readonly<GroupAssignmentRowProps>): JSX.Element {
  return (
    <AccessDrawerListRow className={accessDrawerAssignmentRowClassName}>
      <div className="text-[13px] font-semibold leading-[18px]">{props.assignment.roleName}</div>
      <div className="text-[12px] leading-4 text-[var(--cpt-text-secondary,#485259)]">
        {formatBrowserAccessAssignmentScope(props.assignment.scope)}
      </div>
      <div className="text-[12px] leading-4 text-[var(--cpt-text-secondary,#485259)]">
        {formatAssignmentAccessSummary(props.assignment, props.data.roles)}
      </div>
      {props.canManageRoles ? <GroupAssignmentRemoveButton props={props} /> : null}
    </AccessDrawerListRow>
  );
}

function GroupAssignmentRemoveButton({ props }: Readonly<{ props: GroupAssignmentRowProps }>): JSX.Element {
  const mutation: GroupAssignmentMutation = useGroupAssignmentDeleteMutation(props);

  return (
    <Button
      className={accessDrawerRowActionButtonClassName}
      disabled={mutation.isPending}
      onClick={createGroupAssignmentDeleteHandler(mutation)}
      size="sm"
      type="button"
      variant="outline"
    >
      {mutation.isPending ? 'Removing...' : 'Remove'}
    </Button>
  );
}

function createGroupAssignmentDeleteHandler(mutation: GroupAssignmentMutation): () => void {
  return (): void => {
    if (mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}
