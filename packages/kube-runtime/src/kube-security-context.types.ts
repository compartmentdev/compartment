export interface KubeContainerSecurityContext {
  allowPrivilegeEscalation?: boolean | undefined;
  capabilities?:
    | {
        add?: KubeBuildKitCapabilitySet;
        drop: ['ALL'];
      }
    | undefined;
  privileged?: false | undefined;
  readOnlyRootFilesystem?: true | undefined;
  runAsGroup?: number | undefined;
  runAsNonRoot?: boolean | undefined;
  runAsUser?: number | undefined;
}

export type KubeBuildKitCapabilitySet = [
  'SYS_ADMIN',
  'CHOWN',
  'SETUID',
  'SETGID',
  'DAC_OVERRIDE',
  'FOWNER',
  'FSETID',
  'SETFCAP',
  'SETPCAP',
  'SYS_CHROOT',
  'MKNOD',
  'KILL',
  'AUDIT_WRITE',
  'NET_BIND_SERVICE',
  'NET_RAW',
];

export interface KubePodSecurityContext {
  fsGroup?: number | undefined;
  fsGroupChangePolicy?: 'Always' | 'OnRootMismatch' | undefined;
  runAsGroup?: number | undefined;
  runAsNonRoot?: true | undefined;
  runAsUser?: number | undefined;
  seccompProfile?: { type: 'RuntimeDefault' } | undefined;
}
