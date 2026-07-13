export interface KubeContainerLifecycle {
  preStop: KubeExecLifecycleHandler;
}

export interface KubeExecLifecycleHandler {
  exec: KubeExecAction;
}

export interface KubeExecAction {
  command: string[];
}

export interface KubeContainerPort {
  containerPort: number;
  name: string;
  protocol?: 'TCP';
}

export interface KubeHttpGetAction {
  path: string;
  port: string;
}

export interface KubeReadinessProbe {
  failureThreshold: number;
  httpGet?: KubeHttpGetAction | undefined;
  initialDelaySeconds?: number | undefined;
  periodSeconds: number;
  successThreshold: number;
  tcpSocket?: KubeTcpSocketAction | undefined;
  timeoutSeconds: number;
}

export interface KubeTcpSocketAction {
  port: number | string;
}

export interface ApplicationReadinessConfig {
  path: string;
  timeoutMs: number;
  type: 'http';
}

export interface ApplicationProjectionRow {
  containerPort: number;
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  env: Readonly<Record<string, string>>;
  image: string;
  imagePullSecretId: string;
  namespaceId: string;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  readiness: ApplicationReadinessConfig | null;
  replicas: number;
  serviceId: string;
  serviceName: string;
  secretId: string;
  terminationGracePeriodSeconds?: number;
}
