export function resourceReconcileRequestError(statusCode: number): Error {
  return Object.assign(new Error('Resource reconcile acknowledgement failed.'), {
    code: statusCode === 409 ? 'resource_conflict' : 'request_error',
    method: 'POST',
    name: 'CompartmentRequestError',
    statusCode,
    url: 'http://api/internal/kube-resources/ack',
  });
}
