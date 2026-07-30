export interface RegistryService {
  spec?: RegistryServiceSpec | undefined;
}

export interface RegistryServiceSpec {
  clusterIP?: string | undefined;
  clusterIPs?: string[] | undefined;
}

export interface RegistryDnsAnswer {
  address?: string | undefined;
}

export interface RegistryDnsProbeContainer {
  args: string[];
  command: string[];
  env: RegistryDnsProbeEnvironment[];
  image: string;
  name: string;
}

export interface RegistryDnsProbeEnvironment {
  name: string;
  value: string;
}
