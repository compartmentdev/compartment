import type { SystemServiceName } from '@compartment/contracts';
import type { DockerExecutionContext } from './docker-runtime.types';
import type { SelfHostedImageRefs } from './self-hosted-env.types';

export interface VerifyRemoteSelfHostedRuntimeImageSignaturesInput {
  includeRuntimeProbeImage?: boolean | undefined;
  imageRefs: SelfHostedImageRefs;
  services: readonly SystemServiceName[];
}

export interface VerifyLocalSelfHostedRuntimeImageSignaturesInput extends VerifyRemoteSelfHostedRuntimeImageSignaturesInput {
  context: DockerExecutionContext;
}

export type PullVerifiedRemoteSelfHostedRuntimeImagesInput = VerifyLocalSelfHostedRuntimeImageSignaturesInput;
