import type { JSX } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { accessDrawerActionButtonClassName } from '../access/access-ui';

interface BaseVisibleUserInvitationState {
  email: string;
  errorMessage?: string | undefined;
  noticeMessage?: string | undefined;
  organizationSlug: string;
}

export interface ActivationLinkUserInvitationState extends BaseVisibleUserInvitationState {
  activationUrl: string;
  expiresAt: string;
  kind: 'activation_link';
}

export interface SsoOnlyUserInvitationState extends BaseVisibleUserInvitationState {
  kind: 'sso_only';
}

export type VisibleUserInvitationState = ActivationLinkUserInvitationState | SsoOnlyUserInvitationState;

interface UserInvitationPanelProps {
  onCopy?: (() => void) | undefined;
  onDismiss?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  state: VisibleUserInvitationState;
}

export function UserInvitationPanel({
  onCopy,
  onDismiss,
  onOpen,
  state,
}: Readonly<UserInvitationPanelProps>): JSX.Element {
  return (
    <div className="space-y-2">
      <UserInvitationDescription state={state} />
      {state.kind === 'activation_link' ? (
        <Input className="h-8 text-[12px]" readOnly value={state.activationUrl} />
      ) : null}
      <UserInvitationActions onCopy={onCopy} onDismiss={onDismiss} onOpen={onOpen} state={state} />
      <UserInvitationError state={state} />
    </div>
  );
}

function UserInvitationDescription({ state }: Readonly<Pick<UserInvitationPanelProps, 'state'>>): JSX.Element {
  return (
    <p className="m-0 text-[12px] leading-4 text-[var(--cpt-text-secondary,#485259)]">
      {state.kind === 'activation_link'
        ? `Send this activation link to ${state.email}. Expires at ${state.expiresAt}.`
        : `This organization uses SSO only. Ask ${state.email} to sign in with SSO to finish access.`}
    </p>
  );
}

function UserInvitationActions({
  onCopy,
  onDismiss,
  onOpen,
  state,
}: Readonly<Pick<UserInvitationPanelProps, 'onCopy' | 'onDismiss' | 'onOpen' | 'state'>>): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state.kind === 'activation_link' ? <UserInvitationActionButton label="Copy link" onClick={onCopy} /> : null}
      {state.kind === 'activation_link' ? <UserInvitationActionButton label="Open link" onClick={onOpen} /> : null}
      <UserInvitationActionButton label="Dismiss" onClick={onDismiss} />
      {state.noticeMessage === undefined ? null : (
        <p className="m-0 text-[12px] text-[var(--toast-text-success)]">{state.noticeMessage}</p>
      )}
    </div>
  );
}

function UserInvitationActionButton({
  label,
  onClick,
}: Readonly<{ label: string; onClick?: (() => void) | undefined }>): JSX.Element | null {
  if (onClick === undefined) {
    return null;
  }

  return (
    <Button className={accessDrawerActionButtonClassName} onClick={onClick} size="sm" type="button" variant="soft">
      {label}
    </Button>
  );
}

function UserInvitationError({ state }: Readonly<Pick<UserInvitationPanelProps, 'state'>>): JSX.Element | null {
  return state.errorMessage === undefined ? null : (
    <p className="m-0 text-[12px] text-[var(--toast-text-error)]">{state.errorMessage}</p>
  );
}

export async function copyUserInvitationLink(
  invitationState: ActivationLinkUserInvitationState,
  setInvitationState: (value: VisibleUserInvitationState | null) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(invitationState.activationUrl);
    setInvitationState({
      ...invitationState,
      errorMessage: undefined,
      noticeMessage: 'Link copied.',
    });
  } catch {
    setInvitationState({
      ...invitationState,
      errorMessage: 'Could not copy link.',
      noticeMessage: undefined,
    });
  }
}

export function openUserInvitationLink(invitationState: ActivationLinkUserInvitationState): void {
  window.open(invitationState.activationUrl, '_blank', 'noopener,noreferrer');
}

export function shouldKeepUserInvitationState(
  current: VisibleUserInvitationState | null,
  organizationSlug: string | null,
): boolean {
  return current !== null && current.organizationSlug === organizationSlug;
}
