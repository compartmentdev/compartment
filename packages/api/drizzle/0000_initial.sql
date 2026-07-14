CREATE TABLE "app_access_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_session_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"host" text NOT NULL,
	"state" text NOT NULL,
	"redirect_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "app_access_codes_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "app_access_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_session_id" text NOT NULL,
	"host" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "app_access_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"principal_id" text NOT NULL,
	"auth_method_kind" text NOT NULL,
	"organization_id" text,
	"oidc_provider_id" text,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "cli_login_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"onboarding_session_id" text,
	"expected_principal_email" text,
	"browser_code_hash" text NOT NULL,
	"exchange_secret_hash" text NOT NULL,
	"authenticated_principal_id" text,
	"authenticated_auth_method_kind" text,
	"authenticated_oidc_provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"authenticated_at" timestamp with time zone,
	"exchanged_at" timestamp with time zone,
	CONSTRAINT "cli_login_attempts_browser_code_hash_unique" UNIQUE("browser_code_hash"),
	CONSTRAINT "cli_login_attempts_exchange_secret_hash_unique" UNIQUE("exchange_secret_hash")
);
--> statement-breakpoint
CREATE TABLE "local_credentials" (
	"principal_id" text PRIMARY KEY NOT NULL,
	"password_hash" text,
	"bootstrap_token_hash" text,
	"bootstrap_token_expires_at" timestamp with time zone,
	"password_reset_token_hash" text,
	"password_reset_token_expires_at" timestamp with time zone,
	"password_reset_organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"local_password_enabled" boolean DEFAULT true NOT NULL,
	"rollback_retention_mode" text DEFAULT 'inherit' NOT NULL,
	"rollback_retention_limit" integer,
	"audit_retention_mode" text DEFAULT 'inherit' NOT NULL,
	"audit_retention_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sso_oidc_flows" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"cli_login_attempt_id" text,
	"state_hash" text NOT NULL,
	"oidc_state" text NOT NULL,
	"nonce" text NOT NULL,
	"pkce_code_verifier" text NOT NULL,
	"flow_host" text,
	"flow_path" text,
	"flow_state" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "sso_oidc_flows_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "sso_oidc_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "sso_oidc_identities_provider_principal_unique" UNIQUE("provider_id","principal_id"),
	CONSTRAINT "sso_oidc_identities_provider_subject_unique" UNIQUE("provider_id","subject")
);
--> statement-breakpoint
CREATE TABLE "sso_oidc_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"preset" text NOT NULL,
	"display_name" text NOT NULL,
	"key" text NOT NULL,
	"button_text" text NOT NULL,
	"issuer_url" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_ciphertext" text NOT NULL,
	"client_secret_encryption_key_id" text NOT NULL,
	"identity_verification_json" text NOT NULL,
	"provisioning_policy_json" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "throttle_buckets" (
	"action" text NOT NULL,
	"attempt_count" integer NOT NULL,
	"blocked_until_at" timestamp with time zone,
	"bucket_key_hash" text NOT NULL,
	"bucket_kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scope" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "browser_auth_token_flows" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"token_ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"scope_type" text NOT NULL,
	"organization_id" text,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_principal_id" text,
	"actor_email" text,
	"auth_session_id" text,
	"auth_transport" text,
	"source_ip" text,
	"user_agent" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"target_display_name" text,
	"project_id" text,
	"environment_id" text,
	"project_service_id" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_events_scope_organization_check" CHECK (("audit_events"."scope_type" = 'organization' AND "audit_events"."organization_id" IS NOT NULL) OR ("audit_events"."scope_type" = 'installation' AND "audit_events"."organization_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "access_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"role_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_assignments_subject_role_scope_unique" UNIQUE("subject_type","subject_id","role_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "access_group_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_group_memberships_group_principal_unique" UNIQUE("group_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "access_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_groups_organization_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "access_role_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"permission_key" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_role_permissions_role_permission_unique" UNIQUE("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "access_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_roles_organization_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"principal_id" text NOT NULL,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_organization_principal_unique" UNIQUE("organization_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"node_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_project_id_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"node_version" text NOT NULL,
	"node_url" text NOT NULL,
	"node_socket_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"actor_principal_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_services" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_services_project_id_name_unique" UNIQUE("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_organization_id_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "system_domain_idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "system_domain_idempotency_keys_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "system_domain_setup_state" (
	"id" text PRIMARY KEY NOT NULL,
	"setup_version" integer DEFAULT 0 NOT NULL,
	"pending_status" text,
	"pending_operation_id" text,
	"pending_domain_kind" text,
	"pending_tls_mode" text,
	"pending_public_scheme" text,
	"pending_caddy_mode" text,
	"pending_base_domain" text,
	"pending_certificate_metadata_json" text,
	"pending_certificate_path" text,
	"pending_private_key_path" text,
	"pending_required_dns_records_json" text,
	"pending_failure_code" text,
	"pending_failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_principal_id" text,
	"project_id" text,
	"environment_id" text,
	"project_service_id" text,
	"source_digest" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "build_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"project_service_id" text NOT NULL,
	"created_by_principal_id" text,
	"source_upload_id" text,
	"source_digest" text NOT NULL,
	"resolved_build_json" text NOT NULL,
	"resolved_build_env_json" text NOT NULL,
	"image_repository" text NOT NULL,
	"image_ref" text,
	"image_retention_state" text DEFAULT 'available' NOT NULL,
	"image_cleaned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_custom_domains" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"project_service_id" text NOT NULL,
	"host" text NOT NULL,
	"verification_token_hash" text NOT NULL,
	"ownership_status" text NOT NULL,
	"routing_status" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"failure_message" text,
	"created_by_principal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_custom_domains_host_unique" UNIQUE("host"),
	CONSTRAINT "deployment_custom_domains_env_id_service_id_host_unique" UNIQUE("environment_id","project_service_id","host")
);
--> statement-breakpoint
CREATE TABLE "deployment_movement_organization_state" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"last_claimed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_routes" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"subdomain" text NOT NULL,
	"access_scope_type" text NOT NULL,
	"access_scope_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_routes_deployment_id_unique" UNIQUE("deployment_id"),
	CONSTRAINT "deployment_routes_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "deployment_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_run_id" text NOT NULL,
	"deployment_id" text,
	"step_key" text NOT NULL,
	"status" text,
	"stream" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"label" text,
	"onboarding_session_id" text,
	"trigger_type" text NOT NULL,
	"source_automation_principal_id" text,
	"source_binding_id" text,
	"source_binding_snapshot_json" text,
	"source_commit_sha" text,
	"source_event_id" text,
	"source_id" text,
	"source_kind" text,
	"source_repository_snapshot_json" text,
	"source_resolution_task_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_run_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"build_artifact_id" text NOT NULL,
	"project_service_id" text NOT NULL,
	"node_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"status" text NOT NULL,
	"health" text NOT NULL,
	"label" text,
	"upstream_host" text,
	"upstream_port" integer,
	"container_id" text,
	"failure_message" text,
	"access_mode" text DEFAULT 'authenticated' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"resolved_readiness_json" text NOT NULL,
	"resolved_release_json" text DEFAULT 'null' NOT NULL,
	"resolved_run_json" text NOT NULL,
	"resolved_routes_json" text DEFAULT '[]' NOT NULL,
	"promotion_stage" text NOT NULL,
	"draining_container_id" text,
	"draining_deployment_id" text,
	"draining_node_id" text,
	"movement_source_deployment_id" text,
	"source_automation_principal_id" text,
	"source_binding_id" text,
	"source_binding_snapshot_json" text,
	"source_commit_sha" text,
	"source_event_id" text,
	"source_id" text,
	"source_kind" text,
	"source_repository_snapshot_json" text,
	"source_resolution_task_id" text,
	"drain_deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "deployment_kube_references" (
	"id" text PRIMARY KEY NOT NULL,
	"deployment_id" text NOT NULL,
	"namespace" text NOT NULL,
	"deployment_name" text NOT NULL,
	"service_name" text NOT NULL,
	"network_policy_names_json" text NOT NULL,
	"state" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"observed_at" timestamp with time zone,
	"transitioned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_kube_references_deployment_id_unique" UNIQUE("deployment_id")
);
--> statement-breakpoint
CREATE TABLE "deployment_product_logs" (
	"deployment_id" text,
	"resource_id" text,
	"pod_uid" text NOT NULL,
	"pod_name" text NOT NULL,
	"namespace" text NOT NULL,
	"container_name" text NOT NULL,
	"restart_identity" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"source_offset" bigint NOT NULL,
	"stream" text NOT NULL,
	"message" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_product_logs_owner_check" CHECK (num_nonnulls("deployment_product_logs"."deployment_id", "deployment_product_logs"."resource_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "product_job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_class" text NOT NULL,
	"identity_id" text NOT NULL,
	"image" text NOT NULL,
	"image_pull_secret_id" text,
	"command_json" text NOT NULL,
	"env_json" text NOT NULL,
	"volume_mounts_json" text DEFAULT '[]' NOT NULL,
	"namespace" text NOT NULL,
	"timeout_ms" integer NOT NULL,
	"status" text NOT NULL,
	"exit_code" integer,
	"job_name" text,
	"pod_name" text,
	"logs" text,
	"completed_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_log_store_quota" (
	"id" text PRIMARY KEY NOT NULL,
	"used_bytes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_kube_provisioning" (
	"project_id" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"lease_id" text,
	"lease_expires_at" timestamp with time zone,
	"failure_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"name" text NOT NULL,
	"image" text NOT NULL,
	"command_json" text NOT NULL,
	"env_json" text NOT NULL,
	"operations_json" text DEFAULT '{"backup":null,"restore":null}' NOT NULL,
	"operation_config_hash" text DEFAULT '' NOT NULL,
	"outputs_json" text DEFAULT '{}' NOT NULL,
	"ports_json" text NOT NULL,
	"volumes_json" text NOT NULL,
	"readiness_json" text NOT NULL,
	"restart_policy" text NOT NULL,
	"runtime_definition_hash" text NOT NULL,
	"hostname" text NOT NULL,
	"runtime_kind" text DEFAULT 'node' NOT NULL,
	"expected_claims_json" text DEFAULT '[]' NOT NULL,
	"status" text NOT NULL,
	"container_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_resources_environment_id_name_unique" UNIQUE("environment_id","name")
);
--> statement-breakpoint
CREATE TABLE "resource_backups" (
	"id" text PRIMARY KEY NOT NULL,
	"project_resource_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"created_by_principal_id" text,
	"purpose" text NOT NULL,
	"status" text NOT NULL,
	"artifact_location" text,
	"checksum" text,
	"size_bytes" integer,
	"manifest_json" text,
	"resource_definition_json" text,
	"failure_summary" text,
	"retention_deleted_at" timestamp with time zone,
	"retention_reason" text,
	"stdout_summary" text,
	"stderr_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resource_reconcile_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_resource_id" text NOT NULL,
	"intent_json" text NOT NULL,
	"expected_claims_json" text NOT NULL,
	"previous_manifest_json" text,
	"operation_type" text NOT NULL,
	"lease_id" text,
	"lease_expires_at" timestamp with time zone,
	"phase" text NOT NULL,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_provider_bootstrap_states" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_host" text NOT NULL,
	"repository_name" text,
	"repository_owner" text NOT NULL,
	"return_to" text,
	"state_nonce" text NOT NULL,
	"provider_registration_id" text NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "git_provider_registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_type" text NOT NULL,
	"provider_host" text NOT NULL,
	"repository_owner" text NOT NULL,
	"status" text NOT NULL,
	"bootstrap_state_id" text,
	"pending_expires_at" timestamp with time zone,
	"app_id" text,
	"app_name" text,
	"app_slug" text,
	"app_url" text,
	"installation_account_login" text,
	"installation_account_type" text,
	"installation_id" text,
	"private_key_pem_ciphertext" text,
	"private_key_pem_encryption_key_id" text,
	"webhook_secret_ciphertext" text,
	"webhook_secret_encryption_key_id" text,
	"webhook_url" text NOT NULL,
	"callback_url" text NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_binding_branch_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"source_binding_id" text NOT NULL,
	"branch_name" text NOT NULL,
	"environment_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"project_id" text,
	"project_name" text NOT NULL,
	"descriptor_path" text NOT NULL,
	"descriptor_directory" text NOT NULL,
	"watch_paths_json" text DEFAULT '[]' NOT NULL,
	"status" text NOT NULL,
	"auto_deploy_enabled" boolean DEFAULT false NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_by_principal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_bindings_active_project_reference_check" CHECK ("source_bindings"."status" <> 'active' OR "source_bindings"."project_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "source_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"provider_delivery_id" text NOT NULL,
	"event_type" text NOT NULL,
	"branch_name" text,
	"commit_sha" text,
	"changed_files_json" text DEFAULT '[]' NOT NULL,
	"changed_files_complete" boolean DEFAULT true NOT NULL,
	"payload_json" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "source_excluded_descriptors" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"descriptor_path" text NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_resolution_task_deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"source_resolution_task_id" text NOT NULL,
	"deployment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_resolution_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_event_id" text NOT NULL,
	"source_id" text NOT NULL,
	"source_binding_id" text NOT NULL,
	"commit_sha" text NOT NULL,
	"branch_name" text NOT NULL,
	"target_environment_name" text NOT NULL,
	"status" text NOT NULL,
	"claimant_id" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"provider_host" text NOT NULL,
	"provider_registration_id" text NOT NULL,
	"provider_installation_id" text NOT NULL,
	"repository_external_id" text NOT NULL,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"repository_clone_url" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"default_branch_name" text NOT NULL,
	"sync_branch_name" text NOT NULL,
	"auto_adopt_new_apps" boolean DEFAULT true NOT NULL,
	"default_environment_name" text NOT NULL,
	"default_auto_deploy_enabled" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"automation_principal_id" text,
	"disconnected_at" timestamp with time zone,
	"created_by_principal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_sync_task_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"source_sync_task_id" text NOT NULL,
	"descriptor_path" text NOT NULL,
	"descriptor_directory" text NOT NULL,
	"project_name" text,
	"derived_watch_paths_json" text DEFAULT '[]' NOT NULL,
	"blocked_reason" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_sync_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"requested_by_principal_id" text NOT NULL,
	"requested_branch_name" text NOT NULL,
	"adoption_mode" text NOT NULL,
	"requested_descriptor_paths_json" text DEFAULT '[]' NOT NULL,
	"resolved_commit_sha" text,
	"trigger_source_event_id" text,
	"trigger_commit_sha" text,
	"status" text NOT NULL,
	"claimed_by_worker_id" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"failure_reason" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_first_deploy_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by_principal_id" text NOT NULL,
	"state" text NOT NULL,
	"method" text,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "environment_resource_output_variable_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"target_service_name" text NOT NULL,
	"key_name" text NOT NULL,
	"resource_name" text NOT NULL,
	"output_name" text NOT NULL,
	"source" text DEFAULT 'cli' NOT NULL,
	"created_by_principal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_principal_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_resource_output_bindings_env_service_key_unique" UNIQUE("environment_id","target_service_name","key_name"),
	CONSTRAINT "environment_resource_output_bindings_source_check" CHECK ("environment_resource_output_variable_bindings"."source" in ('cli', 'descriptor'))
);
--> statement-breakpoint
CREATE TABLE "environment_variable_set_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"project_service_id" text,
	"target_resource_name" text,
	"organization_variable_set_id" text NOT NULL,
	"created_by_principal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_variable_set_bindings_target_exclusivity_check" CHECK ("environment_variable_set_bindings"."project_service_id" is null or "environment_variable_set_bindings"."target_resource_name" is null)
);
--> statement-breakpoint
CREATE TABLE "environment_variable_values" (
	"id" text PRIMARY KEY NOT NULL,
	"environment_id" text NOT NULL,
	"project_service_id" text,
	"target_resource_name" text,
	"key_name" text NOT NULL,
	"sensitivity" text NOT NULL,
	"value_ciphertext" text NOT NULL,
	"value_fingerprint" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"created_by_principal_id" text,
	"updated_by_principal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environment_variable_values_target_exclusivity_check" CHECK ("environment_variable_values"."project_service_id" is null or "environment_variable_values"."target_resource_name" is null)
);
--> statement-breakpoint
CREATE TABLE "organization_variable_set_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_variable_set_id" text NOT NULL,
	"key_name" text NOT NULL,
	"sensitivity" text NOT NULL,
	"value_ciphertext" text NOT NULL,
	"value_fingerprint" text NOT NULL,
	"encryption_key_id" text NOT NULL,
	"created_by_principal_id" text,
	"updated_by_principal_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_variable_set_entries_set_id_key_name_unique" UNIQUE("organization_variable_set_id","key_name")
);
--> statement-breakpoint
CREATE TABLE "organization_variable_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by_principal_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_variable_sets_organization_id_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
CREATE TABLE "variable_access_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_principal_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"environment_id" text,
	"project_service_id" text,
	"target_resource_name" text,
	"target_project_name" text NOT NULL,
	"target_environment_name" text NOT NULL,
	"target_service_name" text,
	"operation" text NOT NULL,
	"production" boolean NOT NULL,
	"command_name" text,
	"key_names_json" text NOT NULL,
	"sensitivity_json" text NOT NULL,
	"fingerprints_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variable_access_events_operation_check" CHECK ("variable_access_events"."operation" in ('local_run', 'resource_output_reveal'))
);
--> statement-breakpoint
CREATE TABLE "variable_change_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_principal_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"operation" text NOT NULL,
	"key_names_json" text NOT NULL,
	"sensitivity_json" text,
	"fingerprints_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_access_codes" ADD CONSTRAINT "app_access_codes_auth_session_id_auth_sessions_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_access_sessions" ADD CONSTRAINT "app_access_sessions_auth_session_id_auth_sessions_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_oidc_provider_id_sso_oidc_providers_id_fk" FOREIGN KEY ("oidc_provider_id") REFERENCES "public"."sso_oidc_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_login_attempts" ADD CONSTRAINT "cli_login_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_login_attempts" ADD CONSTRAINT "cli_login_attempts_authenticated_principal_id_principals_id_fk" FOREIGN KEY ("authenticated_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cli_login_attempts" ADD CONSTRAINT "cli_login_attempts_authenticated_oidc_provider_id_sso_oidc_providers_id_fk" FOREIGN KEY ("authenticated_oidc_provider_id") REFERENCES "public"."sso_oidc_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_credentials" ADD CONSTRAINT "local_credentials_password_reset_organization_id_organizations_id_fk" FOREIGN KEY ("password_reset_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_oidc_flows" ADD CONSTRAINT "sso_oidc_flows_provider_id_sso_oidc_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_oidc_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_oidc_flows" ADD CONSTRAINT "sso_oidc_flows_cli_login_attempt_id_cli_login_attempts_id_fk" FOREIGN KEY ("cli_login_attempt_id") REFERENCES "public"."cli_login_attempts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_oidc_identities" ADD CONSTRAINT "sso_oidc_identities_provider_id_sso_oidc_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."sso_oidc_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_oidc_identities" ADD CONSTRAINT "sso_oidc_identities_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sso_oidc_providers" ADD CONSTRAINT "sso_oidc_providers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_principal_id_principals_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_auth_session_id_auth_sessions_id_fk" FOREIGN KEY ("auth_session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_assignments" ADD CONSTRAINT "access_assignments_role_id_access_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."access_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_group_memberships" ADD CONSTRAINT "access_group_memberships_group_id_access_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."access_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_group_memberships" ADD CONSTRAINT "access_group_memberships_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_groups" ADD CONSTRAINT "access_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_role_permissions" ADD CONSTRAINT "access_role_permissions_role_id_access_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."access_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_roles" ADD CONSTRAINT "access_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_actor_principal_id_principals_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_services" ADD CONSTRAINT "project_services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_uploads" ADD CONSTRAINT "source_uploads_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD CONSTRAINT "build_artifacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD CONSTRAINT "build_artifacts_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD CONSTRAINT "build_artifacts_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_artifacts" ADD CONSTRAINT "build_artifacts_source_upload_id_source_uploads_id_fk" FOREIGN KEY ("source_upload_id") REFERENCES "public"."source_uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD CONSTRAINT "deployment_custom_domains_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD CONSTRAINT "deployment_custom_domains_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_custom_domains" ADD CONSTRAINT "deployment_custom_domains_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_movement_organization_state" ADD CONSTRAINT "deployment_movement_organization_state_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_routes" ADD CONSTRAINT "deployment_routes_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_run_events" ADD CONSTRAINT "deployment_run_events_deployment_run_id_deployment_runs_id_fk" FOREIGN KEY ("deployment_run_id") REFERENCES "public"."deployment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_run_events" ADD CONSTRAINT "deployment_run_events_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_runs" ADD CONSTRAINT "deployment_runs_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_deployment_run_id_deployment_runs_id_fk" FOREIGN KEY ("deployment_run_id") REFERENCES "public"."deployment_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_artifact_id_build_artifacts_id_fk" FOREIGN KEY ("build_artifact_id") REFERENCES "public"."build_artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_draining_deployment_id_deployments_id_fk" FOREIGN KEY ("draining_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_draining_node_id_nodes_id_fk" FOREIGN KEY ("draining_node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_movement_source_deployment_id_deployments_id_fk" FOREIGN KEY ("movement_source_deployment_id") REFERENCES "public"."deployments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_kube_references" ADD CONSTRAINT "deployment_kube_references_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_product_logs" ADD CONSTRAINT "deployment_product_logs_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_product_logs" ADD CONSTRAINT "deployment_product_logs_resource_id_project_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."project_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_kube_provisioning" ADD CONSTRAINT "project_kube_provisioning_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_backups" ADD CONSTRAINT "resource_backups_project_resource_id_project_resources_id_fk" FOREIGN KEY ("project_resource_id") REFERENCES "public"."project_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_backups" ADD CONSTRAINT "resource_backups_operation_id_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_backups" ADD CONSTRAINT "resource_backups_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_reconcile_runs" ADD CONSTRAINT "resource_reconcile_runs_project_resource_id_project_resources_id_fk" FOREIGN KEY ("project_resource_id") REFERENCES "public"."project_resources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider_bootstrap_states" ADD CONSTRAINT "git_provider_bootstrap_states_provider_registration_id_git_provider_registrations_id_fk" FOREIGN KEY ("provider_registration_id") REFERENCES "public"."git_provider_registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider_bootstrap_states" ADD CONSTRAINT "git_provider_bootstrap_states_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_provider_registrations" ADD CONSTRAINT "git_provider_registrations_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_binding_branch_mappings" ADD CONSTRAINT "source_binding_branch_mappings_source_binding_id_source_bindings_id_fk" FOREIGN KEY ("source_binding_id") REFERENCES "public"."source_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_bindings" ADD CONSTRAINT "source_bindings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_bindings" ADD CONSTRAINT "source_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_bindings" ADD CONSTRAINT "source_bindings_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_excluded_descriptors" ADD CONSTRAINT "source_excluded_descriptors_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_excluded_descriptors" ADD CONSTRAINT "source_excluded_descriptors_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_resolution_task_deployments" ADD CONSTRAINT "source_resolution_task_deployments_source_resolution_task_id_source_resolution_tasks_id_fk" FOREIGN KEY ("source_resolution_task_id") REFERENCES "public"."source_resolution_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_resolution_task_deployments" ADD CONSTRAINT "source_resolution_task_deployments_deployment_id_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_resolution_tasks" ADD CONSTRAINT "source_resolution_tasks_source_event_id_source_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."source_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_resolution_tasks" ADD CONSTRAINT "source_resolution_tasks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_resolution_tasks" ADD CONSTRAINT "source_resolution_tasks_source_binding_id_source_bindings_id_fk" FOREIGN KEY ("source_binding_id") REFERENCES "public"."source_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_provider_registration_id_git_provider_registrations_id_fk" FOREIGN KEY ("provider_registration_id") REFERENCES "public"."git_provider_registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_automation_principal_id_principals_id_fk" FOREIGN KEY ("automation_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync_task_candidates" ADD CONSTRAINT "source_sync_task_candidates_source_sync_task_id_source_sync_tasks_id_fk" FOREIGN KEY ("source_sync_task_id") REFERENCES "public"."source_sync_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync_tasks" ADD CONSTRAINT "source_sync_tasks_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync_tasks" ADD CONSTRAINT "source_sync_tasks_requested_by_principal_id_principals_id_fk" FOREIGN KEY ("requested_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_sync_tasks" ADD CONSTRAINT "source_sync_tasks_trigger_source_event_id_source_events_id_fk" FOREIGN KEY ("trigger_source_event_id") REFERENCES "public"."source_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_first_deploy_sessions" ADD CONSTRAINT "onboarding_first_deploy_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_first_deploy_sessions" ADD CONSTRAINT "onboarding_first_deploy_sessions_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_resource_output_variable_bindings" ADD CONSTRAINT "environment_resource_output_variable_bindings_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_resource_output_variable_bindings" ADD CONSTRAINT "environment_resource_output_variable_bindings_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_resource_output_variable_bindings" ADD CONSTRAINT "environment_resource_output_variable_bindings_updated_by_principal_id_principals_id_fk" FOREIGN KEY ("updated_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable_set_bindings" ADD CONSTRAINT "environment_variable_set_bindings_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable_set_bindings" ADD CONSTRAINT "environment_variable_set_bindings_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable_set_bindings" ADD CONSTRAINT "environment_variable_set_bindings_organization_variable_set_id_organization_variable_sets_id_fk" FOREIGN KEY ("organization_variable_set_id") REFERENCES "public"."organization_variable_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable_set_bindings" ADD CONSTRAINT "environment_variable_set_bindings_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable_values" ADD CONSTRAINT "environment_variable_values_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable_values" ADD CONSTRAINT "environment_variable_values_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable_values" ADD CONSTRAINT "environment_variable_values_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environment_variable_values" ADD CONSTRAINT "environment_variable_values_updated_by_principal_id_principals_id_fk" FOREIGN KEY ("updated_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_variable_set_entries" ADD CONSTRAINT "organization_variable_set_entries_organization_variable_set_id_organization_variable_sets_id_fk" FOREIGN KEY ("organization_variable_set_id") REFERENCES "public"."organization_variable_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_variable_set_entries" ADD CONSTRAINT "organization_variable_set_entries_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_variable_set_entries" ADD CONSTRAINT "organization_variable_set_entries_updated_by_principal_id_principals_id_fk" FOREIGN KEY ("updated_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_variable_sets" ADD CONSTRAINT "organization_variable_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_variable_sets" ADD CONSTRAINT "organization_variable_sets_created_by_principal_id_principals_id_fk" FOREIGN KEY ("created_by_principal_id") REFERENCES "public"."principals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_access_events" ADD CONSTRAINT "variable_access_events_actor_principal_id_principals_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_access_events" ADD CONSTRAINT "variable_access_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_access_events" ADD CONSTRAINT "variable_access_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_access_events" ADD CONSTRAINT "variable_access_events_environment_id_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."environments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_access_events" ADD CONSTRAINT "variable_access_events_project_service_id_project_services_id_fk" FOREIGN KEY ("project_service_id") REFERENCES "public"."project_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_change_events" ADD CONSTRAINT "variable_change_events_actor_principal_id_principals_id_fk" FOREIGN KEY ("actor_principal_id") REFERENCES "public"."principals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variable_change_events" ADD CONSTRAINT "variable_change_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cli_login_attempts_onboarding_session_org_created_at_idx" ON "cli_login_attempts" USING btree ("onboarding_session_id","organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "principals_email_lower_unique" ON "principals" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "sso_oidc_providers_organization_key_unique" ON "sso_oidc_providers" USING btree ("organization_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "throttle_buckets_scope_action_bucket_unique" ON "throttle_buckets" USING btree ("scope","action","bucket_kind","bucket_key_hash");--> statement-breakpoint
CREATE INDEX "browser_auth_token_flows_stale_idx" ON "browser_auth_token_flows" USING btree ("consumed_at","expires_at","id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_occurred_at_idx" ON "audit_events" USING btree ("organization_id","actor_principal_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_event_type_occurred_at_idx" ON "audit_events" USING btree ("organization_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_organization_occurred_at_idx" ON "audit_events" USING btree ("organization_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "audit_events_project_occurred_at_idx" ON "audit_events" USING btree ("organization_id","project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_type_occurred_at_idx" ON "audit_events" USING btree ("organization_id","target_type","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_scope_occurred_at_idx" ON "audit_events" USING btree ("scope_type","occurred_at","id");--> statement-breakpoint
CREATE INDEX "source_uploads_consumed_at_expires_at_idx" ON "source_uploads" USING btree ("consumed_at","expires_at");--> statement-breakpoint
CREATE INDEX "source_uploads_scope_idx" ON "source_uploads" USING btree ("organization_id","project_id","environment_id","project_service_id");--> statement-breakpoint
CREATE INDEX "build_artifacts_source_upload_id_idx" ON "build_artifacts" USING btree ("source_upload_id");--> statement-breakpoint
CREATE INDEX "deployment_movement_org_state_last_claimed_at_idx" ON "deployment_movement_organization_state" USING btree ("last_claimed_at");--> statement-breakpoint
CREATE INDEX "deployment_run_events_run_created_at_idx" ON "deployment_run_events" USING btree ("deployment_run_id","created_at");--> statement-breakpoint
CREATE INDEX "deployment_run_events_deployment_created_at_idx" ON "deployment_run_events" USING btree ("deployment_id","created_at");--> statement-breakpoint
CREATE INDEX "deployment_runs_environment_created_at_idx" ON "deployment_runs" USING btree ("environment_id","created_at");--> statement-breakpoint
CREATE INDEX "deployment_runs_onboarding_session_created_at_idx" ON "deployment_runs" USING btree ("onboarding_session_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_movement_lookup_idx" ON "deployments" USING btree ("environment_id","project_service_id","status","movement_source_deployment_id");--> statement-breakpoint
CREATE INDEX "deployments_status_created_at_id_idx" ON "deployments" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "deployment_kube_references_state_updated_at_idx" ON "deployment_kube_references" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "deployment_product_logs_deployment_occurred_at_idx" ON "deployment_product_logs" USING btree ("deployment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "deployment_product_logs_resource_occurred_at_idx" ON "deployment_product_logs" USING btree ("resource_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_product_logs_identity_offset_idx" ON "deployment_product_logs" USING btree ("pod_uid","container_name","restart_identity","source_offset","source_fingerprint");--> statement-breakpoint
CREATE INDEX "deployment_product_logs_captured_at_idx" ON "deployment_product_logs" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_job_runs_class_identity_idx" ON "product_job_runs" USING btree ("job_class","identity_id");--> statement-breakpoint
CREATE INDEX "product_job_runs_status_created_at_idx" ON "product_job_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "project_kube_provisioning_state_lease_idx" ON "project_kube_provisioning" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE INDEX "resource_backups_resource_created_at_idx" ON "resource_backups" USING btree ("project_resource_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_bootstrap_states_state_nonce_unique" ON "git_provider_bootstrap_states" USING btree ("state_nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_active_owner_unique" ON "git_provider_registrations" USING btree ("provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "git_provider_registrations_pending_owner_unique" ON "git_provider_registrations" USING btree ("provider_type","provider_host","repository_owner") WHERE "git_provider_registrations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "source_binding_branch_mappings_branch_unique" ON "source_binding_branch_mappings" USING btree ("source_binding_id","branch_name");--> statement-breakpoint
CREATE UNIQUE INDEX "source_bindings_active_descriptor_unique" ON "source_bindings" USING btree ("source_id","descriptor_path") WHERE "source_bindings"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "source_bindings_active_project_name_unique" ON "source_bindings" USING btree ("source_id","project_name") WHERE "source_bindings"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "source_bindings_active_project_unique" ON "source_bindings" USING btree ("project_id") WHERE "source_bindings"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "source_events_source_delivery_unique" ON "source_events" USING btree ("source_id","provider_delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_excluded_descriptors_source_descriptor_unique" ON "source_excluded_descriptors" USING btree ("source_id","descriptor_path");--> statement-breakpoint
CREATE UNIQUE INDEX "source_resolution_task_deployments_task_deployment_unique" ON "source_resolution_task_deployments" USING btree ("source_resolution_task_id","deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_resolution_tasks_binding_commit_environment_unique" ON "source_resolution_tasks" USING btree ("source_binding_id","commit_sha","target_environment_name");--> statement-breakpoint
CREATE INDEX "source_resolution_tasks_status_created_id_idx" ON "source_resolution_tasks" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_active_repo_unique" ON "sources" USING btree ("organization_id","provider_host","repository_external_id") WHERE "sources"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "sources_disconnected_repo_unique" ON "sources" USING btree ("organization_id","provider_host","repository_external_id") WHERE "sources"."status" = 'disconnected';--> statement-breakpoint
CREATE UNIQUE INDEX "sources_disabled_repo_unique" ON "sources" USING btree ("organization_id","provider_host","repository_external_id") WHERE "sources"."status" = 'disabled';--> statement-breakpoint
CREATE UNIQUE INDEX "source_sync_task_candidates_task_descriptor_unique" ON "source_sync_task_candidates" USING btree ("source_sync_task_id","descriptor_path");--> statement-breakpoint
CREATE INDEX "source_sync_tasks_status_created_id_idx" ON "source_sync_tasks" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_sync_tasks_live_source_unique" ON "source_sync_tasks" USING btree ("source_id") WHERE "source_sync_tasks"."status" IN ('pending', 'claimed');--> statement-breakpoint
CREATE INDEX "onboarding_first_deploy_sessions_org_created_at_idx" ON "onboarding_first_deploy_sessions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "environment_variable_set_bindings_env_id_set_id_unique" ON "environment_variable_set_bindings" USING btree ("environment_id","organization_variable_set_id") WHERE "environment_variable_set_bindings"."project_service_id" is null and "environment_variable_set_bindings"."target_resource_name" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "environment_variable_set_bindings_env_id_service_id_set_id_unique" ON "environment_variable_set_bindings" USING btree ("environment_id","project_service_id","organization_variable_set_id") WHERE "environment_variable_set_bindings"."project_service_id" is not null and "environment_variable_set_bindings"."target_resource_name" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "environment_variable_set_bindings_env_id_resource_name_set_id_unique" ON "environment_variable_set_bindings" USING btree ("environment_id","target_resource_name","organization_variable_set_id") WHERE "environment_variable_set_bindings"."project_service_id" is null and "environment_variable_set_bindings"."target_resource_name" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "environment_variable_values_env_id_key_name_unique" ON "environment_variable_values" USING btree ("environment_id","key_name") WHERE "environment_variable_values"."project_service_id" is null and "environment_variable_values"."target_resource_name" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "environment_variable_values_env_id_service_id_key_name_unique" ON "environment_variable_values" USING btree ("environment_id","project_service_id","key_name") WHERE "environment_variable_values"."project_service_id" is not null and "environment_variable_values"."target_resource_name" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "environment_variable_values_env_id_resource_name_key_name_unique" ON "environment_variable_values" USING btree ("environment_id","target_resource_name","key_name") WHERE "environment_variable_values"."project_service_id" is null and "environment_variable_values"."target_resource_name" is not null;--> statement-breakpoint
CREATE INDEX "variable_access_events_actor_created_at_idx" ON "variable_access_events" USING btree ("actor_principal_id","created_at");--> statement-breakpoint
CREATE INDEX "variable_access_events_organization_created_at_idx" ON "variable_access_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "variable_access_events_production_created_at_idx" ON "variable_access_events" USING btree ("organization_id","production","created_at");--> statement-breakpoint
CREATE INDEX "variable_access_events_target_created_at_idx" ON "variable_access_events" USING btree ("organization_id","target_project_name","target_environment_name","created_at");
--> statement-breakpoint
INSERT INTO "product_log_store_quota" ("id", "used_bytes") VALUES ('global', 0);
--> statement-breakpoint
CREATE FUNCTION decrement_product_log_store_usage() RETURNS trigger AS $$
BEGIN
  UPDATE "product_log_store_quota"
  SET "used_bytes" = GREATEST(0, "used_bytes" - octet_length(OLD."message") - 1024)
  WHERE "id" = 'global';
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deployment_product_logs_quota_delete
AFTER DELETE ON "deployment_product_logs"
FOR EACH ROW EXECUTE FUNCTION decrement_product_log_store_usage();
