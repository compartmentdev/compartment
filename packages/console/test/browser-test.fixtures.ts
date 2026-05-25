import type { JsonValue } from '@compartment/utils';
import type { FormEvent } from 'react';

type JsonResponseBody = JsonValue | object;

export function createJsonResponse(body: JsonResponseBody, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    status,
  });
}

export async function waitForNextTick(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

export class TestFormEvent implements FormEvent<HTMLFormElement> {
  readonly bubbles: boolean = true;
  readonly cancelable: boolean = true;
  readonly currentTarget: EventTarget & HTMLFormElement;
  defaultPrevented: boolean = false;
  readonly eventPhase: number = 0;
  readonly isTrusted: boolean = true;
  readonly nativeEvent: Event = new Event('submit');
  persistCalled: boolean = false;
  propagationStopped: boolean = false;
  readonly target: EventTarget;
  readonly timeStamp: number = 0;
  readonly type: string = 'submit';

  constructor(
    formElement: EventTarget & HTMLFormElement,
    private readonly onPreventDefault: () => void,
  ) {
    this.currentTarget = formElement;
    this.target = formElement;
  }

  isDefaultPrevented(): boolean {
    return this.defaultPrevented;
  }

  isPropagationStopped(): boolean {
    return this.propagationStopped;
  }

  persist(): void {
    this.persistCalled = true;
  }

  preventDefault(): void {
    this.defaultPrevented = true;
    this.onPreventDefault();
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}
