import {
  buildFastifyResponseSchemas,
  productLogIngestPathname,
  productLogIngestRequestSchema,
  productLogIngestResponseSchema,
  type ProductLogIngestEvent,
  type ProductLogIngestResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { ingestDeploymentProductLogs } from '../../services/deployment-product-logs.service';

export function registerPostProductLogsRoute(app: ApiApp): void {
  app.post(
    productLogIngestPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: productLogIngestResponseSchema }) } },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      const input: ProductLogIngestEvent[] = parseRequestValue(
        productLogIngestRequestSchema,
        request.body,
        'invalid_product_log_ingest_request',
      );
      const response: ProductLogIngestResponse = await ingestDeploymentProductLogs(input);
      if (response.rejected > 0) {
        return await reply.code(503).send({
          error: {
            code: 'product_log_ingest_deferred',
            message: 'Product log identity or store capacity is not available yet.',
          },
        });
      }
      return await reply.send(productLogIngestResponseSchema.parse(response));
    },
  );
}
