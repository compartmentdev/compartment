import { z } from 'zod';
import type { ContractSchema } from './schema.types';

const variableLocalRunCommandNameMaxLength: number = 128;

const variableLocalRunCommandPathSeparatorPattern: RegExp = /[\\/]/u;
const variableLocalRunCommandWhitespacePattern: RegExp = /\s/u;
const variableLocalRunCommandNonPrintablePattern: RegExp = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export const variableLocalRunCommandNameSchema: ContractSchema<string> = z
  .string()
  .trim()
  .min(1)
  .max(variableLocalRunCommandNameMaxLength)
  .refine((value: string): boolean => !hasVariableLocalRunCommandPathSeparator(value), {
    message: 'Command name must be an executable basename.',
  })
  .refine((value: string): boolean => !hasVariableLocalRunCommandWhitespace(value), {
    message: 'Command name must not include arguments.',
  })
  .refine((value: string): boolean => !hasVariableLocalRunCommandNonPrintableText(value), {
    message: 'Command name must be printable single-line text.',
  });

function hasVariableLocalRunCommandPathSeparator(commandName: string): boolean {
  return variableLocalRunCommandPathSeparatorPattern.test(commandName);
}

function hasVariableLocalRunCommandWhitespace(commandName: string): boolean {
  return variableLocalRunCommandWhitespacePattern.test(commandName);
}

function hasVariableLocalRunCommandNonPrintableText(commandName: string): boolean {
  return variableLocalRunCommandNonPrintablePattern.test(commandName);
}
