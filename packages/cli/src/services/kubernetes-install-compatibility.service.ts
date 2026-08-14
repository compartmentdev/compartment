import type {
  KubernetesInstallCompatibility,
  ManagedKubernetesInstallArtifact,
  ManagedKubernetesInstallArtifactName,
  SemanticVersion,
} from './kubernetes-install-compatibility.service.types';
import compatibility from './kubernetes-install-compatibility.json';

export const kubernetesInstallCompatibility: KubernetesInstallCompatibility = {
  ...compatibility,
  managed: {
    ...compatibility.managed,
    certManager: validatedArtifact(compatibility.managed.certManager, 'cert-manager'),
    gvisor: validatedArtifact(compatibility.managed.gvisor, 'gvisor'),
    helm: validatedArtifact(compatibility.managed.helm, 'helm'),
    k3s: validatedArtifact(compatibility.managed.k3s, 'k3s'),
    k3sInstallScript: validatedArtifact(compatibility.managed.k3sInstallScript, 'k3s-install-script'),
  },
};

function validatedArtifact(
  artifact: Omit<ManagedKubernetesInstallArtifact, 'name'> & { name: string },
  expectedName: ManagedKubernetesInstallArtifactName,
): ManagedKubernetesInstallArtifact {
  if (artifact.name !== expectedName) {
    throw new Error(`Expected managed artifact ${expectedName}, received ${artifact.name}.`);
  }
  return { ...artifact, name: expectedName };
}

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
