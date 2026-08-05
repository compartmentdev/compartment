export interface KubeCapabilities {
  add?: string[] | undefined;
  drop: ['ALL'];
}

export interface KubeSeccompProfile {
  type: 'RuntimeDefault';
}

export interface KubeContainerSecurityContext {
  allowPrivilegeEscalation?: boolean | undefined;
  capabilities?: KubeCapabilities | undefined;
  privileged?: false | undefined;
  readOnlyRootFilesystem?: true | undefined;
  runAsGroup?: number | undefined;
  runAsNonRoot?: true | undefined;
  runAsUser?: number | undefined;
}

export interface KubePodSecurityContext {
  fsGroup?: number | undefined;
  fsGroupChangePolicy?: 'Always' | 'OnRootMismatch' | undefined;
  runAsGroup?: number | undefined;
  runAsNonRoot?: true | undefined;
  runAsUser?: number | undefined;
  seccompProfile?: KubeSeccompProfile | undefined;
}
