import { runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import {
  buildSelfHostedImageRef,
  buildSelfHostedImageRefForRepository,
  selfHostedImageRepositoryPrefixes,
  selfHostedRuntimeImageArtifacts,
} from './self-hosted-runtime-services.mjs';
import { buildSelfHostedImages } from './build-self-hosted-images.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

async function main() {
  const tags = readPublishTags(process.argv.slice(2));
  await buildSelfHostedRuntimeImages(repositoryRoot, tags[0]);
  tagPublishedImages(repositoryRoot, tags[0], tags.slice(1));
  pushPublishedImages(repositoryRoot, tags);
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

async function buildSelfHostedRuntimeImages(repositoryRoot, primaryTag) {
  await buildSelfHostedImages({
    env: process.env,
    imageRefsByServiceName: Object.fromEntries(
      selfHostedRuntimeImageArtifacts.map((serviceName) => [
        serviceName,
        buildSelfHostedImageRef(serviceName, primaryTag),
      ]),
    ),
    repositoryRoot,
  });
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
