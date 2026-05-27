import type { DockerRunContainerInput } from '@compartment/docker';

export type RuntimeShellCommandContainerInvocation = Pick<DockerRunContainerInput, 'command' | 'entrypoint'>;
