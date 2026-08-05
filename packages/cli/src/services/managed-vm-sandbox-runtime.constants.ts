import { dirname } from 'node:path';

interface ManagedVmSandboxRuntimePaths {
  checkpointGofer: string;
  containerdConfig: string;
  containerdDirectory: string;
  containerdShim: string;
  containerdTemplate: string;
  containerdTemplateDirectory: string;
  gvisorBinDirectory: string;
  metricServer: string;
  runsc: string;
  runscConfig: string;
}

const gvisorBinDirectory: string = '/usr/local/bin/gvisor-bin';
const runscConfig: string = '/etc/containerd/runsc.toml';
const containerdTemplate: string = '/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.tmpl';

export const managedVmSandboxRuntimePaths: ManagedVmSandboxRuntimePaths = {
  checkpointGofer: `${gvisorBinDirectory}/checkpointgofer`,
  containerdConfig: '/var/lib/rancher/k3s/agent/etc/containerd/config.toml',
  containerdDirectory: dirname(runscConfig),
  containerdShim: '/usr/local/bin/containerd-shim-runsc-v1',
  containerdTemplate,
  containerdTemplateDirectory: dirname(containerdTemplate),
  gvisorBinDirectory,
  metricServer: `${gvisorBinDirectory}/runsc-metric-server`,
  runsc: '/usr/local/bin/runsc',
  runscConfig,
};

export const managedVmSandboxRuntimeHelperNames: readonly string[] = ['checkpointgofer', 'runsc-metric-server'];
