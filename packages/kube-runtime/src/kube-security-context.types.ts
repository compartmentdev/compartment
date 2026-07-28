export interface KubeContainerSecurityContext {
  allowPrivilegeEscalation?: false | undefined;
  capabilities?: { drop: ['ALL'] } | undefined;
  privileged?: false | undefined;
}

export interface KubePodSecurityContext {
  fsGroup?: number | undefined;
  fsGroupChangePolicy?: 'Always' | undefined;
  runAsGroup?: number | undefined;
  runAsNonRoot?: true | undefined;
  runAsUser?: number | undefined;
  seccompProfile?: { type: 'RuntimeDefault' } | undefined;
}
