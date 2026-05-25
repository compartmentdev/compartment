import type { AccessGroupResponse } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import type { ChangeEvent, FormEvent, JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { normalizeBrowserActionErrorMessage, type BrowserActionFieldLabelMap } from '../../lib/browser-action-error';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import { AccessDrawerSection, AccessDrawerShell, useAccessDrawerCloseNavigation } from '../access/access-ui';
import { handleGroupCreateAction } from './groups-page.actions';
import { buildGroupsPageHref } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';

interface CreateGroupDrawerProps {
  state: GroupsPageState;
}

type CreateGroupMutation = UseMutationResult<AccessGroupResponse, Error, void>;

const createGroupFormId: string = 'create-group-form';
const createGroupFieldLabels: BrowserActionFieldLabelMap = {
  name: 'group name',
};

export function CreateGroupDrawer({ state }: Readonly<CreateGroupDrawerProps>): JSX.Element {
  const mutation: CreateGroupMutation = useCreateGroupMutation(state);

  return (
    <AccessDrawerShell
      closeHref={buildGroupsPageHref(state.data, null)}
      footer={<GroupDrawerActions formId={createGroupFormId} mutation={mutation} state={state} />}
      header={readCreateGroupDrawerHeader(state)}
      onNavigate={state.onNavigate}
      title="Create group"
    >
      <form id={createGroupFormId} onSubmit={createGroupSubmitHandler(state, mutation)}>
        <AccessDrawerErrorAlert message={state.drawerErrorMessage} />
        <AccessDrawerSection separated={false} title="Summary">
          <GroupIdentityFields state={state} />
        </AccessDrawerSection>
      </form>
    </AccessDrawerShell>
  );
}

function GroupIdentityFields({ state }: Readonly<CreateGroupDrawerProps>): JSX.Element {
  return (
    <div className="space-y-3">
      <GroupNameField state={state} />
      <GroupDescriptionField state={state} />
    </div>
  );
}

function GroupNameField({ state }: Readonly<CreateGroupDrawerProps>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Name
      </span>
      <Input
        className="h-7 text-[13px]"
        onChange={(event: ChangeEvent<HTMLInputElement>): void => state.setNewGroupName(event.target.value)}
        required
        value={state.newGroupName}
      />
    </label>
  );
}

function GroupDescriptionField({ state }: Readonly<CreateGroupDrawerProps>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Description
      </span>
      <textarea
        className="min-h-[68px] w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => state.setNewGroupDescription(event.target.value)}
        value={state.newGroupDescription}
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
      <Button onClick={closeDrawer} size="sm" type="button" variant="outline">
        Cancel
      </Button>
      <Button disabled={mutation.isPending} form={formId} size="sm" type="submit" variant="default">
        {mutation.isPending ? 'Creating...' : 'Create group'}
      </Button>
    </div>
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

function useCreateGroupMutation(state: GroupsPageState): CreateGroupMutation {
  return useBrowserMutation<AccessGroupResponse>({
    mutation: async (): Promise<AccessGroupResponse> =>
      await handleGroupCreateAction(state.data, state.newGroupDescription, state.newGroupName),
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

function readCreateGroupDrawerHeader(state: GroupsPageState): JSX.Element {
  return (
    <AccessDrawerDetailHeader
      closeHref={buildGroupsPageHref(state.data, null)}
      eyebrow="Create group"
      onNavigate={state.onNavigate}
      title="Create group"
    />
  );
}
