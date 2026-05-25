export function readRequiredOptionValue(args, index, optionName) {
  const value = args[index];
  if (typeof value === 'string' && value !== '') {
    return value;
  }

  throw new Error(`Expected a value after ${optionName}.`);
}
