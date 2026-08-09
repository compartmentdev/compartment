import type { FastifyRequest } from 'fastify';

export interface BuildArtifactSourceArchiveParams {
  artifactId: string;
}

export type BuildArtifactSourceArchiveRequest = FastifyRequest<{ Params: BuildArtifactSourceArchiveParams }>;
