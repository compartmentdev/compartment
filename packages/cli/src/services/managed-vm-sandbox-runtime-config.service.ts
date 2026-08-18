import { managedVmSandboxRuntimePaths } from './managed-vm-sandbox-runtime.constants';

const gvisorRuntimeClassName: string = 'gvisor';
const gvisorBuildRuntimeClassName: string = 'gvisor-build';
const expectedRuntimeType: string = 'io.containerd.runsc.v1';

export function renderManagedVmBuildRunscConfig(base: string): Buffer {
  if (base.includes('file-access-mounts')) {
    throw new Error('Managed-VM gVisor base config unexpectedly declares file-access-mounts.');
  }
  return Buffer.from(`${base.trimEnd()}\n  file-access-mounts = "exclusive"\n`);
}

export function renderManagedVmContainerdTemplate(includeBuildRuntime: boolean = true): string {
  const buildRuntime: string = includeBuildRuntime ? renderBuildRuntimeTemplate() : '';
  return `{{ template "base" . }}

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc]
  runtime_type = "${expectedRuntimeType}"
  pod_annotations = ["dev.gvisor.spec.mount.*"]

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
  ConfigPath = "${managedVmSandboxRuntimePaths.runscConfig}"
${buildRuntime}`;
}

export function renderManagedVmRuntimeClasses(): string {
  return `apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: ${gvisorRuntimeClassName}
handler: runsc
---
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: ${gvisorBuildRuntimeClassName}
handler: runsc-build
`;
}

function renderBuildRuntimeTemplate(): string {
  return `
[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc-build]
  runtime_type = "${expectedRuntimeType}"
  pod_annotations = ["dev.gvisor.spec.mount.*"]

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc-build.options]
  TypeUrl = "io.containerd.runsc.v1.options"
  ConfigPath = "${managedVmSandboxRuntimePaths.buildRunscConfig}"
`;
}
