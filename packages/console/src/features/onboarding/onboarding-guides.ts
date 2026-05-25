export function readConsoleOrigin(): string {
  return typeof window === 'undefined' ? '<console-url>' : window.location.origin;
}
