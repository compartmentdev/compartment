export interface ResolvedProviderRegistration {
  id: string;
  providerHost: string;
}

export interface ResolvedRepositoryAccess {
  providerInstallationId: string | null;
  providerWebhookId: string | null;
  registration: ResolvedProviderRegistration;
}
