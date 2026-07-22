export async function waitForInstallDelay(delayMs: number): Promise<void> {
  await new Promise<void>((resolveDelay: () => void): void => {
    setTimeout(resolveDelay, delayMs);
  });
}
