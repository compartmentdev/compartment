export function hasText(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value.trim() !== '';
}

export function readNonEmptyLines(value: string): string[] {
  return value.split(/\r\n|\n|\r/).filter((line: string): boolean => line !== '');
}

export function isValidEmailAddress(value: string): boolean {
  if (containsWhitespace(value)) {
    return false;
  }

  const separatorIndex: number = value.indexOf('@');
  if (separatorIndex <= 0 || separatorIndex !== value.lastIndexOf('@')) {
    return false;
  }

  const localPart: string = value.slice(0, separatorIndex);
  const domainPart: string = value.slice(separatorIndex + 1);
  const firstDomainDotIndex: number = domainPart.indexOf('.');

  return (
    localPart !== '' && domainPart !== '' && firstDomainDotIndex > 0 && firstDomainDotIndex < domainPart.length - 1
  );
}

export function slugifyText(value: string): string {
  const normalizedValue: string = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');

  return trimCharacter(normalizedValue, '-');
}

function trimCharacter(value: string, character: string): string {
  let start: number = 0;
  while (start < value.length && value[start] === character) {
    start += 1;
  }

  let end: number = value.length;
  while (end > start && value[end - 1] === character) {
    end -= 1;
  }

  return value.slice(start, end);
}

function containsWhitespace(value: string): boolean {
  for (const character of value) {
    if (character.trim() === '') {
      return true;
    }
  }

  return false;
}
