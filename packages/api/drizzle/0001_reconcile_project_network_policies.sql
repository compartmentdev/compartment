UPDATE "project_kube_provisioning"
SET
  "attempts" = 0,
  "failure_message" = NULL,
  "lease_expires_at" = NULL,
  "lease_id" = NULL,
  "state" = 'pending',
  "updated_at" = NOW()
WHERE "state" = 'succeeded';
