import type { KubernetesObject } from '@kubernetes/client-node';
import type {
  KubeContainerLifecycle,
  KubeContainerPort,
  KubeReadinessProbe,
} from './kube-application-projection.types';
import type { KubeJobVolumeMount, KubePodVolume, KubeVolumeMount } from './kube-volume.types';
import type { KubeContainerSecurityContext, KubePodSecurityContext } from './kube-security-context.types';
import type { KubeToleration, KubeWorkloadScheduling } from './kube-workload-scheduling.types';

export type { KubeJobVolumeMount, KubePodVolume, KubeVolumeMount } from './kube-volume.types';
export type { ApplyBundle } from './kube-apply-bundle.types';

export type KubeManifestKind =
  | 'ConfigMap'
  | 'ClusterRole'
  | 'ClusterRoleBinding'
  | 'CronJob'
  | 'Deployment'
  | 'Certificate'
  | 'Ingress'
  | 'Job'
  | 'LimitRange'
  | 'Namespace'
  | 'NetworkPolicy'
  | 'PersistentVolumeClaim'
  | 'ResourceQuota'
  | 'RoleBinding'
  | 'Secret'
  | 'Service'
  | 'ServiceAccount';

interface KubeManifestBase extends KubernetesObject {
  automountServiceAccountToken?: false | undefined;
  imagePullSecrets?: KubeLocalObjectReference[] | undefined;
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
    | 'Certificate'
    | 'ClusterRole'
    | 'ClusterRoleBinding'
    | 'ConfigMap'
    | 'CronJob'
    | 'Ingress'
    | 'LimitRange'
    | 'Namespace'
    | 'NetworkPolicy'
    | 'PersistentVolumeClaim'
    | 'ResourceQuota'
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
  securityContext?: KubeContainerSecurityContext | undefined;
  volumeMounts?: KubeVolumeMount[] | undefined;
}

export interface KubeProjectedPodSpec {
  automountServiceAccountToken: false;
  containers: KubeProjectedContainer[];
  imagePullSecrets?: KubeLocalObjectReference[] | undefined;
  nodeSelector?: Readonly<Record<string, string>> | undefined;
  priorityClassName?: string | undefined;
  restartPolicy?: 'Never' | 'OnFailure' | undefined;
  runtimeClassName?: string | undefined;
  serviceAccountName?: string | undefined;
  securityContext?: KubePodSecurityContext | undefined;
  terminationGracePeriodSeconds?: number | undefined;
  tolerations?: readonly KubeToleration[] | undefined;
  volumes?: KubePodVolume[] | undefined;
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
  clusterIP?: 'None' | undefined;
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
  activeDeadlineSeconds: number;
  backoffLimit: number;
  template: KubePodTemplate;
  ttlSecondsAfterFinished?: number | undefined;
}

export interface ObserveLabels {
  labels: Readonly<Record<string, string>>;
  namespace: string;
  resources: KubeObservedResource[];
}

export type KubeObservedResource =
  | 'deployments'
  | 'services'
  | 'networkpolicies'
  | 'persistentvolumeclaims'
  | 'secrets'
  | 'jobs'
  | 'pods';

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
  imagePullSecretId?: string | undefined;
  jobClass: 'release' | 'operation';
  labels: Readonly<Record<string, string>>;
  namespace: string;
  scheduling?: KubeWorkloadScheduling | undefined;
  securityProfile?: 'project-restricted' | 'resource-restricted' | 'restricted' | undefined;
  serviceAccountName?: string | undefined;
  serviceAccountTokenExpirationSeconds?: number | undefined;
  timeoutMs: number;
  volumeMounts?: KubeJobVolumeMount[] | undefined;
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
