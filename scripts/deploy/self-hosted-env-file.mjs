export function parseSelfHostedEnvFile(envText) {
  const values = {};

  for (const line of envText.split('\n')) {
    const trimmedLine = line.trim();
    if (trimmedLine === '' || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex > 0) {
      values[trimmedLine.slice(0, separatorIndex)] = trimmedLine.slice(separatorIndex + 1);
    }
  }

  return values;
}

export function readRequiredSelfHostedEnvValue(envValues, variableName, sourceDescription) {
  const value = envValues[variableName]?.trim();
  if (value !== undefined && value !== '') {
    return value;
  }

  throw new Error(`Expected ${variableName} in ${sourceDescription}.`);
}
