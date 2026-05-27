import type { AccessGroupResponse } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type JSX, type MutableRefObject } from 'react';
import { Button } from '../../components/ui/button';
import { X } from '../../components/ui/icons';
import { Input } from '../../components/ui/input';
import { normalizeBrowserActionErrorMessage, type BrowserActionFieldLabelMap } from '../../lib/browser-action-error';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import {
  accessDrawerActionButtonClassName,
  accessDrawerFieldClassName,
  accessDrawerTextareaClassName,
  AccessDrawerSection,
  useAccessDrawerCloseNavigation,
} from '../access/access-ui';
import { handleGroupCreateAction } from './groups-page.actions';
import { buildGroupsPageHref } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';

interface CreateGroupDrawerProps {
  state: GroupsPageState;
}

export type CreateGroupMutation = UseMutationResult<AccessGroupResponse, Error, void>;

export interface CreateGroupFormState {
  description: string;
  name: string;
  setDescription: (value: string) => void;
  setName: (value: string) => void;
}

type GroupsDrawerMode = 'create' | 'detail' | 'list';

const createGroupFormId: string = 'create-group-form';
const createGroupFieldLabels: BrowserActionFieldLabelMap = {
  name: 'group name',
};

export function CreateGroupDrawerContent({
  formState,
  mutation,
  state,
}: Readonly<CreateGroupDrawerProps & { formState: CreateGroupFormState; mutation: CreateGroupMutation }>): JSX.Element {
  return (
    <form id={createGroupFormId} onSubmit={createGroupSubmitHandler(state, mutation)}>
      <AccessDrawerErrorAlert message={state.drawerErrorMessage} />
      <AccessDrawerSection separated={false} title="Summary">
        <GroupIdentityFields formState={formState} />
      </AccessDrawerSection>
    </form>
  );
}

function GroupIdentityFields({ formState }: Readonly<{ formState: CreateGroupFormState }>): JSX.Element {
  return (
    <div className="space-y-3">
      <GroupNameField formState={formState} />
      <GroupDescriptionField formState={formState} />
    </div>
  );
}

function GroupNameField({ formState }: Readonly<{ formState: CreateGroupFormState }>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Name
      </span>
      <Input
        className={accessDrawerFieldClassName}
        onChange={(event: ChangeEvent<HTMLInputElement>): void => formState.setName(event.target.value)}
        required
        value={formState.name}
      />
    </label>
  );
}

function GroupDescriptionField({ formState }: Readonly<{ formState: CreateGroupFormState }>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Description
      </span>
      <textarea
        className={`min-h-[68px] ${accessDrawerTextareaClassName}`}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => formState.setDescription(event.target.value)}
        value={formState.description}
      />
    </label>
  );
}

function GroupDrawerActions({
  formId,
  mutation,
  state,
}: Readonly<CreateGroupDrawerProps & { formId: string; mutation: CreateGroupMutation }>): JSX.Element {
  const closeDrawer: () => void = useAccessDrawerCloseNavigation(
    buildGroupsPageHref(state.data, null),
    state.onNavigate,
  );

  return (
    <div className="flex items-center justify-end gap-2">
      <GroupDrawerCancelButton closeDrawer={closeDrawer} />
      <GroupDrawerSubmitButton formId={formId} isPending={mutation.isPending} />
    </div>
  );
}

export function CreateGroupDrawerFooter({
  mutation,
  state,
}: Readonly<CreateGroupDrawerProps & { mutation: CreateGroupMutation }>): JSX.Element {
  return <GroupDrawerActions formId={createGroupFormId} mutation={mutation} state={state} />;
}

function GroupDrawerCancelButton({ closeDrawer }: Readonly<{ closeDrawer: () => void }>): JSX.Element {
  return (
    <Button className={accessDrawerActionButtonClassName} onClick={closeDrawer} size="sm" type="button" variant="soft">
      <X className="size-4" />
      Cancel
    </Button>
  );
}

function GroupDrawerSubmitButton({ formId, isPending }: Readonly<{ formId: string; isPending: boolean }>): JSX.Element {
  return (
    <Button
      className={accessDrawerActionButtonClassName}
      disabled={isPending}
      form={formId}
      size="sm"
      type="submit"
      variant="success"
    >
      {isPending ? 'Creating...' : 'Create group'}
    </Button>
  );
}

function createGroupSubmitHandler(
  state: GroupsPageState,
  mutation: CreateGroupMutation,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (state.data.selectedOrganizationSlug === null || mutation.isPending) {
      return;
    }

    state.setDrawerErrorMessage(undefined);
    mutation.mutate();
  };
}

export function useCreateGroupMutation(state: GroupsPageState, formState: CreateGroupFormState): CreateGroupMutation {
  return useBrowserMutation<AccessGroupResponse>({
    mutation: async (): Promise<AccessGroupResponse> =>
      await handleGroupCreateAction(state.data, formState.description, formState.name),
    mutationKey: ['console-access', 'groups', state.data.selectedOrganizationSlug ?? 'unselected', 'create'],
    onError: (error: Error): void => {
      setGroupCreateError(error, state);
    },
    onSuccess: (response: AccessGroupResponse): void => {
      state.onNavigate(buildGroupsPageHref(state.data, response.group.id));
    },
  });
}

function setGroupCreateError(error: Error, state: GroupsPageState): void {
  state.setDrawerErrorMessage(
    normalizeBrowserActionErrorMessage(error, 'Group action failed.', createGroupFieldLabels),
  );
}

export function useCreateGroupFormState(state: GroupsPageState): CreateGroupFormState {
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const previousModeRef: MutableRefObject<GroupsDrawerMode> = useRef(state.data.mode);
  const previousOrganizationSlugRef: MutableRefObject<string | null> = useRef(state.data.selectedOrganizationSlug);

  useEffect((): void => {
    const didEnterCreate: boolean = previousModeRef.current !== 'create' && state.data.mode === 'create';
    const organizationChanged: boolean = previousOrganizationSlugRef.current !== state.data.selectedOrganizationSlug;

    if (state.data.mode === 'create' && (didEnterCreate || organizationChanged)) {
      setName('');
      setDescription('');
    }

    previousModeRef.current = state.data.mode;
    previousOrganizationSlugRef.current = state.data.selectedOrganizationSlug;
  }, [state.data.mode, state.data.selectedOrganizationSlug]);

  return { description, name, setDescription, setName };
}

export function CreateGroupDrawerHeader({ state }: Readonly<CreateGroupDrawerProps>): JSX.Element {
  return (
    <AccessDrawerDetailHeader
      closeHref={buildGroupsPageHref(state.data, null)}
      eyebrow="Create group"
      onNavigate={state.onNavigate}
      title="Create group"
    />
  );
}
