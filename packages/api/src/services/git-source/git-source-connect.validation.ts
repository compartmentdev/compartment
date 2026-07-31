export interface ResolvedRepositoryAccess {
  providerInstallationId: string | null;
  providerWebhookId: string | null;
  registration: {
    id: string;
  };
}
