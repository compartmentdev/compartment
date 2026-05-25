export function readSelfHostedEnvironmentAssignmentName(line: string): string | null {
  const trimmedLine: string = line.trim();
  if (trimmedLine === '' || trimmedLine.startsWith('#')) {
    return null;
  }

  const separatorIndex: number = line.indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error(`Expected an env assignment, received: ${line}`);
  }

  return line.slice(0, separatorIndex);
}

export function readSelfHostedEnvironmentAssignmentValue(line: string): string {
  const separatorIndex: number = line.indexOf('=');
  if (separatorIndex < 0) {
    throw new Error(`Expected an env assignment, received: ${line}`);
  }

  return readSelfHostedEnvironmentValue(line.slice(separatorIndex + 1).replace(/\r$/u, ''));
}

export function renderSelfHostedEnvironmentAssignment(variableName: string, value: string): string {
  if (/[\r\n\0]/u.test(value)) {
    throw new Error(`The self-hosted environment value for ${variableName} must not contain control characters.`);
  }

  if (/[ \t]/u.test(value)) {
    return `${variableName}=${quoteSelfHostedEnvironmentValue(value)}`;
  }

  return `${variableName}=${value}`;
}

function readSelfHostedEnvironmentValue(rawValue: string): string {
  const trimmedValue: string = rawValue.trim();
  if (trimmedValue.length < 2) {
    return rawValue;
  }

  if (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) {
    return trimmedValue.slice(1, -1).replace(/\\(["\\$`])/gu, '$1');
  }

  if (trimmedValue.startsWith("'") && trimmedValue.endsWith("'")) {
    return trimmedValue.slice(1, -1);
  }

  return rawValue;
}

function quoteSelfHostedEnvironmentValue(value: string): string {
  return `"${value.replace(/["\\$`]/gu, '\\$&')}"`;
}
