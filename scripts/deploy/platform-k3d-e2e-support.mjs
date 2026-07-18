import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { selfHostedRuntimeImageArtifacts } from './self-hosted-runtime-services.mjs';

const processLockRetryMilliseconds = 100;
const processLockTimeoutMilliseconds = 30 * 60 * 1_000;
const sourceCacheRetentionMilliseconds = 24 * 60 * 60 * 1_000;
export const platformK3dServiceNames = selfHostedRuntimeImageArtifacts;
const platformSourceCacheImagePattern = new RegExp(
  `^ghcr\\.io/compartmentdev/compartment-(?:${platformK3dServiceNames.join('|')}):sha-[0-9a-f]{40}$`,
  'u',
);
const platformCleanupStageNames = Object.freeze([
  'cluster',
  'registry',
  'builder',
  'residual Docker resources',
  'run-owned images',
  'state files and directories',
]);

export function readPlatformK3dCleanupStageNames() {
  return platformCleanupStageNames;
}

export function isPlatformSourceCacheImageRef(imageRef) {
  return platformSourceCacheImagePattern.test(imageRef);
}

export function isRunOwnedDockerResourceName(name, environment) {
  const environmentBuilderName = `${environment.clusterName}-builder`;
  return [
    `k3d-${environment.clusterName}`,
    `k3d-${environment.clusterName}-images`,
    `k3d-${environment.clusterName}-server-0`,
    `k3d-${environment.clusterName}-serverlb`,
    `k3d-${environment.registryName}`,
    `buildx_buildkit_${environmentBuilderName}0_state`,
  ].includes(name);
}

export function isRunOwnedImageRef(imageRef, environment) {
  if (imageRef.startsWith(`localhost:${environment.registryHostPort}/compartment-`)) {
    return true;
  }
  return platformK3dServiceNames.some(
    (serviceName) => imageRef === `ghcr.io/compartmentdev/compartment-${serviceName}:e2e-${environment.clusterName}`,
  );
}

export function shouldCleanLegacyPlatformResources(environment) {
  return environment.clusterName !== 'compartment-e2e';
}

export function shouldCleanPlatformSourceCacheImage(imageRef, createdAt, now = Date.now()) {
  const createdAtMilliseconds = Date.parse(createdAt);
  return (
    isPlatformSourceCacheImageRef(imageRef) &&
    Number.isFinite(createdAtMilliseconds) &&
    createdAtMilliseconds <= now - sourceCacheRetentionMilliseconds
  );
}

export async function settlePlatformK3dStartup(clusterPromise, imagePromise) {
  const [clusterResult, imageResult] = await Promise.allSettled([clusterPromise, imagePromise]);
  if (clusterResult.status === 'rejected') {
    throw clusterResult.reason;
  }
  if (imageResult.status === 'rejected') {
    throw imageResult.reason;
  }
  return imageResult.value;
}

export function runPlatformK3dCleanupStep(cleanupErrors, label, cleanup, clusterName) {
  try {
    cleanup();
  } catch (error) {
    cleanupErrors.push(error);
    process.stderr.write(`Failed to clean ${label} for ${clusterName}: ${String(error)}\n`);
  }
}

export function runPlatformK3dCleanupSequence(steps, clusterName, cleanupErrors = []) {
  for (const step of steps) {
    runPlatformK3dCleanupStep(cleanupErrors, step.label, step.cleanup, clusterName);
  }
  return cleanupErrors;
}

export async function withPlatformK3dProcessLock(lockDirectory, operation) {
  const releaseLock = await acquirePlatformK3dProcessLock(lockDirectory);
  try {
    return await operation();
  } finally {
    releaseLock();
  }
}

async function acquirePlatformK3dProcessLock(lockDirectory) {
  const attempts = Math.ceil(processLockTimeoutMilliseconds / processLockRetryMilliseconds);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      mkdirSync(lockDirectory);
      writeFileSync(join(lockDirectory, 'pid'), process.pid.toString(), { mode: 0o600 });
      return () => rmSync(lockDirectory, { force: true, recursive: true });
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      if (!processLockOwnerIsRunning(lockDirectory)) {
        rmSync(lockDirectory, { force: true, recursive: true });
        continue;
      }
      await delay(processLockRetryMilliseconds);
    }
  }
  throw new Error(`Timed out waiting for the platform k3d process lock at ${lockDirectory}.`);
}

function processLockOwnerIsRunning(lockDirectory) {
  let ownerPid;
  try {
    ownerPid = Number(readFileSync(join(lockDirectory, 'pid'), 'utf8'));
  } catch {
    try {
      return Date.now() - statSync(lockDirectory).mtimeMs < 5_000;
    } catch {
      return false;
    }
  }
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) {
    return false;
  }
  try {
    process.kill(ownerPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}
