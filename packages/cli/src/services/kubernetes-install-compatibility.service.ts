import type { KubernetesInstallCompatibility, SemanticVersion } from './kubernetes-install-compatibility.service.types';

export const kubernetesInstallCompatibility: KubernetesInstallCompatibility = {
  helmMinimumVersion: '4.0.0',
  kubernetesMinimumVersion: '1.35.0',
  kubectlMaximumMinorSkew: 1,
  kubectlMinimumVersion: '1.35.0',
  managed: {
    certManager: {
      name: 'cert-manager',
      sha256: '6e499c3f1ab356abe79a7853911f80cb09c213885bfdf81092fdff142ba63c4a',
      url: 'https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml',
      version: 'v1.21.0',
    },
    gvisor: {
      name: 'gvisor',
      sha256: '386bdc2196fc600b68ff8dafdd8ecdc6a8e033ecf9cfa9dfab61ec1b389da307',
      sha512:
        '2a440a27a1297ee2124b5c4915b44f9cbcd82ed7871a7ddd99f6602e6d550f8d080f26cb1fa8259d1bd6cde1f4e5942d3eff11116c450b28b2ddfdd92654e87a',
      url: 'https://storage.googleapis.com/gvisor/releases/pool/20260727.0/binary-amd64/runsc.deb',
      version: 'release-20260727.0',
    },
    helm: {
      name: 'helm',
      sha256: '70b2c30a19da4db264dfd68c8a3664e05093a361cefd89572ffb36f8abfa3d09',
      url: 'https://get.helm.sh/helm-v4.1.4-linux-amd64.tar.gz',
      version: 'v4.1.4',
    },
    k3s: {
      name: 'k3s',
      sha256: '267d18da7b3c837d82283f0588fb9031a8a6ff3c0dac772c260c40852ce515f6',
      url: 'https://github.com/k3s-io/k3s/releases/download/v1.35.5%2Bk3s1/k3s',
      version: 'v1.35.5+k3s1',
    },
    k3sChannel: 'compartment-stable-1.35',
    k3sInstallScript: {
      name: 'k3s-install-script',
      sha256: '8598e002e61d658fed7b7542fc6d2c66d8da6eae69e088830105d2ee1ffb6d91',
      url: 'https://raw.githubusercontent.com/k3s-io/k3s/v1.35.5%2Bk3s1/install.sh',
      version: 'v1.35.5+k3s1',
    },
    kubernetesMinor: '1.35',
  },
};

export function isSupportedKubernetesVersion(version: string): boolean {
  try {
    const parsed: SemanticVersion = parseSemanticVersion(version);
    const minimum: SemanticVersion = parseSemanticVersion(kubernetesInstallCompatibility.kubernetesMinimumVersion);
    return parsed.major === 1 && compareSemanticVersionCore(parsed, minimum) >= 0;
  } catch {
    return false;
  }
}

export function formatKubernetesVersionRequirement(): string {
  const minimum: SemanticVersion = parseSemanticVersion(kubernetesInstallCompatibility.kubernetesMinimumVersion);
  return `1.${String(minimum.minor)} or newer`;
}

export function isSemanticVersionAtLeast(version: string, minimumVersion: string): boolean {
  return compareSemanticVersions(parseSemanticVersion(version), parseSemanticVersion(minimumVersion)) >= 0;
}

export function isKubectlVersionCompatibleWithServer(kubectlVersion: string, serverVersion: string): boolean {
  try {
    const kubectl: SemanticVersion = parseSemanticVersion(kubectlVersion);
    const server: SemanticVersion = parseSemanticVersion(serverVersion);
    return (
      kubectl.major === server.major &&
      Math.abs(kubectl.minor - server.minor) <= kubernetesInstallCompatibility.kubectlMaximumMinorSkew
    );
  } catch {
    return false;
  }
}

export function parseSemanticVersion(value: string): SemanticVersion {
  const match: RegExpExecArray | null = executeSemanticVersionPattern(value);
  if (match === null) {
    throw new Error(`Expected a semantic version, received "${value}".`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] === undefined ? {} : { prerelease: match[4] }),
  };
}

function executeSemanticVersionPattern(value: string): RegExpExecArray | null {
  return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(
    value,
  );
}

function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  const coreDifference: number = compareSemanticVersionCore(left, right);
  if (coreDifference !== 0) {
    return coreDifference;
  }
  if (left.prerelease === undefined) {
    return right.prerelease === undefined ? 0 : 1;
  }
  return right.prerelease === undefined ? -1 : comparePrereleaseIdentifiers(left.prerelease, right.prerelease);
}

function compareSemanticVersionCore(left: SemanticVersion, right: SemanticVersion): number {
  const majorDifference: number = left.major - right.major;
  if (majorDifference !== 0) {
    return majorDifference;
  }
  const minorDifference: number = left.minor - right.minor;
  if (minorDifference !== 0) {
    return minorDifference;
  }
  const patchDifference: number = left.patch - right.patch;
  if (patchDifference !== 0) {
    return patchDifference;
  }
  return 0;
}

function comparePrereleaseIdentifiers(left: string, right: string): number {
  const leftIdentifiers: string[] = left.split('.');
  const rightIdentifiers: string[] = right.split('.');
  const identifierCount: number = Math.max(leftIdentifiers.length, rightIdentifiers.length);
  for (let index: number = 0; index < identifierCount; index += 1) {
    const difference: number = comparePrereleaseIdentifier(leftIdentifiers[index], rightIdentifiers[index]);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function comparePrereleaseIdentifier(left: string | undefined, right: string | undefined): number {
  if (left === undefined) {
    return right === undefined ? 0 : -1;
  }
  if (right === undefined) {
    return 1;
  }
  const leftNumeric: boolean = /^\d+$/u.test(left);
  const rightNumeric: boolean = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) {
    return compareOrderedValues(BigInt(left), BigInt(right));
  }
  if (leftNumeric !== rightNumeric) {
    return leftNumeric ? -1 : 1;
  }
  return compareOrderedValues(left, right);
}

function compareOrderedValues(left: bigint, right: bigint): number;
function compareOrderedValues(left: string, right: string): number;
function compareOrderedValues(left: bigint | string, right: bigint | string): number {
  if (left === right) {
    return 0;
  }
  if (typeof left === 'bigint' && typeof right === 'bigint') {
    return left < right ? -1 : 1;
  }
  return String(left) < String(right) ? -1 : 1;
}
