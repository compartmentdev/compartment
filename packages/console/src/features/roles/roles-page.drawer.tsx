import type { PermissionKey } from '@compartment/contracts/browser';
import { useEffect, useState, type ChangeEvent, type FormEvent, type JSX } from 'react';
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
  accessDrawerFieldClassName,
  accessDrawerSectionDividerClassName,
  accessDrawerTextareaClassName,
  AccessDrawerSection,
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

export type RoleSubmitMutation = UseMutationResult<boolean, Error, void>;

export interface RoleEditorDraftState {
  description: string;
  name: string;
  selectedPermissions: PermissionKey[];
  setDescription: (value: string) => void;
  setName: (value: string) => void;
  setSelectedPermissions: (value: PermissionKey[] | ((current: PermissionKey[]) => PermissionKey[])) => void;
}

const roleEditorFormId: string = 'role-editor-form';

export function RoleEditorDrawerContent({
  editorState,
  mutation,
  state,
}: Readonly<RoleEditorDrawerProps & { editorState: RoleEditorDraftState; mutation: RoleSubmitMutation }>): JSX.Element {
  return (
    <form id={roleEditorFormId} onSubmit={createRoleSubmitHandler(mutation)}>
      <AccessDrawerErrorAlert message={state.drawerErrorMessage} />
      <RoleSummaryCard editorState={editorState} state={state} />
      <RolePermissionsSection editorState={editorState} state={state} />
    </form>
  );
}

function RoleSummaryCard({
  editorState,
  state,
}: Readonly<RoleEditorDrawerProps & { editorState: RoleEditorDraftState }>): JSX.Element {
  return (
    <AccessDrawerSection separated={false} title="General role settings">
      <div className={state.data.mode === 'edit' ? accessDrawerSectionDividerClassName : undefined}>
        <div className="space-y-2">
          <RoleNameField editorState={editorState} state={state} />
          <RoleDescriptionField editorState={editorState} state={state} />
        </div>
      </div>
    </AccessDrawerSection>
  );
}

function RoleNameField({
  editorState,
  state,
}: Readonly<RoleEditorDrawerProps & { editorState: RoleEditorDraftState }>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Role name
      </span>
      <Input
        className={accessDrawerFieldClassName}
        disabled={isSystemRole(state)}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => editorState.setName(event.target.value)}
        placeholder="Custom role"
        required
        value={editorState.name}
      />
    </label>
  );
}

function RoleDescriptionField({
  editorState,
  state,
}: Readonly<RoleEditorDrawerProps & { editorState: RoleEditorDraftState }>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Description
      </span>
      <textarea
        className={`min-h-[68px] ${accessDrawerTextareaClassName}`}
        disabled={isSystemRole(state)}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => editorState.setDescription(event.target.value)}
        placeholder="Write a short reasonable description about the role"
        value={editorState.description}
      />
    </label>
  );
}

function RolePermissionsSection({
  editorState,
  state,
}: Readonly<RoleEditorDrawerProps & { editorState: RoleEditorDraftState }>): JSX.Element {
  return (
    <AccessDrawerSection title="Permissions">
      <RolePermissionsEditorCard
        isDisabled={isSystemRole(state)}
        permissionKeys={state.data.permissionKeys}
        selectedPermissions={editorState.selectedPermissions}
        setSelectedPermissions={editorState.setSelectedPermissions}
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

export function RoleEditorDrawerFooter({
  mutation,
  state,
}: Readonly<RoleEditorDrawerProps & { mutation: RoleSubmitMutation }>): JSX.Element {
  return <RoleDrawerActions formId={roleEditorFormId} mutation={mutation} state={state} />;
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

export function useRoleSubmitMutation(state: RolesPageState, editorState: RoleEditorDraftState): RoleSubmitMutation {
  return useBrowserMutation<boolean>({
    mutation: async (): Promise<boolean> => await submitRoleEditorChange(state, editorState),
    mutationKey: readRoleSubmitMutationKey(state),
    onSuccess: (didSave: boolean): void => {
      if (didSave) {
        closeRolesDrawerAfterMutation(state);
      }
    },
  });
}

async function submitRoleEditorChange(state: RolesPageState, editorState: RoleEditorDraftState): Promise<boolean> {
  return await handleRoleSubmit(
    state.data,
    state.data.role,
    editorState.description,
    editorState.name,
    editorState.selectedPermissions,
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

export function readRoleEditorTitle(state: RolesPageState): string {
  return state.data.mode === 'create' ? 'Create role' : (state.data.role?.name ?? 'Role');
}

export function RoleEditorDrawerHeader({ state }: Readonly<RoleEditorDrawerProps>): JSX.Element {
  return (
    <AccessDrawerDetailHeader
      closeHref={buildRolesPageHref(state.data)}
      eyebrow={readRoleEditorEyebrow(state)}
      onNavigate={state.onNavigate}
    />
  );
}

function readRoleEditorEyebrow(state: RolesPageState): string {
  return state.data.mode === 'create' ? 'Create role' : 'Edit role';
}

function isSystemRole(state: RolesPageState): boolean {
  return state.data.role?.kind === 'system';
}

export function useRoleEditorDraftState(state: RolesPageState): RoleEditorDraftState {
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionKey[]>([]);

  useEffect((): void => {
    syncRoleEditorDraft(state, setDescription, setName, setSelectedPermissions);
  }, [state.data.mode, state.data.roleId, state.data.selectedOrganizationSlug]);

  return {
    description,
    name,
    selectedPermissions,
    setDescription,
    setName,
    setSelectedPermissions,
  };
}

function syncRoleEditorDraft(
  state: RolesPageState,
  setDescription: (value: string) => void,
  setName: (value: string) => void,
  setSelectedPermissions: (value: PermissionKey[]) => void,
): void {
  if (state.data.mode === 'create') {
    setName('');
    setDescription('');
    setSelectedPermissions([]);
    return;
  }

  setName(state.data.role?.name ?? '');
  setDescription(state.data.role?.description ?? '');
  setSelectedPermissions(state.data.role?.permissionKeys ?? []);
}
