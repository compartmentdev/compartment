import { z } from 'zod';

interface VariableImportEntriesRequest {
  entries: { keyName: string }[];
}

interface VariableTargetSelectionValue {
  resourceName?: string | null | undefined;
  serviceName?: string | null | undefined;
}

export function assertUniqueVariableImportEntries(value: VariableImportEntriesRequest, context: z.RefinementCtx): void {
  const seenKeyNames: Set<string> = new Set<string>();

  for (const entry of value.entries) {
    if (seenKeyNames.has(entry.keyName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate import key ${entry.keyName}.`,
        path: ['entries'],
      });
      return;
    }

    seenKeyNames.add(entry.keyName);
  }
}

export function assertVariableTargetSelection(value: VariableTargetSelectionValue, context: z.RefinementCtx): void {
  if (value.resourceName == null || value.serviceName == null) {
    return;
  }

  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: 'Select either serviceName or resourceName, not both.',
    path: ['resourceName'],
  });
}
