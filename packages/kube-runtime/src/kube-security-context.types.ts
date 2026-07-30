export interface KubeContainerSecurityContext {
  allowPrivilegeEscalation?: boolean | undefined;
  appArmorProfile?: { type: 'Unconfined' } | undefined;
  capabilities?: { drop: ['ALL'] } | undefined;
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
  seccompProfile?: { type: 'RuntimeDefault' | 'Unconfined' } | undefined;
}
