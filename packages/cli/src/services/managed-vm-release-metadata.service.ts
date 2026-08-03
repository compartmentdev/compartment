import type { ManagedVmReleaseMetadata } from './managed-vm-provisioning.types';

export const managedVmReleaseMetadata: ManagedVmReleaseMetadata = {
  artifacts: [
    {
      name: 'k3s',
      sha256: '65a55ec56c24eab44383086166ec620a491952b7e23941a49ddca6e8a4c4b4de',
      url: 'https://github.com/k3s-io/k3s/releases/download/v1.36.2%2Bk3s1/k3s',
      version: 'v1.36.2+k3s1',
    },
    {
      name: 'k3s-install-script',
      sha256: '46177d4c99440b4c0311b67233823a8e8a2fc09693f6c89af1a7161e152fbfad',
      url: 'https://raw.githubusercontent.com/k3s-io/k3s/v1.36.2%2Bk3s1/install.sh',
      version: 'v1.36.2+k3s1',
    },
    {
      name: 'helm',
      sha256: 'f8180838c23d7c7d797b208861fecb591d9ce1690d8704ed1e4cb8e2add966c1',
      url: 'https://get.helm.sh/helm-v3.18.4-linux-amd64.tar.gz',
      version: 'v3.18.4',
    },
    {
      name: 'cert-manager',
      sha256: '6e499c3f1ab356abe79a7853911f80cb09c213885bfdf81092fdff142ba63c4a',
      url: 'https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml',
      version: 'v1.21.0',
    },
  ],
  certManagerVersion: 'v1.21.0',
  helmVersion: 'v3.18.4',
  k3sChannel: 'compartment-stable-1.36',
  k3sVersion: 'v1.36.2+k3s1',
  kubernetesMinor: '1.36',
  metadataVersion: 1,
  podCidr: `${['10', '42', '0', '0'].join('.')}/16`,
  serviceCidr: `${['10', '43', '0', '0'].join('.')}/16`,
};
