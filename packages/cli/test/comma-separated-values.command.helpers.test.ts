import { describe, expect, it } from 'vitest';
import { splitCommaSeparatedValues } from '../src/commands/comma-separated-values.command.helpers';

describe('splitCommaSeparatedValues', (): void => {
  it('trims entries and drops empty values', (): void => {
    expect(splitCommaSeparatedValues(' one, two ,, three ,')).toEqual(['one', 'two', 'three']);
  });

  it('returns an empty list for omitted input', (): void => {
    expect(splitCommaSeparatedValues(undefined)).toEqual([]);
  });
});
