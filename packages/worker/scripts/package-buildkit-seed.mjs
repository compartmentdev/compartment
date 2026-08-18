#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const seedRoot = '/seed';
const stateRoot = join(seedRoot, 'state');
const manifestRoot = join(seedRoot, 'manifest');
const snapshotRoot = join(stateRoot, 'runc-overlayfs/snapshots/snapshots');
const digestImagePattern = /^.+:[^@]+@sha256:[a-f0-9]{64}$/u;

const [builderImage, runtimeImage] = process.argv.slice(2);
assertDigestImage('Railpack builder image', builderImage);
assertDigestImage('Railpack runtime image', runtimeImage);

const runtimeFiles = [
  '/usr/local/bin/buildkitd',
  '/usr/local/bin/buildctl',
  '/usr/local/bin/buildkit-runc-gvisor',
  '/usr/local/bin/start-seeded-buildkit',
];
const runtimeChecksums = execFileSync('sha256sum', runtimeFiles);
const runtimeDigest = createHash('sha256').update(runtimeChecksums).digest('hex');

await mkdir(manifestRoot);
const snapshotIds = (await readdir(snapshotRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort(compareSnapshotIds);
const linkSnapshotIds = [];
for (const snapshotId of snapshotIds) {
  if (!/^\d+$/u.test(snapshotId)) {
    throw new Error(`BuildKit seed contains an unexpected snapshot directory: ${snapshotId}`);
  }
  if (await pathExists(join(snapshotRoot, snapshotId, 'work/work'))) {
    throw new Error(`BuildKit seed contains active snapshot ${snapshotId}; only immutable image layers may be seeded.`);
  }
  linkSnapshotIds.push(snapshotId);
}

await writeManifest('worker-buildkit-runtime-digest', runtimeDigest);
await writeManifest('railpack-builder-image', builderImage);
await writeManifest('railpack-runtime-image', runtimeImage);
await writeManifest('link-snapshots', linkSnapshotIds.join('\n'));

function assertDigestImage(name, value) {
  if (value === undefined || !digestImagePattern.test(value)) {
    throw new Error(`${name} must be a tag-and-digest-pinned image reference.`);
  }
}

function compareSnapshotIds(left, right) {
  return Number(left) - Number(right);
}

async function writeManifest(name, value) {
  await writeFile(join(manifestRoot, name), `${value}${value === '' ? '' : '\n'}`, 'utf8');
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
