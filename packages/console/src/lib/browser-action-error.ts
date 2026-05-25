type BrowserActionFieldKey =
  | 'description'
  | 'email'
  | 'environmentName'
  | 'environmentValues'
  | 'groupId'
  | 'name'
  | 'permissionKeys'
  | 'projectName'
  | 'projectNames'
  | 'roleId'
  | 'scopeType';

export type BrowserActionFieldLabelMap = Partial<Record<BrowserActionFieldKey, string>>;

interface BrowserActionZodIssue {
  code?: string | undefined;
  message?: string | undefined;
  minimum?: number | undefined;
  path?: (number | string)[] | undefined;
  type?: string | undefined;
  validation?: string | undefined;
}

const defaultBrowserActionFieldLabels: BrowserActionFieldLabelMap = {
  description: 'description',
  email: 'email address',
  environmentName: 'environment',
  environmentValues: 'environment',
  groupId: 'group',
  name: 'name',
  permissionKeys: 'permission',
  projectName: 'project',
  projectNames: 'project',
  roleId: 'role',
  scopeType: 'scope',
};

export function normalizeBrowserActionError(
  error: Error | undefined,
  fallbackMessage: string,
  fieldLabels: BrowserActionFieldLabelMap = {},
): Error {
  return new Error(normalizeBrowserActionErrorMessage(error, fallbackMessage, fieldLabels));
}

export function normalizeBrowserActionErrorMessage(
  error: Error | undefined,
  fallbackMessage: string,
  fieldLabels: BrowserActionFieldLabelMap = {},
): string {
  const rawMessage: string = error?.message.trim() ?? '';
  if (rawMessage === '') {
    return fallbackMessage;
  }

  return readZodIssueMessage(rawMessage, fieldLabels) ?? rawMessage;
}

function readZodIssueMessage(rawMessage: string, fieldLabels: BrowserActionFieldLabelMap): string | null {
  const issues: BrowserActionZodIssue[] | null = parseBrowserActionZodIssues(rawMessage);
  if (issues === null || issues.length === 0) {
    return null;
  }

  const [firstIssue] = issues;
  return firstIssue === undefined ? null : formatBrowserActionZodIssue(firstIssue, fieldLabels);
}

function parseBrowserActionZodIssues(rawMessage: string): BrowserActionZodIssue[] | null {
  if (!rawMessage.startsWith('[')) {
    return null;
  }

  try {
    const parsed: BrowserActionZodIssue[] = JSON.parse(rawMessage) as BrowserActionZodIssue[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function formatBrowserActionZodIssue(issue: BrowserActionZodIssue, fieldLabels: BrowserActionFieldLabelMap): string {
  const fieldKey: BrowserActionFieldKey | null = readBrowserActionFieldKey(issue.path);
  const fieldLabel: string | null = readBrowserActionFieldLabel(fieldKey, fieldLabels);

  if (issue.validation === 'email') {
    return `Enter a valid ${fieldLabel ?? 'value'}.`;
  }
  if (issue.code === 'too_small' && issue.type === 'string' && issue.minimum === 1) {
    return `${capitalizeBrowserActionLabel(fieldLabel ?? 'value')} is required.`;
  }
  if (issue.code === 'too_small' && issue.type === 'array' && issue.minimum === 1) {
    return `Select at least one ${fieldLabel ?? 'value'}.`;
  }
  if (issue.code === 'invalid_enum_value' || issue.code === 'invalid_type') {
    return `Select a valid ${fieldLabel ?? 'value'}.`;
  }

  return fieldLabel === null ? 'Enter a valid value.' : `Enter a valid ${fieldLabel}.`;
}

function readBrowserActionFieldKey(path: (number | string)[] | undefined): BrowserActionFieldKey | null {
  if (path === undefined) {
    return null;
  }

  for (let index: number = path.length - 1; index >= 0; index -= 1) {
    const part: number | string | undefined = path[index];
    if (part === undefined) {
      continue;
    }
    if (typeof part === 'string' && part in defaultBrowserActionFieldLabels) {
      return part as BrowserActionFieldKey;
    }
  }

  return null;
}

function readBrowserActionFieldLabel(
  fieldKey: BrowserActionFieldKey | null,
  fieldLabels: BrowserActionFieldLabelMap,
): string | null {
  if (fieldKey === null) {
    return null;
  }

  return fieldLabels[fieldKey] ?? defaultBrowserActionFieldLabels[fieldKey] ?? null;
}

function capitalizeBrowserActionLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}
