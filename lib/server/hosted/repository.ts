import type { HostedDatabaseClient, HostedDatabasePool } from "./database.ts";

const TENANT_CONTEXT = Symbol("validated-hosted-tenant-context");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantPrincipalKind = "user_session" | "device_credential" | "operator";

export type HostedTenantContext = Readonly<{
  workspaceId: string;
  principalId: string;
  principalKind: TenantPrincipalKind;
  [TENANT_CONTEXT]: true;
}>;

export function validateServerTenantContext(input: {
  workspaceId: string;
  principalId: string;
  principalKind: TenantPrincipalKind;
}): HostedTenantContext {
  if (!UUID.test(input.workspaceId)) {
    throw new Error("A server-derived UUID workspaceId is required");
  }
  if (!UUID.test(input.principalId)) {
    throw new Error("A server-derived UUID principalId is required");
  }
  if (!["user_session", "device_credential", "operator"].includes(input.principalKind)) {
    throw new Error("A recognized server-derived principalKind is required");
  }
  return Object.freeze({ ...input, [TENANT_CONTEXT]: true as const });
}

function isValidatedTenantContext(value: unknown): value is HostedTenantContext {
  return Boolean(
    value &&
      typeof value === "object" &&
      TENANT_CONTEXT in value &&
      (value as { [TENANT_CONTEXT]?: unknown })[TENANT_CONTEXT] === true,
  );
}

export type HostedProject = Readonly<{
  id: string;
  workspaceId: string;
  displayName: string;
  createdByUserId: string;
  createdAt: Date | string;
  deletedAt: Date | string | null;
}>;

export class HostedTenantRepository {
  readonly #client: HostedDatabaseClient;
  readonly #context: HostedTenantContext;

  constructor(client: HostedDatabaseClient, context: HostedTenantContext) {
    if (!isValidatedTenantContext(context)) {
      throw new Error("HostedTenantRepository requires validated server-derived tenant context");
    }
    this.#client = client;
    this.#context = context;
  }

  async listProjects(): Promise<readonly HostedProject[]> {
    const result = await this.#client.query<{
      id: string;
      workspace_id: string;
      display_name: string;
      created_by_user_id: string;
      created_at: Date | string;
      deleted_at: Date | string | null;
    }>(`
      SELECT id, workspace_id, display_name, created_by_user_id, created_at, deleted_at
      FROM hosted.projects
      WHERE workspace_id = $1 AND deleted_at IS NULL
      ORDER BY created_at, id
    `, [this.#context.workspaceId]);
    return result.rows.map((row) => Object.freeze({
      id: row.id,
      workspaceId: row.workspace_id,
      displayName: row.display_name,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    }));
  }

  async createProject(input: {
    id: string;
    displayName: string;
    createdByUserId: string;
  }): Promise<HostedProject> {
    const result = await this.#client.query<{
      id: string;
      workspace_id: string;
      display_name: string;
      created_by_user_id: string;
      created_at: Date | string;
      deleted_at: Date | string | null;
    }>(`
      INSERT INTO hosted.projects(id, workspace_id, display_name, created_by_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, workspace_id, display_name, created_by_user_id, created_at, deleted_at
    `, [input.id, this.#context.workspaceId, input.displayName, input.createdByUserId]);
    const row = result.rows[0];
    if (!row) throw new Error("Project insert returned no row");
    return Object.freeze({
      id: row.id,
      workspaceId: row.workspace_id,
      displayName: row.display_name,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    });
  }
}

export async function withHostedTenantTransaction<Result>(
  pool: HostedDatabasePool,
  context: HostedTenantContext,
  work: (repository: HostedTenantRepository) => Promise<Result>,
): Promise<Result> {
  if (!isValidatedTenantContext(context)) {
    throw new Error("Hosted transaction requires validated server-derived tenant context");
  }
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SELECT pg_catalog.set_config('lanternwatch.workspace_id', $1, true)", [context.workspaceId]);
    await client.query("SELECT pg_catalog.set_config('lanternwatch.principal_id', $1, true)", [context.principalId]);
    await client.query("SELECT pg_catalog.set_config('lanternwatch.principal_kind', $1, true)", [context.principalKind]);
    const result = await work(new HostedTenantRepository(client, context));
    await client.query("COMMIT");
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the application error. A broken connection is handled by the pool.
      }
    }
    throw error;
  } finally {
    await client.release();
  }
}
