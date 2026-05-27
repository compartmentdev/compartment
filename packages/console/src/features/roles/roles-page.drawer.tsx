import type { ChangeEvent, FormEvent, JSX } from 'react';
import type { MutationKey, UseMutationResult } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { X } from '../../components/ui/icons';
import { Input } from '../../components/ui/input';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import {
  accessDrawerActionButtonClassName,
  accessDrawerTextareaClassName,
  AccessDrawerSection,
  AccessDrawerShell,
  useAccessDrawerCloseNavigation,
} from '../access/access-ui';
import { handleRoleSubmit } from './roles-page.actions';
import { closeRolesDrawerAfterMutation } from './roles-page.navigation';
import { RolePermissionsCard as RolePermissionsEditorCard } from './roles-page.permissions';
import { buildRolesPageHref } from './roles-page.query';
import type { RolesPageState } from './roles-page.state';

interface RoleEditorDrawerProps {
  state: RolesPageState;
}

type RoleSubmitMutation = UseMutationResult<boolean, Error, void>;

const roleEditorFormId: string = 'role-editor-form';

export function RoleEditorDrawer({ state }: Readonly<RoleEditorDrawerProps>): JSX.Element {
  const mutation: RoleSubmitMutation = useRoleSubmitMutation(state);

  return (
    <AccessDrawerShell
      closeHref={buildRolesPageHref(state.data)}
      footer={<RoleDrawerActions formId={roleEditorFormId} mutation={mutation} state={state} />}
      header={
        <AccessDrawerDetailHeader
          closeHref={buildRolesPageHref(state.data)}
          eyebrow={readRoleEditorEyebrow(state)}
          onNavigate={state.onNavigate}
        />
      }
      onNavigate={state.onNavigate}
      title={readRoleEditorTitle(state)}
    >
      <form id={roleEditorFormId} onSubmit={createRoleSubmitHandler(mutation)}>
        <AccessDrawerErrorAlert message={state.drawerErrorMessage} />
        <RoleSummaryCard state={state} />
        <RolePermissionsSection state={state} />
      </form>
    </AccessDrawerShell>
  );
}

function RoleSummaryCard({ state }: Readonly<RoleEditorDrawerProps>): JSX.Element {
  return (
    <AccessDrawerSection separated={false} title="General role settings">
      <div className="space-y-2">
        <RoleNameField state={state} />
        <RoleDescriptionField state={state} />
      </div>
    </AccessDrawerSection>
  );
}

function RoleNameField({ state }: Readonly<RoleEditorDrawerProps>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Role name
      </span>
      <Input
        disabled={isSystemRole(state)}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => state.setName(event.target.value)}
        placeholder="Custom role"
        required
        value={state.name}
      />
    </label>
  );
}

function RoleDescriptionField({ state }: Readonly<RoleEditorDrawerProps>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Description
      </span>
      <textarea
        className={`min-h-[68px] ${accessDrawerTextareaClassName}`}
        disabled={isSystemRole(state)}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => state.setDescription(event.target.value)}
        placeholder="Write a short reasonable description about the role"
        value={state.description}
      />
    </label>
  );
}

function RolePermissionsSection({ state }: Readonly<RoleEditorDrawerProps>): JSX.Element {
  return (
    <AccessDrawerSection title="Permissions">
      <RolePermissionsEditorCard
        isDisabled={isSystemRole(state)}
        permissionKeys={state.data.permissionKeys}
        selectedPermissions={state.selectedPermissions}
        setSelectedPermissions={state.setSelectedPermissions}
      />
    </AccessDrawerSection>
  );
}

function RoleDrawerActions({
  formId,
  mutation,
  state,
}: Readonly<RoleEditorDrawerProps & { formId: string; mutation: RoleSubmitMutation }>): JSX.Element {
  if (isSystemRole(state)) {
    return <RoleBackAction state={state} />;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <RoleBackAction state={state} />
      <Button
        className={accessDrawerActionButtonClassName}
        disabled={mutation.isPending}
        form={formId}
        size="sm"
        type="submit"
        variant="success"
      >
        {readRoleSubmitLabel(state, mutation.isPending)}
      </Button>
    </div>
  );
}

function RoleBackAction({ state }: Readonly<RoleEditorDrawerProps>): JSX.Element {
  const closeDrawer: () => void = useAccessDrawerCloseNavigation(buildRolesPageHref(state.data), state.onNavigate);

  return (
    <Button className={accessDrawerActionButtonClassName} onClick={closeDrawer} size="sm" type="button" variant="soft">
      {isSystemRole(state) ? null : <X className="size-4" />}
      {isSystemRole(state) ? 'Back' : 'Cancel'}
    </Button>
  );
}

function useRoleSubmitMutation(state: RolesPageState): RoleSubmitMutation {
  return useBrowserMutation<boolean>({
    mutation: async (): Promise<boolean> => await submitRoleEditorChange(state),
    mutationKey: readRoleSubmitMutationKey(state),
    onSuccess: (didSave: boolean): void => {
      if (didSave) {
        closeRolesDrawerAfterMutation(state);
      }
    },
  });
}

async function submitRoleEditorChange(state: RolesPageState): Promise<boolean> {
  return await handleRoleSubmit(
    state.data,
    state.data.role,
    state.description,
    state.name,
    state.selectedPermissions,
    state.setData,
    state.setDrawerErrorMessage,
  );
}

function readRoleSubmitMutationKey(state: RolesPageState): MutationKey {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);
  const roleId: string = state.data.role === null ? 'create' : state.data.role.id;
  return ['console-access', 'roles', organizationSlug, roleId, 'submit'];
}

function createRoleSubmitHandler(mutation: RoleSubmitMutation): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}

function readRoleSubmitLabel(state: RolesPageState, isPending: boolean): string {
  if (isPending) {
    return state.data.mode === 'create' ? 'Creating...' : 'Saving...';
  }

  return state.data.mode === 'create' ? 'Create new role' : 'Save role';
}

function readRoleEditorTitle(state: RolesPageState): string {
  return state.data.mode === 'create' ? 'Create role' : (state.data.role?.name ?? 'Role');
}

function readRoleEditorEyebrow(state: RolesPageState): string {
  return state.data.mode === 'create' ? 'Create role' : 'Edit role';
}

function isSystemRole(state: RolesPageState): boolean {
  return state.data.role?.kind === 'system';
}
