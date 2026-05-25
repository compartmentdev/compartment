import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildFastifyResponseSchemas, type FastifyResponseSchemas } from '../src';

describe('buildFastifyResponseSchemas', (): void => {
  it('builds draft-07 response schemas for Fastify status maps', (): void => {
    const responseSchemas: FastifyResponseSchemas = buildFastifyResponseSchemas({
      200: z
        .object({
          id: z.string(),
          nested: z
            .object({
              ready: z.boolean(),
            })
            .strict(),
        })
        .strict(),
      201: z
        .object({
          createdAt: z.string(),
        })
        .strict(),
    });

    expect(responseSchemas).toMatchObject({
      200: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        properties: {
          id: {
            type: 'string',
          },
          nested: {
            additionalProperties: false,
            properties: {
              ready: {
                type: 'boolean',
              },
            },
            required: ['ready'],
            type: 'object',
          },
        },
        required: ['id', 'nested'],
        type: 'object',
      },
      201: {
        properties: {
          createdAt: {
            type: 'string',
          },
        },
        required: ['createdAt'],
        type: 'object',
      },
    });
  });
});
