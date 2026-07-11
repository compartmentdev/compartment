import type { GitLabJsonObject } from './gitlab-http.adapter.types';

export interface HandleGitLabSourceWebhookInput {
  body: GitLabJsonObject;
  eventType: string;
  organizationId: string;
  providerDeliveryId: string;
  registrationId: string;
  token: string;
}
