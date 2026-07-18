import { setTimeout as delay } from 'node:timers/promises';

import { captureCommandResult } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const lockName = 'compartment-platform-image-cache-lock';
const lockLabel = 'compartment.image-cache-lock';
const lockOwnerLabel = 'compartment.image-cache-lock-owner';
const lockStaleMilliseconds = 30 * 60 * 1_000;
const lockWaitMilliseconds = 35 * 60 * 1_000;

export async function withPlatformImageCacheDockerLock(operation) {
  const ownerToken = `e2e-${process.pid}-${Date.now()}`;
  const releaseLock = await acquirePlatformImageCacheDockerLock(ownerToken);
  try {
    return await operation();
  } finally {
    releaseLock();
  }
}

export async function acquirePlatformImageCacheDockerLock(ownerToken) {
  assertOwnerToken(ownerToken);
  const attempts = Math.ceil(lockWaitMilliseconds / 1_000);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const createResult = captureCommandResult(
      'docker',
      ['network', 'create', '--label', `${lockLabel}=true`, '--label', `${lockOwnerLabel}=${ownerToken}`, lockName],
      repositoryRoot,
    );
    if (createResult.status === 0) {
      return () => releasePlatformImageCacheDockerLock(ownerToken);
    }
    const lock = readLock();
    if (lock === undefined) {
      throw new Error(`Unable to create the platform image cache lock: ${createResult.stderr}`);
    }
    if (lock.Labels?.[lockLabel] !== 'true') {
      throw new Error(`Refusing to replace unowned Docker network ${lockName}.`);
    }
    const createdAtMilliseconds = Date.parse(lock.Created);
    if (Number.isFinite(createdAtMilliseconds) && createdAtMilliseconds <= Date.now() - lockStaleMilliseconds) {
      removeLockById(lock.Id);
      continue;
    }
    await delay(1_000);
  }
  throw new Error(`Timed out waiting for Docker network ${lockName}.`);
}

export function releasePlatformImageCacheDockerLock(ownerToken) {
  assertOwnerToken(ownerToken);
  const lock = readLock();
  if (lock === undefined) {
    return;
  }
  if (lock.Labels?.[lockLabel] !== 'true') {
    throw new Error(`Refusing to remove unowned Docker network ${lockName}.`);
  }
  if (lock.Labels?.[lockOwnerLabel] !== ownerToken) {
    throw new Error(`Refusing to release Docker network ${lockName} for another owner.`);
  }
  removeLockById(lock.Id);
}

function assertOwnerToken(ownerToken) {
  if (typeof ownerToken !== 'string' || ownerToken.trim() === '') {
    throw new Error('Platform image cache lock owner token is required.');
  }
}

function removeLockById(lockId) {
  const removeResult = captureCommandResult('docker', ['network', 'rm', lockId], repositoryRoot);
  if (removeResult.status === 0) {
    return;
  }
  const currentLock = readLock();
  if (currentLock === undefined || currentLock.Id !== lockId) {
    return;
  }
  throw new Error(`Unable to remove platform image cache lock ${lockId}: ${removeResult.stderr}`);
}

function readLock() {
  const result = captureCommandResult(
    'docker',
    ['network', 'inspect', '--format', '{{json .}}', lockName],
    repositoryRoot,
  );
  if (result.status !== 0) {
    return undefined;
  }
  return JSON.parse(result.stdout);
}
