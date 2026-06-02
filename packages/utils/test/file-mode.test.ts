import { describe, expect, it } from 'vitest';
import { isFileModeWritableByIdentity } from '../src/file-mode';

describe('file mode helpers', (): void => {
  it('detects write access for a matching owner identity', (): void => {
    expect(isFileModeWritableByIdentity(0o700, { gid: 20001, uid: 10001 }, { gid: 30001, uid: 10001 })).toBe(true);
  });

  it('detects write access for a matching group identity', (): void => {
    expect(isFileModeWritableByIdentity(0o070, { gid: 20001, uid: 10001 }, { gid: 20001, uid: 30001 })).toBe(true);
  });

  it('detects write access for others', (): void => {
    expect(isFileModeWritableByIdentity(0o002, { gid: 20001, uid: 10001 }, { gid: 30001, uid: 30001 })).toBe(true);
  });

  it('rejects read-only access for an identity', (): void => {
    expect(isFileModeWritableByIdentity(0o440, { gid: 20001, uid: 10001 }, { gid: 20001, uid: 10001 })).toBe(false);
  });

  it('uses owner permission precedence when the uid matches', (): void => {
    expect(isFileModeWritableByIdentity(0o077, { gid: 20001, uid: 10001 }, { gid: 20001, uid: 10001 })).toBe(false);
  });

  it('uses group permission precedence when only the gid matches', (): void => {
    expect(isFileModeWritableByIdentity(0o707, { gid: 20001, uid: 10001 }, { gid: 20001, uid: 30001 })).toBe(false);
  });
});
