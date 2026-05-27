import { type ChangeEvent, type FormEvent, type JSX } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { IconTile } from '../../components/ui/icon-tile';
import { Pencil, UsersRound, X } from '../../components/ui/icons';
import { Input } from '../../components/ui/input';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import {
  accessDrawerActionButtonClassName,
  accessDrawerHeaderActionButtonClassName,
  accessDrawerSummaryDescriptionClassName,
  accessDrawerSummaryIdentityClassName,
  accessDrawerSummaryStackClassName,
  accessDrawerSummaryTitleClassName,
  accessDrawerTextareaClassName,
  AccessDrawerSection,
} from '../access/access-ui';
import { canManageBrowserGroups } from '../console/console-access';
import { handleGroupRenameAction } from './groups-page.actions';
import { buildGroupsPageHref } from './groups-page.href';
import type { GroupsPageState } from './groups-page.state';

interface GroupDrawerHeaderProps {
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  state: GroupsPageState;
}

interface GroupSummaryCardProps {
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  state: GroupsPageState;
}

type GroupRenameMutation = UseMutationResult<boolean, Error, void>;

export function GroupDrawerHeader({ isEditing, setIsEditing, state }: Readonly<GroupDrawerHeaderProps>): JSX.Element {
  return (
    <AccessDrawerDetailHeader
      action={
        canManageBrowserGroups(state.data.currentOrganizationPermissions) ? (
          <GroupHeaderEditButton isEditing={isEditing} setIsEditing={setIsEditing} state={state} />
        ) : undefined
      }
      closeHref={buildGroupsPageHref(state.data, null)}
      eyebrow="Group"
      onNavigate={state.onNavigate}
    />
  );
}

export function GroupSummaryCard({ isEditing, setIsEditing, state }: Readonly<GroupSummaryCardProps>): JSX.Element {
  return (
    <AccessDrawerSection separated={false}>
      <GroupSummaryIdentity state={state} />
      {isEditing ? <GroupSummaryForm setIsEditing={setIsEditing} state={state} /> : null}
    </AccessDrawerSection>
  );
}

function GroupSummaryIdentity({ state }: Readonly<{ state: GroupsPageState }>): JSX.Element {
  return (
    <div className={accessDrawerSummaryStackClassName}>
      <div className={accessDrawerSummaryIdentityClassName}>
        <IconTile icon={UsersRound} />
        <h3 className={accessDrawerSummaryTitleClassName}>{state.selectedGroup?.name ?? 'Group'}</h3>
      </div>
      <p className={accessDrawerSummaryDescriptionClassName}>
        {readGroupHeaderDescription(state.selectedGroup?.description ?? null)}
      </p>
    </div>
  );
}

function GroupHeaderEditButton({
  isEditing,
  setIsEditing,
  state,
}: Readonly<{
  isEditing: boolean;
  setIsEditing: (value: boolean) => void;
  state: GroupsPageState;
}>): JSX.Element {
  const editLabel: string = isEditing ? 'Cancel' : 'Edit';
  const onEditToggle: () => void = createEditToggleHandler(isEditing, setIsEditing, state);

  return (
    <Button
      className={accessDrawerHeaderActionButtonClassName}
      onClick={onEditToggle}
      size="sm"
      type="button"
      variant="soft"
    >
      {isEditing ? <X className="size-4" /> : <Pencil className="size-4" />}
      {editLabel}
    </Button>
  );
}

function GroupSummaryForm({
  setIsEditing,
  state,
}: Readonly<{ setIsEditing: (value: boolean) => void; state: GroupsPageState }>): JSX.Element {
  const mutation: GroupRenameMutation = useGroupRenameMutation(setIsEditing, state);

  return (
    <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={createSubmitHandler(mutation)}>
      <GroupNameField state={state} />
      <GroupDescriptionField state={state} />
      <GroupSummaryActions isPending={mutation.isPending} onCancel={createEditCancelHandler(setIsEditing, state)} />
    </form>
  );
}

function GroupNameField({ state }: Readonly<{ state: GroupsPageState }>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      Name
      <Input
        className="mt-1"
        onChange={(event: ChangeEvent<HTMLInputElement>): void => state.setGroupName(event.target.value)}
        required
        value={state.groupName}
      />
    </label>
  );
}

function GroupDescriptionField({ state }: Readonly<{ state: GroupsPageState }>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      Description
      <textarea
        className={`mt-1 min-h-24 ${accessDrawerTextareaClassName}`}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>): void => state.setGroupDescription(event.target.value)}
        value={state.groupDescription}
      />
    </label>
  );
}

function GroupSummaryActions({
  isPending,
  onCancel,
}: Readonly<{ isPending: boolean; onCancel: () => void }>): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <GroupSummarySaveButton isPending={isPending} />
      <GroupSummaryCancelButton isPending={isPending} onCancel={onCancel} />
    </div>
  );
}

function GroupSummarySaveButton({ isPending }: Readonly<{ isPending: boolean }>): JSX.Element {
  return (
    <Button
      className={accessDrawerActionButtonClassName}
      disabled={isPending}
      size="sm"
      type="submit"
      variant="success"
    >
      {isPending ? 'Saving...' : 'Save group'}
    </Button>
  );
}

function GroupSummaryCancelButton({
  isPending,
  onCancel,
}: Readonly<{ isPending: boolean; onCancel: () => void }>): JSX.Element {
  return (
    <Button
      className={accessDrawerActionButtonClassName}
      disabled={isPending}
      onClick={onCancel}
      size="sm"
      type="button"
      variant="soft"
    >
      <X className="size-4" />
      Cancel
    </Button>
  );
}

function createEditToggleHandler(
  isEditing: boolean,
  setIsEditing: (value: boolean) => void,
  state: GroupsPageState,
): () => void {
  return (): void => {
    resetGroupIdentityFields(state);
    setIsEditing(!isEditing);
  };
}

function createEditCancelHandler(setIsEditing: (value: boolean) => void, state: GroupsPageState): () => void {
  return (): void => {
    resetGroupIdentityFields(state);
    setIsEditing(false);
  };
}

function useGroupRenameMutation(setIsEditing: (value: boolean) => void, state: GroupsPageState): GroupRenameMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);
  const groupId: string = requireSelectedGroupId(state);
  return useBrowserMutation<boolean>({
    mutation: async (): Promise<boolean> =>
      await handleGroupRenameAction(
        state.data,
        groupId,
        state.groupDescription,
        state.groupName,
        state.setData,
        state.setDrawerErrorMessage,
      ),
    mutationKey: ['console-access', 'groups', organizationSlug, groupId, 'rename'],
    onSuccess: (didSave: boolean): void => {
      if (didSave) {
        setIsEditing(false);
      }
    },
  });
}

function requireSelectedGroupId(state: GroupsPageState): string {
  if (state.selectedGroup === undefined) {
    throw new Error('Expected selected group.');
  }

  return state.selectedGroup.id;
}

function createSubmitHandler(mutation: GroupRenameMutation): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }

    mutation.mutate();
  };
}

function readGroupHeaderDescription(description: string | null): string {
  return description === null || description.trim() === '' ? 'No description.' : description;
}

function resetGroupIdentityFields(state: GroupsPageState): void {
  state.setGroupName(state.selectedGroup?.name ?? '');
  state.setGroupDescription(state.selectedGroup?.description ?? '');
}
