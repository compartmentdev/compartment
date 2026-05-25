import type { ZodRawShape, ZodTypeAny } from 'zod';

export type ContractObjectShape = ZodRawShape;

export function readContractShapeFieldNames<TShape extends ContractObjectShape>(
  shape: TShape,
): (keyof TShape & string)[] {
  const fieldNames: (keyof TShape & string)[] = Object.keys(shape);
  return fieldNames;
}

export function readRequiredContractShapeFieldNames<TShape extends ContractObjectShape>(
  shape: TShape,
): (keyof TShape & string)[] {
  const requiredFieldNames: (keyof TShape & string)[] = [];

  for (const entry of Object.entries(shape)) {
    const fieldName: keyof TShape & string = entry[0];
    const fieldSchema: ZodTypeAny = entry[1];
    if (!fieldSchema.safeParse(undefined).success) {
      requiredFieldNames.push(fieldName);
    }
  }

  return requiredFieldNames;
}
