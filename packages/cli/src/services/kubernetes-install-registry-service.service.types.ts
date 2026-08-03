export interface RegistryService {
  spec?: RegistryServiceSpec | undefined;
}

export interface RegistryServiceSpec {
  clusterIP?: string | undefined;
  clusterIPs?: string[] | undefined;
}
