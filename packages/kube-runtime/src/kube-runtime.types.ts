import type { KubernetesObject } from '@kubernetes/client-node';

export type KubeDeploymentState = 'desired' | 'pending' | 'active';
export type KubeManifestKind =
  | 'ClusterRole'
  | 'ClusterRoleBinding'
  | 'Deployment'
  | 'Job'
  | 'Namespace'
  | 'NetworkPolicy'
  | 'RoleBinding'
  | 'Secret'
  | 'Service'
  | 'ServiceAccount';

interface KubeManifestBase extends KubernetesObject {
  automountServiceAccountToken?: false | undefined;
  roleRef?: KubeRoleReference | undefined;
  spec?: object | undefined;
  status?: object | undefined;
  stringData?: Record<string, string> | undefined;
  subjects?: KubeSubject[] | undefined;
  type?: string | undefined;
}

export interface KubeDeploymentManifest extends KubeManifestBase {
  kind: 'Deployment';
  spec?: KubeDeploymentManifestSpec | undefined;
}

export interface KubeJobManifest extends KubeManifestBase {
  kind: 'Job';
  spec?: KubeJobManifestSpec | undefined;
}

export interface KubeNonWorkloadManifest extends KubeManifestBase {
  kind:
    | 'ClusterRole'
    | 'ClusterRoleBinding'
    | 'Namespace'
    | 'NetworkPolicy'
    | 'RoleBinding'
    | 'Secret'
    | 'Service'
    | 'ServiceAccount';
}

export type KubeManifest = KubeDeploymentManifest | KubeJobManifest | KubeNonWorkloadManifest;

export interface KubeObservedPodManifest extends KubeManifestBase {
  kind: 'Pod';
}

export type KubeObservedManifest = KubeManifest | KubeObservedPodManifest;

interface KubeRoleReference {
  apiGroup: 'rbac.authorization.k8s.io';
  kind: 'ClusterRole';
  name: string;
}

interface KubeSubject {
  kind: 'ServiceAccount';
  name: string;
  namespace: string;
}

export interface KubeSecretKeySelector {
  key: string;
  name: string;
}

export interface KubeSecretEnvValueSource {
  secretKeyRef: KubeSecretKeySelector;
}

export interface KubeSecretEnvVariable {
  name: string;
  valueFrom: KubeSecretEnvValueSource;
  value?: never;
}

export interface KubeProjectedContainer {
  args?: string[] | undefined;
  command?: string[] | undefined;
  env: KubeSecretEnvVariable[];
  image: string;
  lifecycle?: object | undefined;
  name: string;
  ports?: object[] | undefined;
  readinessProbe?: object | undefined;
}

export interface KubeProjectedPodSpec {
  automountServiceAccountToken: false;
  containers: KubeProjectedContainer[];
  restartPolicy?: 'Never' | undefined;
  terminationGracePeriodSeconds?: number | undefined;
}

export interface KubePodTemplate {
  metadata: KubePodTemplateMetadata;
  spec: KubeProjectedPodSpec;
}

export interface KubePodTemplateMetadata {
  annotations?: Record<string, string> | undefined;
  labels: Record<string, string>;
}

export interface KubeDeploymentManifestSpec {
  progressDeadlineSeconds: number;
  replicas: number;
  selector: object;
  strategy: object;
  template: KubePodTemplate;
}

export interface KubeJobManifestSpec {
  backoffLimit: number;
  template: KubePodTemplate;
  ttlSecondsAfterFinished?: number | undefined;
}

export interface ApplyBundle {
  createBeforeApply?: KubeManifest[] | undefined;
  deleteAfterApply?: KubeManifest[] | undefined;
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
  object: KubeObservedManifest;
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
  cache: ReadonlyMap<string, KubeObservedManifest>;
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
  env: Readonly<Record<string, string>>;
  id: string;
  image: string;
  jobClass: 'release' | 'operation';
  labels: Readonly<Record<string, string>>;
  namespace: string;
  timeoutMs: number;
}

export interface KubeJobResult {
  completedAt: Date;
  exitCode: number | null;
  jobName: string;
  logs: string;
  podName: string | null;
  status: 'succeeded' | 'failed' | 'timed-out';
  finalize(): Promise<void>;
}

export interface KubePersistedJobResult {
  completedAt: Date;
  exitCode: number | null;
  jobName: string;
  logs: string;
  podName: string | null;
  status: 'succeeded' | 'failed' | 'timed-out';
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
  secretId: string;
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
