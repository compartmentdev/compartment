import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import {
  buildSelfHostedImageRef,
  buildSelfHostedImageRefForRepository,
  selfHostedImageRepositoryPrefixes,
  selfHostedRuntimeImageArtifacts,
} from './self-hosted-runtime-services.mjs';
import { buildSelfHostedImages } from './build-self-hosted-images.mjs';
import { writeRenderedSelfHostedEnv } from './render-self-hosted-env.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

async function main() {
  const tags = readPublishTags(process.argv.slice(2));
  const publishEnvPath = await writePublishEnvFile(repositoryRoot, tags[0]);

  try {
    await buildSelfHostedRuntimeImages(repositoryRoot, publishEnvPath);
    checkSelfHostedRuntimeSurface(repositoryRoot, publishEnvPath);
    tagPublishedImages(repositoryRoot, tags[0], tags.slice(1));
    pushPublishedImages(repositoryRoot, tags);
  } finally {
    await rm(dirname(publishEnvPath), { force: true, recursive: true });
  }
}

function readPublishTags(args) {
  const normalizedTags = [...new Set(args.map((value) => value.trim()).filter((value) => value !== ''))];
  if (normalizedTags.length > 0) {
    return normalizedTags;
  }

  throw new Error(
    'Expected at least one self-hosted image tag. Example: `pnpm self-hosted:publish main sha-<commit>`.',
  );
}

async function writePublishEnvFile(repositoryRoot, primaryTag) {
  const publishEnvDirectory = await mkdtemp(resolve(tmpdir(), 'compartment-publish-'));
  const publishEnvPath = resolve(publishEnvDirectory, '.env.self-hosted');

  await writeRenderedSelfHostedEnv({
    outputPath: publishEnvPath,
    primaryTag,
    templatePath: resolve(repositoryRoot, '.env.self-hosted.example'),
  });
  return publishEnvPath;
}

async function buildSelfHostedRuntimeImages(repositoryRoot, publishEnvPath) {
  await buildSelfHostedImages({
    env: process.env,
    envFilePath: publishEnvPath,
    repositoryRoot,
  });
}

function checkSelfHostedRuntimeSurface(repositoryRoot, publishEnvPath) {
  runCommand(
    'node',
    [resolve(repositoryRoot, 'scripts/deploy/check-self-hosted-runtime-surface.mjs'), publishEnvPath],
    repositoryRoot,
  );
}

function tagPublishedImages(repositoryRoot, sourceTag, targetTags) {
  for (const serviceName of selfHostedRuntimeImageArtifacts) {
    const sourceImageRef = buildSelfHostedImageRef(serviceName, sourceTag);
    for (const targetTag of [sourceTag, ...targetTags]) {
      for (const repositoryPrefix of selfHostedImageRepositoryPrefixes) {
        const targetImageRef = buildSelfHostedImageRefForRepository(serviceName, targetTag, repositoryPrefix);
        if (targetImageRef !== sourceImageRef) {
          runCommand('docker', ['tag', sourceImageRef, targetImageRef], repositoryRoot);
        }
      }
    }
  }
}

function pushPublishedImages(repositoryRoot, tags) {
  for (const tag of tags) {
    for (const serviceName of selfHostedRuntimeImageArtifacts) {
      for (const repositoryPrefix of selfHostedImageRepositoryPrefixes) {
        runCommand(
          'docker',
          ['push', buildSelfHostedImageRefForRepository(serviceName, tag, repositoryPrefix)],
          repositoryRoot,
        );
      }
    }
  }
}

await main();
