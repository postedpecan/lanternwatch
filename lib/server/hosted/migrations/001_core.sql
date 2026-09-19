CREATE TYPE hosted.workspace_kind AS ENUM ('personal', 'organization');
CREATE TYPE hosted.organization_role AS ENUM ('owner', 'admin', 'member', 'viewer');
CREATE TYPE hosted.invitation_state AS ENUM ('pending', 'accepted', 'revoked', 'expired');
CREATE TYPE hosted.device_state AS ENUM ('pending', 'active', 'revoked');
CREATE TYPE hosted.run_state AS ENUM ('working', 'completed', 'interrupted', 'failed', 'stalled');
CREATE TYPE hosted.agent_platform AS ENUM ('codex', 'claude_code');
CREATE TYPE hosted.audit_outcome AS ENUM ('succeeded', 'denied', 'failed');
CREATE TYPE hosted.deletion_state AS ENUM ('requested', 'processing', 'completed', 'cancelled');

CREATE TABLE hosted.users (
  id uuid PRIMARY KEY,
  auth_subject varchar(255) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  disabled_at timestamptz
);

CREATE TABLE hosted.workspaces (
  id uuid PRIMARY KEY,
  kind hosted.workspace_kind NOT NULL,
  personal_owner_user_id uuid REFERENCES hosted.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT workspace_personal_owner_shape CHECK (
    (kind = 'personal' AND personal_owner_user_id IS NOT NULL)
    OR (kind = 'organization' AND personal_owner_user_id IS NULL)
  )
);
ALTER TABLE hosted.workspaces ADD CONSTRAINT workspaces_kind_key UNIQUE (id, kind);
CREATE UNIQUE INDEX workspaces_one_personal_per_user
  ON hosted.workspaces(personal_owner_user_id)
  WHERE kind = 'personal' AND deleted_at IS NULL;

CREATE TABLE hosted.organizations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL UNIQUE,
  workspace_kind hosted.workspace_kind NOT NULL DEFAULT 'organization'
    CHECK (workspace_kind = 'organization'),
  display_name varchar(120) NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT organizations_workspace_fk FOREIGN KEY (workspace_id, workspace_kind)
    REFERENCES hosted.workspaces(id, kind) ON DELETE RESTRICT,
  CONSTRAINT organizations_tenant_key UNIQUE (workspace_id, id)
);

CREATE TABLE hosted.organization_memberships (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES hosted.users(id) ON DELETE RESTRICT,
  role hosted.organization_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  ended_at timestamptz,
  CONSTRAINT organization_memberships_org_fk FOREIGN KEY (workspace_id, organization_id)
    REFERENCES hosted.organizations(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT organization_memberships_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT organization_memberships_user_period UNIQUE NULLS NOT DISTINCT (workspace_id, user_id, ended_at)
);

CREATE TABLE hosted.beta_invitations (
  id uuid PRIMARY KEY,
  token_verifier bytea NOT NULL UNIQUE CHECK (octet_length(token_verifier) >= 32),
  email_constraint varchar(320),
  domain_constraint varchar(253),
  state hosted.invitation_state NOT NULL DEFAULT 'pending',
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 1000),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
  expires_at timestamptz NOT NULL,
  created_by_user_id uuid REFERENCES hosted.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz
);

CREATE TABLE hosted.organization_invitations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  token_verifier bytea NOT NULL CHECK (octet_length(token_verifier) >= 32),
  email_constraint varchar(320),
  domain_constraint varchar(253),
  role hosted.organization_role NOT NULL,
  state hosted.invitation_state NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES hosted.users(id) ON DELETE RESTRICT,
  accepted_by_user_id uuid REFERENCES hosted.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT organization_invitations_org_fk FOREIGN KEY (workspace_id, organization_id)
    REFERENCES hosted.organizations(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT organization_invitations_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT organization_invitations_token_per_tenant UNIQUE (workspace_id, token_verifier)
);

CREATE TABLE hosted.enrollment_tokens (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  token_verifier bytea NOT NULL CHECK (octet_length(token_verifier) >= 32),
  requested_by_user_id uuid NOT NULL REFERENCES hosted.users(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT enrollment_tokens_workspace_fk FOREIGN KEY (workspace_id)
    REFERENCES hosted.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT enrollment_tokens_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT enrollment_tokens_verifier_per_tenant UNIQUE (workspace_id, token_verifier)
);

CREATE TABLE hosted.devices (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  display_name varchar(120) NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  state hosted.device_state NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  approved_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT devices_workspace_fk FOREIGN KEY (workspace_id)
    REFERENCES hosted.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT devices_tenant_key UNIQUE (workspace_id, id)
);

CREATE TABLE hosted.device_credentials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  device_id uuid NOT NULL,
  verifier bytea NOT NULL CHECK (octet_length(verifier) >= 32),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CONSTRAINT device_credentials_device_fk FOREIGN KEY (workspace_id, device_id)
    REFERENCES hosted.devices(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT device_credentials_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT device_credentials_verifier_per_tenant UNIQUE (workspace_id, verifier)
);

CREATE TABLE hosted.projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  display_name varchar(160) NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 160),
  created_by_user_id uuid NOT NULL REFERENCES hosted.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT projects_workspace_fk FOREIGN KEY (workspace_id)
    REFERENCES hosted.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT projects_tenant_key UNIQUE (workspace_id, id)
);

CREATE TABLE hosted.runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  project_id uuid NOT NULL,
  device_id uuid NOT NULL,
  agent_instance_id uuid NOT NULL,
  agent_platform hosted.agent_platform NOT NULL,
  agent_role varchar(64) NOT NULL CHECK (agent_role ~ '^[a-z][a-z0-9_-]{0,63}$'),
  status hosted.run_state NOT NULL,
  started_at timestamptz NOT NULL,
  last_occurred_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT runs_project_fk FOREIGN KEY (workspace_id, project_id)
    REFERENCES hosted.projects(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT runs_device_fk FOREIGN KEY (workspace_id, device_id)
    REFERENCES hosted.devices(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT runs_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT runs_agent_instance_per_project UNIQUE (workspace_id, project_id, agent_instance_id),
  CONSTRAINT runs_time_order CHECK (last_occurred_at >= started_at),
  CONSTRAINT runs_completion_shape CHECK (
    (status = 'working' AND completed_at IS NULL)
    OR (status <> 'working' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE hosted.events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  run_id uuid NOT NULL,
  project_id uuid NOT NULL,
  device_id uuid NOT NULL,
  connector_version varchar(32) NOT NULL CHECK (connector_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  agent_platform hosted.agent_platform NOT NULL,
  agent_role varchar(64) NOT NULL CHECK (agent_role ~ '^[a-z][a-z0-9_-]{0,63}$'),
  agent_instance_id uuid NOT NULL,
  status hosted.run_state NOT NULL,
  error_category varchar(48) CHECK (error_category ~ '^[a-z][a-z0-9_]{0,47}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT events_run_fk FOREIGN KEY (workspace_id, run_id)
    REFERENCES hosted.runs(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT events_project_fk FOREIGN KEY (workspace_id, project_id)
    REFERENCES hosted.projects(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT events_device_fk FOREIGN KEY (workspace_id, device_id)
    REFERENCES hosted.devices(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT events_tenant_key UNIQUE (workspace_id, id)
);

CREATE TABLE hosted.idempotency_records (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  device_credential_id uuid NOT NULL,
  event_id uuid NOT NULL,
  request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_credential_fk FOREIGN KEY (workspace_id, device_credential_id)
    REFERENCES hosted.device_credentials(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT idempotency_event_fk FOREIGN KEY (workspace_id, event_id)
    REFERENCES hosted.events(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT idempotency_records_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT idempotency_event_once UNIQUE (workspace_id, device_credential_id, event_id)
);

CREATE TABLE hosted.replay_records (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  device_credential_id uuid NOT NULL,
  nonce_digest bytea NOT NULL CHECK (octet_length(nonce_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT replay_credential_fk FOREIGN KEY (workspace_id, device_credential_id)
    REFERENCES hosted.device_credentials(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT replay_records_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT replay_nonce_once UNIQUE (workspace_id, device_credential_id, nonce_digest)
);

CREATE TABLE hosted.security_audit_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  action_code varchar(64) NOT NULL CHECK (action_code ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  actor_user_id uuid REFERENCES hosted.users(id) ON DELETE RESTRICT,
  actor_device_id uuid,
  target_type varchar(48) NOT NULL CHECK (target_type ~ '^[a-z][a-z0-9_]{0,47}$'),
  target_id uuid,
  outcome hosted.audit_outcome NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT security_audit_workspace_fk FOREIGN KEY (workspace_id)
    REFERENCES hosted.workspaces(id) ON DELETE RESTRICT,
  CONSTRAINT security_audit_device_fk FOREIGN KEY (workspace_id, actor_device_id)
    REFERENCES hosted.devices(workspace_id, id) ON DELETE SET NULL (actor_device_id),
  CONSTRAINT security_audit_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT security_audit_actor_present CHECK (actor_user_id IS NOT NULL OR actor_device_id IS NOT NULL)
);

CREATE TABLE hosted.deletion_markers (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  resource_type varchar(48) NOT NULL CHECK (resource_type ~ '^[a-z][a-z0-9_]{0,47}$'),
  resource_id uuid NOT NULL,
  state hosted.deletion_state NOT NULL DEFAULT 'requested',
  requested_by_user_id uuid NOT NULL REFERENCES hosted.users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  completed_at timestamptz,
  CONSTRAINT deletion_markers_workspace_fk FOREIGN KEY (workspace_id)
    REFERENCES hosted.workspaces(id) ON DELETE RESTRICT,
  CONSTRAINT deletion_markers_tenant_key UNIQUE (workspace_id, id),
  CONSTRAINT deletion_marker_resource_once UNIQUE (workspace_id, resource_type, resource_id)
);

CREATE INDEX organization_memberships_active_user_idx
  ON hosted.organization_memberships(workspace_id, user_id) WHERE ended_at IS NULL;
CREATE INDEX beta_invitations_pending_expiry_idx
  ON hosted.beta_invitations(expires_at) WHERE state = 'pending';
CREATE INDEX organization_invitations_pending_expiry_idx
  ON hosted.organization_invitations(workspace_id, expires_at) WHERE state = 'pending';
CREATE INDEX enrollment_tokens_expiry_idx
  ON hosted.enrollment_tokens(workspace_id, expires_at) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX device_credentials_active_idx
  ON hosted.device_credentials(workspace_id, device_id) WHERE revoked_at IS NULL;
CREATE INDEX runs_project_recent_idx
  ON hosted.runs(workspace_id, project_id, last_occurred_at DESC);
CREATE INDEX events_run_order_idx
  ON hosted.events(workspace_id, run_id, occurred_at, id);
CREATE INDEX events_retention_idx
  ON hosted.events(received_at);
CREATE INDEX idempotency_expiry_idx
  ON hosted.idempotency_records(expires_at);
CREATE INDEX replay_expiry_idx
  ON hosted.replay_records(expires_at);
CREATE INDEX audit_workspace_time_idx
  ON hosted.security_audit_events(workspace_id, occurred_at DESC);

ALTER TABLE hosted.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.workspaces FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_tenant_isolation ON hosted.workspaces TO hosted_app
  USING (id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant_isolation ON hosted.organizations TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.organization_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant_isolation ON hosted.organization_memberships TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.organization_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_invitations_tenant_isolation ON hosted.organization_invitations TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.enrollment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.enrollment_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY enrollment_tokens_tenant_isolation ON hosted.enrollment_tokens TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.devices FORCE ROW LEVEL SECURITY;
CREATE POLICY devices_tenant_isolation ON hosted.devices TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.device_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.device_credentials FORCE ROW LEVEL SECURITY;
CREATE POLICY device_credentials_tenant_isolation ON hosted.device_credentials TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.projects FORCE ROW LEVEL SECURITY;
CREATE POLICY projects_tenant_isolation ON hosted.projects TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.runs FORCE ROW LEVEL SECURITY;
CREATE POLICY runs_tenant_isolation ON hosted.runs TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.events FORCE ROW LEVEL SECURITY;
CREATE POLICY events_tenant_isolation ON hosted.events TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_tenant_isolation ON hosted.idempotency_records TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.replay_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.replay_records FORCE ROW LEVEL SECURITY;
CREATE POLICY replay_tenant_isolation ON hosted.replay_records TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.security_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.security_audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY security_audit_tenant_isolation ON hosted.security_audit_events TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

ALTER TABLE hosted.deletion_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted.deletion_markers FORCE ROW LEVEL SECURITY;
CREATE POLICY deletion_markers_tenant_isolation ON hosted.deletion_markers TO hosted_app
  USING (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = nullif(current_setting('lanternwatch.workspace_id', true), '')::uuid);

GRANT USAGE ON SCHEMA hosted TO hosted_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  hosted.workspaces,
  hosted.organizations,
  hosted.organization_memberships,
  hosted.organization_invitations,
  hosted.enrollment_tokens,
  hosted.devices,
  hosted.device_credentials,
  hosted.projects,
  hosted.runs,
  hosted.events,
  hosted.idempotency_records,
  hosted.replay_records
TO hosted_app;
GRANT SELECT, INSERT ON hosted.security_audit_events TO hosted_app;
GRANT SELECT, INSERT, UPDATE ON hosted.deletion_markers TO hosted_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA hosted REVOKE ALL ON TABLES FROM PUBLIC;
