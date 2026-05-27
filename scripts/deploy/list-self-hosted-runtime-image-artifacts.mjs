import { selfHostedRuntimeImageArtifacts } from './self-hosted-runtime-services.mjs';

process.stdout.write(`${selfHostedRuntimeImageArtifacts.join('\n')}\n`);
