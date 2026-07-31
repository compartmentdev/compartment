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

export interface RegistryDnsAnswerCandidate {
  address?: string | undefined;
}

export interface RegistryDnsProbeOutputCandidate {
  answers?: RegistryDnsAnswerCandidate[] | undefined;
  error?: RegistryDnsProbeErrorCandidate | undefined;
  status?: string | undefined;
}

export interface RegistryDnsProbeErrorCandidate {
  code?: string | undefined;
  message?: string | undefined;
}

export interface RegistryDnsProbeError {
  code: string;
  message: string;
}

export interface RegistryDnsProbeFailure {
  error: RegistryDnsProbeError;
  status: 'unresolved';
}

export interface RegistryDnsProbeSuccess {
  answers: RegistryDnsAnswer[];
  status: 'resolved';
}

export type RegistryDnsProbeOutput = RegistryDnsProbeFailure | RegistryDnsProbeSuccess;

export interface RegistryDnsProbePod {
  status?: RegistryDnsProbePodStatus | undefined;
}

export interface RegistryDnsProbePodStatus {
  phase?: string | undefined;
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
