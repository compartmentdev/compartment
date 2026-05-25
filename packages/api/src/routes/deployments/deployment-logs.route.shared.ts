import type { FastifyReply } from 'fastify';

interface ParseableSchema<Response> {
  parse: (value: Response) => Response;
}

export async function sendDeploymentLogsRouteResponse<Result, Response>(
  reply: FastifyReply,
  schema: ParseableSchema<Response>,
  buildResponse: () => Promise<Result>,
  present: (result: Result) => Response,
): Promise<FastifyReply> {
  const response: Response = schema.parse(present(await buildResponse()));
  return await reply.send(response);
}
