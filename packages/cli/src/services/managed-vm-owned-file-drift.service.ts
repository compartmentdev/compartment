import type { ManagedVmOwnedPathDrift, ManagedVmOwnedPathIdentity } from './managed-vm-owned-file-drift.service.types';

export function listManagedVmOwnedFileDrift(
  observed: Readonly<Record<string, string>>,
  recorded: Readonly<Record<string, string>>,
): ManagedVmOwnedPathDrift[] {
  const paths: string[] = [...new Set([...Object.keys(recorded), ...Object.keys(observed)])].sort(
    (left: string, right: string): number => left.localeCompare(right),
  );
  return paths.flatMap((path: string): ManagedVmOwnedPathDrift[] => {
    const before: string | undefined = readIdentity(recorded, path);
    const after: string | undefined = readIdentity(observed, path);
    if (before === after) {
      return [];
    }
    if (after === undefined) {
      return [{ detail: 'missing from the host', path }];
    }
    if (before === undefined) {
      return [{ detail: 'present but never written by the installer', path }];
    }
    return [{ detail: describeIdentityChange(before, after), path }];
  });
}

export function formatManagedVmOwnedFileDrift(drift: readonly ManagedVmOwnedPathDrift[]): string {
  return drift.map((entry: ManagedVmOwnedPathDrift): string => `  ${entry.path}: ${entry.detail}`).join('\n');
}

/**
 * Recorded paths come from a state file whose keys are not validated, so an own-property lookup keeps
 * a key such as `constructor` from resolving to an inherited `Object.prototype` member and being read
 * as an identity.
 */
function readIdentity(identities: Readonly<Record<string, string>>, path: string): string | undefined {
  return Object.hasOwn(identities, path) ? identities[path] : undefined;
}

function describeIdentityChange(recorded: string, observed: string): string {
  const before: ManagedVmOwnedPathIdentity = parseIdentity(recorded);
  const after: ManagedVmOwnedPathIdentity = parseIdentity(observed);
  if (before.kind !== after.kind) {
    return `type changed from ${before.kind} to ${after.kind}`;
  }
  const reasons: string[] = [
    ...describeFieldChange('mode', before.mode, after.mode),
    ...describeOwnerChange(before, after),
    ...(before.digest === after.digest ? [] : ['content changed']),
  ];
  return reasons.length === 0 ? 'content changed' : reasons.join(', ');
}

function describeOwnerChange(before: ManagedVmOwnedPathIdentity, after: ManagedVmOwnedPathIdentity): string[] {
  if (before.uid === after.uid && before.gid === after.gid) {
    return [];
  }
  return [`owner changed from ${formatOwner(before)} to ${formatOwner(after)}`];
}

function describeFieldChange(name: string, before: string | undefined, after: string | undefined): string[] {
  if (before === after || before === undefined || after === undefined) {
    return [];
  }
  return [`${name} changed from ${before} to ${after}`];
}

function formatOwner(identity: ManagedVmOwnedPathIdentity): string {
  return `${identity.uid ?? 'unknown'}:${identity.gid ?? 'unknown'}`;
}

/**
 * Identities are the strings produced by `managedVmFileIdentity` and `managedVmDirectoryIdentity`:
 * `file:<mode>:<digest>` and `directory:<uid>:<gid>:<mode>`. Every caller is gated to the current
 * metadata version before reaching here, so a shape that does not parse means the recorded state file
 * is corrupt; report that as changed content rather than inventing a reason for it.
 */
function parseIdentity(identity: string): ManagedVmOwnedPathIdentity {
  const [kind, ...fields]: string[] = identity.split(':');
  if (kind === 'file' && fields.length === 2) {
    return { digest: fields[1], kind, mode: fields[0] };
  }
  if (kind === 'directory' && fields.length === 3) {
    return { gid: fields[1], kind, mode: fields[2], uid: fields[0] };
  }
  return { digest: identity, kind: identity === 'directory' ? 'directory' : 'file' };
}
