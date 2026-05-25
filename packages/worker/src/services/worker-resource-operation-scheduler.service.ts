import { runNextScheduledResourceOperation, type CompartmentRequester } from '@compartment/sdk';

export async function runScheduledResourceOperationIteration(request: CompartmentRequester): Promise<boolean> {
  return (await runNextScheduledResourceOperation(request)).ran;
}
