import { zodToJsonSchema, type JsonSchema7Type, type Options } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

export type FastifyResponseContractSchemas = Record<number, ZodTypeAny>;
export type FastifyResponseSchemas = Record<number, JsonSchema7Type>;

type FastifyResponseSchemaOptions = Partial<Options<'jsonSchema7'>>;
type ZodToFastifyJsonSchema = (schema: ZodTypeAny, options: FastifyResponseSchemaOptions) => JsonSchema7Type;

const fastifyResponseSchemaOptions: FastifyResponseSchemaOptions = {
  $refStrategy: 'none',
  target: 'jsonSchema7',
};
const zodToFastifyJsonSchema: ZodToFastifyJsonSchema = zodToJsonSchema as never;

export function buildFastifyResponseSchemas(schemas: FastifyResponseContractSchemas): FastifyResponseSchemas {
  const responseSchemas: FastifyResponseSchemas = {};
  const schemaEntries: [string, ZodTypeAny][] = Object.entries(schemas);

  for (const [statusCode, schema] of schemaEntries) {
    responseSchemas[Number(statusCode)] = zodToFastifyJsonSchema(schema, fastifyResponseSchemaOptions);
  }

  return responseSchemas;
}
