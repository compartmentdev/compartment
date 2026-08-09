export class DeferredValue<T> {
  readonly promise: Promise<T>;
  private resolvePromise?: ((value: T) => void) | undefined;
  private rejectPromise?: ((error: Error) => void) | undefined;

  constructor() {
    this.promise = new Promise<T>((resolve: (value: T) => void, reject: (error: Error) => void): void => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
  }

  reject(error: Error): void {
    this.rejectPromise?.(error);
  }

  resolve(value: T): void {
    this.resolvePromise?.(value);
  }
}
