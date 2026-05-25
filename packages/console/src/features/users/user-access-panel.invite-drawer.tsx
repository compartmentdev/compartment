import { inviteUserResponseSchema } from '@compartment/contracts/browser';
import type { UseMutationResult } from '@tanstack/react-query';
import type { ChangeEvent, FormEvent, JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { requestBrowserApi } from '../../lib/browser-api';
import { normalizeBrowserActionErrorMessage, type BrowserActionFieldLabelMap } from '../../lib/browser-action-error';
import { useBrowserMutation } from '../../lib/browser-query-client';
import { usersApiPathname } from '../../routes/users/users-api-paths';
import { AccessDrawerErrorAlert } from '../access/access-drawer-error';
import { AccessDrawerDetailHeader } from '../access/access-drawer-detail-header';
import { requireBrowserAccessSelectedOrganizationSlug } from '../access/access-query';
import { AccessDrawerSection, AccessDrawerShell, useAccessDrawerCloseNavigation } from '../access/access-ui';
import type { UserAccessPanelState } from './user-access-panel.state';
import type { VisibleUserInvitationState } from './user-invitation';
import { buildUsersHref } from './users-query';

interface InviteUserDrawerProps {
  state: UserAccessPanelState;
}

interface InviteUserResult {
  invitation: InviteUserResultInvitation | null;
  user: {
    email: string;
  };
}

interface InviteUserResultInvitation {
  activationUrl: string;
  bootstrapExpiresAt: string;
}

type InviteUserMutation = UseMutationResult<InviteUserResult, Error, void>;

const inviteUserFormId: string = 'invite-user-form';
const inviteUserFieldLabels: BrowserActionFieldLabelMap = {
  email: 'email address',
};

export function InviteUserDrawer({ state }: Readonly<InviteUserDrawerProps>): JSX.Element {
  const mutation: InviteUserMutation = useInviteUserMutation(state);

  return (
    <AccessDrawerShell
      closeHref={buildUsersHref(state.data, { mode: 'list', selectedUserEmail: null })}
      footer={<InviteDrawerActions formId={inviteUserFormId} mutation={mutation} state={state} />}
      header={
        <AccessDrawerDetailHeader
          closeHref={buildUsersHref(state.data, { mode: 'list', selectedUserEmail: null })}
          eyebrow="Invite user"
          onNavigate={state.onNavigate}
          title="Invite user"
        />
      }
      onNavigate={state.onNavigate}
      title="Invite user"
    >
      <InviteUserForm mutation={mutation} state={state} />
    </AccessDrawerShell>
  );
}

function InviteUserForm({
  mutation,
  state,
}: Readonly<InviteUserDrawerProps & { mutation: InviteUserMutation }>): JSX.Element {
  return (
    <form id={inviteUserFormId} onSubmit={createInviteSubmitHandler(state, mutation)}>
      <AccessDrawerErrorAlert message={state.drawerErrorMessage} />
      <AccessDrawerSection separated={false} title="User">
        <InviteEmailField state={state} />
      </AccessDrawerSection>
    </form>
  );
}

function InviteEmailField({ state }: Readonly<InviteUserDrawerProps>): JSX.Element {
  return (
    <label className="block text-[13px] font-medium">
      <span className="mb-1 block text-[11px] leading-[14px] tracking-[0.033px] text-[var(--cpt-text-primary,#111212)]">
        Email
      </span>
      <Input
        className="h-7 text-[13px]"
        onChange={(event: ChangeEvent<HTMLInputElement>): void => state.setInviteEmail(event.target.value)}
        placeholder="name@example.com"
        required
        type="email"
        value={state.inviteEmail}
      />
    </label>
  );
}

function InviteDrawerActions({
  formId,
  mutation,
  state,
}: Readonly<InviteUserDrawerProps & { formId: string; mutation: InviteUserMutation }>): JSX.Element {
  const closeDrawer: () => void = useAccessDrawerCloseNavigation(
    buildUsersHref(state.data, { mode: 'list', selectedUserEmail: null }),
    state.onNavigate,
  );

  return (
    <div className="flex items-center justify-end gap-2">
      <Button onClick={closeDrawer} size="sm" type="button" variant="outline">
        Cancel
      </Button>
      <Button disabled={mutation.isPending} form={formId} size="sm" type="submit" variant="default">
        {mutation.isPending ? 'Inviting...' : 'Invite user'}
      </Button>
    </div>
  );
}

function createInviteSubmitHandler(
  state: UserAccessPanelState,
  mutation: InviteUserMutation,
): (event: FormEvent<HTMLFormElement>) => void {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (state.data.selectedOrganizationSlug === null || state.inviteEmail.trim() === '' || mutation.isPending) {
      return;
    }

    state.setDrawerErrorMessage(undefined);
    mutation.mutate();
  };
}

function useInviteUserMutation(state: UserAccessPanelState): InviteUserMutation {
  const organizationSlug: string = requireBrowserAccessSelectedOrganizationSlug(state.data.selectedOrganizationSlug);
  return useBrowserMutation<InviteUserResult>({
    mutation: async (): Promise<InviteUserResult> => await submitUserInvite(state, organizationSlug),
    mutationKey: ['console-access', 'users', organizationSlug, 'invite'],
    onError: (error: Error): void => {
      setInviteDrawerError(error, state);
    },
    onSuccess: (response: InviteUserResult): void => {
      applyInviteResponse(response, state, organizationSlug);
    },
  });
}

async function submitUserInvite(state: UserAccessPanelState, organizationSlug: string): Promise<InviteUserResult> {
  return await requestBrowserApi(usersApiPathname, inviteUserResponseSchema, {
    json: {
      email: state.inviteEmail.trim(),
    },
    currentOrganization: organizationSlug,
    method: 'POST',
  });
}

function applyInviteResponse(response: InviteUserResult, state: UserAccessPanelState, organizationSlug: string): void {
  state.setUserInvitationState(
    response.invitation === null
      ? createSsoOnlyInvitationState(response, organizationSlug)
      : createInvitationState(response, response.invitation, organizationSlug),
  );
  state.onNavigate(buildUsersHref(state.data, { mode: 'detail', selectedUserEmail: response.user.email }));
}

function createSsoOnlyInvitationState(
  response: InviteUserResult,
  organizationSlug: string,
): VisibleUserInvitationState {
  return {
    email: response.user.email,
    kind: 'sso_only',
    organizationSlug,
  };
}

function createInvitationState(
  response: InviteUserResult,
  invitation: InviteUserResultInvitation,
  organizationSlug: string,
): VisibleUserInvitationState {
  return {
    activationUrl: invitation.activationUrl,
    email: response.user.email,
    expiresAt: invitation.bootstrapExpiresAt,
    kind: 'activation_link',
    organizationSlug,
  };
}

function setInviteDrawerError(error: Error | undefined, state: UserAccessPanelState): void {
  state.setDrawerErrorMessage(normalizeBrowserActionErrorMessage(error, 'User action failed.', inviteUserFieldLabels));
}
