import { describe, expect, it } from 'vitest';
import { quoteShellArgument, quoteShellArgumentWhenNeeded } from '../src/shell-argument';

describe('shell argument formatting', (): void => {
  it('leaves shell-safe values unquoted when requested', (): void => {
    expect(quoteShellArgumentWhenNeeded('admin@example.com')).toBe('admin@example.com');
    expect(quoteShellArgumentWhenNeeded('http://console.localhost:9443')).toBe('http://console.localhost:9443');
  });

  it('single-quotes shell-sensitive values and escapes embedded quotes', (): void => {
    expect(quoteShellArgument("o'hara@example.com")).toBe("'o'\\''hara@example.com'");
    expect(quoteShellArgumentWhenNeeded('value with spaces')).toBe("'value with spaces'");
  });
});
