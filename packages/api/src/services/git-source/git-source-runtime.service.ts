import { createGitSourceRequestInvalidError } from '../../errors/api-business-error';
import { findGitProviderRegistrationByWebhookTarget } from '../../queries/git-provider-registration.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { readGitHubWebhookSecret, verifyGitHubWebhookSignature } from './git-source-runtime.support';
import {
  handleGitHubInstallationRepositoriesWebhook,
  handleGitHubInstallationWebhook,
} from './git-source-runtime-lifecycle.service';
import { handleGitHubPushWebhook } from './git-source-runtime-push.service';
import type { HandleGitHubSourceWebhookInput } from './git-source-runtime.service.types';

export async function handleGitHubSourceWebhook(input: HandleGitHubSourceWebhookInput): Promise<void> {
  const registration: GitProviderRegistrationRow = requireGitProviderRegistration(
    await findGitProviderRegistrationByWebhookTarget({
      organizationId: input.organizationId,
      registrationId: input.registrationId,
    }),
  );
  verifyGitHubWebhookSignature(input.rawBody, input.signature, readGitHubWebhookSecret(registration));
  await handleVerifiedGitHubSourceWebhook(registration, input);
}

async function handleVerifiedGitHubSourceWebhook(
  registration: GitProviderRegistrationRow,
  input: HandleGitHubSourceWebhookInput,
): Promise<void> {
  if (input.eventType === 'push') {
    await handleGitHubPushWebhook(registration, input);
    return;
  }
  if (input.eventType === 'installation') {
    await handleGitHubInstallationWebhook(registration, input.body);
    return;
  }
  if (input.eventType === 'installation_repositories') {
    await handleGitHubInstallationRepositoriesWebhook(registration, input.body);
  }
}

function requireGitProviderRegistration(
  registration: GitProviderRegistrationRow | undefined,
): GitProviderRegistrationRow {
  if (registration === undefined) {
    throw createGitSourceRequestInvalidError('Git provider registration was not found for the webhook request.');
  }

  return registration;
}
