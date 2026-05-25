export interface ResolvedRepositoryAccess {
  installation: {
    installationId: string;
  };
  privateKeyPem: string;
  registration: {
    appId: string | null;
    id: string;
  };
}
