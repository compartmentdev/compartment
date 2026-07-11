import type { KubernetesObject } from '@kubernetes/client-node';

export type KubeDeploymentState = 'desired' | 'pending' | 'active';

export interface KubeManifest extends KubernetesObject {
  spec?: object | undefined;
  status?: object | undefined;
  stringData?: Record<string, string> | undefined;
  type?: string | undefined;
}

export interface ApplyBundle {
  objects: KubeManifest[];
  force?: boolean | undefined;
}

export interface ObserveLabels {
  labels: Readonly<Record<string, string>>;
  namespace: string;
  resources: KubeObservedResource[];
}

export type KubeObservedResource = 'deployments' | 'services' | 'networkpolicies' | 'secrets' | 'jobs' | 'pods';

export type KubeObservationEventType = 'add' | 'update' | 'delete';

export interface KubeObjectObservationEvent {
  object: KubeManifest;
  observedAt: Date;
  resource: KubeObservedResource;
  type: KubeObservationEventType;
}

export interface KubeRelistObservationEvent {
  observedAt: Date;
  resource: KubeObservedResource;
  type: 'relist';
}

export type KubeObservationEvent = KubeObjectObservationEvent | KubeRelistObservationEvent;

export interface KubeObservationHealth {
  healthy: boolean;
  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
}

export interface KubeObservation {
  cache: ReadonlyMap<string, KubeManifest>;
  health(): KubeObservationHealth;
  onEvent(listener: KubeObservationListener): () => void;
  stop(): Promise<void>;
}

export type KubeObservationListener = (event: KubeObservationEvent) => Promise<void> | void;

export interface KubeLogReference {
  container?: string | undefined;
  namespace: string;
  podName: string;
  tailLines?: number | undefined;
}

export interface KubeJobSpec {
  args?: string[] | undefined;
  command?: string[] | undefined;
  env?: Readonly<Record<string, string>> | undefined;
  id: string;
  image: string;
  jobClass: 'release' | 'operation';
  labels: Readonly<Record<string, string>>;
  namespace: string;
  timeoutMs: number;
}

export interface KubeJobResult {
  completedAt: Date;
  exitCode: number;
  jobName: string;
  logs: string;
  podName: string;
}

export interface ApplicationProjectionRow {
  containerPort: number;
  deploymentId: string;
  environmentId: string;
  environmentName: string;
  env: Readonly<Record<string, string>>;
  image: string;
  namespaceId: string;
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectName: string;
  replicas: number;
  serviceId: string;
  serviceName: string;
}

export interface ApplicationProjectionOptions {
  ingressNamespaceId: string;
  ingressPodLabels: Readonly<Record<string, string>>;
  podCidr: string;
  serviceCidr: string;
}

export interface SecretProjectionRow {
  data: Readonly<Record<string, string>>;
  deploymentId: string;
  namespaceId: string;
  secretId: string;
}

export interface ResourceProjectionRow {
  environmentId: string;
  image: string;
  namespaceId: string;
  resourceId: string;
}

export interface KubeDeploymentStateRow {
  desiredReplicas: number;
  observedAt: Date | null;
  state: KubeDeploymentState;
}

export interface KubeObservedDeployment {
  availableReplicas: number;
  desiredFieldsDrifted: boolean;
  exists: boolean;
  generation: number | null;
  observedGeneration: number | null;
  requiredObjectsPresent: boolean;
}

export type KubeReconcileAction = 'apply' | 'none';
export type KubeDriftKind = 'deleted' | 'drifted' | 'non-ready';

export interface KubeStateTransition {
  action: KubeReconcileAction;
  audit: KubeDriftAudit | null;
  nextState: KubeDeploymentState;
  observedAt: Date | null;
}

export interface KubeDriftAudit {
  kind: KubeDriftKind;
  message: string;
}
