import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { findDistinctFreePorts, findFreePortExcluding } from './public-port-test-support';

interface PublicPortTestSupportMocks {
  findFreePort: Mock<() => Promise<number>>;
}

const mocks: PublicPortTestSupportMocks = vi.hoisted(
  (): PublicPortTestSupportMocks => ({
    findFreePort: vi.fn<() => Promise<number>>(),
  }),
);

vi.mock('@compartment/test-support', (): { findFreePort: Mock<() => Promise<number>> } => ({
  findFreePort: mocks.findFreePort,
}));

describe('public port test support', (): void => {
  beforeEach((): void => {
    mocks.findFreePort.mockReset();
  });

  it('skips excluded ports until it finds a distinct port', async (): Promise<void> => {
    mocks.findFreePort.mockResolvedValueOnce(39001).mockResolvedValueOnce(39001).mockResolvedValueOnce(39002);

    await expect(findFreePortExcluding([39001])).resolves.toBe(39002);
  });

  it('returns two distinct public ports', async (): Promise<void> => {
    mocks.findFreePort.mockResolvedValueOnce(39001).mockResolvedValueOnce(39001).mockResolvedValueOnce(39002);

    await expect(findDistinctFreePorts()).resolves.toEqual([39001, 39002]);
  });
});
