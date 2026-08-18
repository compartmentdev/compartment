import type { KubeManifest } from '@compartment/kube-runtime';

export const recoveryRestartedAnnotation: string = 'compartment.dev/recovery-restarted';

export function includeRecoveryRestartedAnnotation(objects: KubeManifest[]): KubeManifest[] {
  return objects.map(
    (object: KubeManifest): KubeManifest =>
      object.kind === 'Deployment'
        ? {
            ...object,
            metadata: {
              ...object.metadata,
              annotations: { ...object.metadata?.annotations, [recoveryRestartedAnnotation]: 'true' },
            },
            spec:
              object.spec === undefined
                ? undefined
                : {
                    ...object.spec,
                    template: {
                      ...object.spec.template,
                      metadata: {
                        ...object.spec.template.metadata,
                        annotations: {
                          ...object.spec.template.metadata.annotations,
                          [recoveryRestartedAnnotation]: 'true',
                        },
                      },
                    },
                  },
          }
        : object,
  );
}
