import type { KubernetesObject } from '@kubernetes/client-node';
import type {
  KubeContainerLifecycle,
  KubeContainerPort,
  KubeReadinessProbe,
} from './kube-application-projection.types';

export type KubeManifestKind =
  | 'ConfigMap'
  | 'ClusterRole'
  | 'ClusterRoleBinding'
  | 'CronJob'
  | 'Deployment'
  | 'Job'
  | 'Namespace'
  | 'NetworkPolicy'
  | 'PersistentVolumeClaim'
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

export interface KubeServiceManifest extends KubeManifestBase {
  kind: 'Service';
  spec: KubeServiceManifestSpec;
}

export interface KubeNonWorkloadManifest extends KubeManifestBase {
  kind:
    | 'ClusterRole'
    | 'ClusterRoleBinding'
    | 'ConfigMap'
    | 'CronJob'
    | 'Namespace'
    | 'NetworkPolicy'
    | 'PersistentVolumeClaim'
    | 'RoleBinding'
    | 'Secret'
    | 'ServiceAccount';
}

export type KubeManifest = KubeDeploymentManifest | KubeJobManifest | KubeServiceManifest | KubeNonWorkloadManifest;

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
  lifecycle?: KubeContainerLifecycle | undefined;
  name: string;
  ports?: KubeContainerPort[] | undefined;
  readinessProbe?: KubeReadinessProbe | undefined;
  resources?: object | undefined;
  securityContext?: object | undefined;
  volumeMounts?: object[] | undefined;
}

export interface KubeProjectedPodSpec {
  automountServiceAccountToken: false;
  containers: KubeProjectedContainer[];
  imagePullSecrets?: KubeLocalObjectReference[] | undefined;
  restartPolicy?: 'Never' | 'OnFailure' | undefined;
  securityContext?: object | undefined;
  terminationGracePeriodSeconds?: number | undefined;
  volumes?: object[] | undefined;
}

export interface KubeLocalObjectReference {
  name: string;
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
  selector: KubeLabelSelector;
  strategy: KubeDeploymentStrategy;
  template: KubePodTemplate;
}

export interface KubeLabelSelector {
  matchLabels: Record<string, string>;
}

export interface KubeDeploymentStrategy {
  rollingUpdate?: KubeRollingUpdateStrategy;
  type: 'Recreate' | 'RollingUpdate';
}

export interface KubeRollingUpdateStrategy {
  maxSurge: number;
  maxUnavailable: number;
}

export interface KubeServiceManifestSpec {
  ports: KubeServicePort[];
  selector: Record<string, string>;
  type?: string;
}

export interface KubeServicePort {
  name: string;
  port: number;
  protocol: 'TCP';
  targetPort: number;
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

export interface RegistryPullSecretProjectionRow {
  dockerConfigJson: string;
  namespaceId: string;
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
