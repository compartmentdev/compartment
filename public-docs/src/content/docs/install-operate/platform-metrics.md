---
title: Platform Metrics
description: Scrape Compartment control-plane metrics with Prometheus without exposing them to applications or public ingress.
---

Compartment exposes Prometheus text metrics from the API, worker, project provisioner, and Edge processes on a
dedicated cluster-internal port. The Helm chart always isolates that port with a `NetworkPolicy` and can create a
`PodMonitor` plus a narrowly selected scrape rule. It does not publish the metrics port through Ingress or a Service.

## Enable Prometheus discovery

The feature is off by default. Configure the namespace labels that identify your Prometheus installation; add a Pod
selector when only particular Pods in that namespace should scrape Compartment.

```yaml
platformMetrics:
  enabled: true
  interval: 30s
  additionalLabels:
    release: kube-prometheus-stack
  namespaceSelector:
    kubernetes.io/metadata.name: monitoring
  podSelector:
    app.kubernetes.io/name: prometheus
```

Apply the values through the same `compartment install` or `compartment system update` workflow you use for the
installation. Your Prometheus Operator must watch `PodMonitor` resources in the Compartment release namespace.

Each selected Pod is scraped at `/metrics` on the named `metrics` port, which defaults to `9464`. The metrics endpoint
has no application-level authentication. Its NetworkPolicy admits only Pods matching both configured monitoring
selectors. Keep `namespaceSelector` restricted to an operator-owned namespace; the schema rejects an empty namespace
selector. Tenant namespaces, build workloads, public ingress, and the console cannot reach this port.

## Metric contract

All names start with `compartment_`. Identifiers are opaque IDs. Metrics never contain organization names, project
names, email addresses, application hosts, or request URLs.

| Metric                                                              | Type      | Labels                           | Meaning                                                                                                                                          |
| ------------------------------------------------------------------- | --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compartment_build_queue_deployments`                               | gauge     | `state`                          | Global `queued`, `active`, and `running` counts. `active` means a running deployment without a Kubernetes reference; `running` includes rollout. |
| `compartment_build_queue_deployments_by_organization`               | gauge     | `organization_id`, `state`       | The same counts for organizations that currently have queued or running work.                                                                    |
| `compartment_build_queue_oldest_queued_age_seconds`                 | gauge     | none                             | Age of the oldest globally queued deployment, or zero when the queue is empty.                                                                   |
| `compartment_build_queue_oldest_queued_age_seconds_by_organization` | gauge     | `organization_id`                | Oldest queued age for each organization with live work, or zero when it has running work but no queued deployment.                               |
| `compartment_build_queue_concurrency_limit`                         | gauge     | `scope`                          | Configured `global` or per-`organization` build limit.                                                                                           |
| `compartment_worker_active_builds`                                  | gauge     | none                             | Builds held in the current leader worker process.                                                                                                |
| `compartment_worker_builds_total`                                   | counter   | `result`                         | Worker build completions with `succeeded` or `failed` result.                                                                                    |
| `compartment_deployments`                                           | gauge     | `status`                         | Deployment rows in `queued`, `running`, `succeeded`, `failed`, or `stopped` status.                                                              |
| `compartment_deployment_submit_to_ready_duration_seconds`           | histogram | none                             | Submission-to-ready duration. Buckets are 30, 60, 120, 300, 600, 900, 1800, and 3600 seconds, plus `+Inf`.                                       |
| `compartment_project_provisioning_projects`                         | gauge     | `state`                          | Projects in each current provisioning or teardown state.                                                                                         |
| `compartment_project_provisioning_attempts`                         | gauge     | none                             | Sum of attempts stored on current project provisioning rows.                                                                                     |
| `compartment_project_provisioning_attempts_total`                   | counter   | `result`                         | Provisioner attempt completions with `succeeded` or `failed` result.                                                                             |
| `compartment_project_provisioning_active_attempts`                  | gauge     | none                             | Attempt executing in the current leader provisioner process.                                                                                     |
| `compartment_project_permanently_unprovisionable`                   | gauge     | none                             | Failed projects that exhausted the provisioning attempt limit.                                                                                   |
| `compartment_api_http_requests_total`                               | counter   | `method`, `route`, `status_code` | Completed API requests. `route` is the bounded Fastify route template, never the raw URL.                                                        |
| `compartment_api_http_request_duration_seconds`                     | histogram | `method`, `route`                | API request duration.                                                                                                                            |
| `compartment_api_db_pool_connections`                               | gauge     | `pool`, `state`                  | Total, idle, and waiting connections for the primary and resource-operation pools.                                                               |
| `compartment_platform_metrics_snapshot_age_seconds`                 | gauge     | none                             | Age of the last successful API database snapshot.                                                                                                |
| `compartment_platform_metrics_collection_errors_total`              | counter   | none                             | Failed API database snapshot refreshes.                                                                                                          |
| `compartment_edge_snapshot_age_seconds`                             | gauge     | none                             | Age of the active Edge access snapshot.                                                                                                          |
| `compartment_edge_snapshot_restore_source`                          | gauge     | `source`                         | Whether Edge restored its snapshot from `api` or `disk`.                                                                                         |
| `compartment_edge_snapshot_persistence_errors_total`                | counter   | none                             | Edge snapshot persistence failures.                                                                                                              |
| `compartment_edge_snapshot_refresh_errors_total`                    | counter   | none                             | Edge snapshot refresh failures.                                                                                                                  |
| `compartment_edge_snapshot_fail_closed_expiry_total`                | counter   | none                             | Requests rejected after the Edge snapshot exceeded its fail-closed age.                                                                          |

Each process also exports the standard `compartment_process_*` and `compartment_nodejs_*` CPU, memory, garbage
collection, event-loop, handle, and runtime metrics with a bounded `service` label.

The API refreshes database-backed gauges every 15 seconds and serves the cached snapshot on scrape, so scrape traffic
does not run database queries. Process counters and histograms reset when their Pod restarts. With multiple replicas,
aggregate process counters and histograms across Pods; database-backed gauges are identical snapshots and should not
be summed across API replicas. Sum `compartment_worker_active_builds` across workers, but use `max` for
`compartment_build_queue_concurrency_limit` because every worker replica exports the same configured limits.

Per-organization series exist only while an organization has queued or running deployments. This bounds live series
by organizations with active work instead of every organization ever created. Alert on the global series unless an
incident requires organization-level diagnosis.
