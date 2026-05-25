import type { FastifyReply, FastifyRequest } from 'fastify';

export interface NodeInternalUnauthorizedResponse {
  error: string;
  message: string;
}

export type AuthenticateNodeInternalRequest = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export type RegisterNodeInternalRoutesDone = (err?: Error) => void;
