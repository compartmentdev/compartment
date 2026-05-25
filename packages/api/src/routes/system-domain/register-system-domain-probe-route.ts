import { buildFastifyResponseSchemas, compartmentDomainProbePathname } from '@compartment/contracts';
import { hasText, parseHttpHostAuthority, readHeaderValue } from '@compartment/utils';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { readSystemDomainProbe } from '../../services/system-domain-probe.service';
import type { SystemDomainProbeResult } from '../../services/system-domain-probe.service.types';

interface SystemDomainProbeParams {
  operationId: string;
}

const systemDomainProbeParamsSchema: z.ZodType<SystemDomainProbeParams> = z
  .object({
    operationId: z.string().min(1),
  })
  .strict();
const systemDomainProbeResponseSchema: z.ZodType<SystemDomainProbeResult> = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export function registerSystemDomainProbeRoute(app: ApiApp): void {
  app.get(
    `${compartmentDomainProbePathname}/:operationId`,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: systemDomainProbeResponseSchema,
        }),
      },
    },
    handleSystemDomainProbeRequest,
  );
}

async function handleSystemDomainProbeRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: SystemDomainProbeParams = systemDomainProbeParamsSchema.parse(request.params);
  const result: SystemDomainProbeResult | null = await readSystemDomainProbe({
    host: readRequiredHostHeader(request),
    operationId: params.operationId,
  });
  if (result === null) {
    throw new ApiBoundaryError(404, 'domain_probe_not_found', 'Domain probe was not found.');
  }

  return await reply.send(systemDomainProbeResponseSchema.parse(result));
}

function readRequiredHostHeader(request: FastifyRequest): string {
  const hostHeader: string | undefined = readHeaderValue(request.headers.host);
  const host: string | undefined = parseHttpHostAuthority(hostHeader)?.host;
  if (!hasText(hostHeader)) {
    throw new ApiBoundaryError(400, 'missing_host_header', 'A Host header is required.');
  }
  if (host === undefined) {
    throw new ApiBoundaryError(400, 'invalid_host_header', 'Host header must be a valid HTTP authority.');
  }

  return host;
}
