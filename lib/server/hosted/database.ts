export type HostedQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> = {
  rows: Row[];
  rowCount?: number | null;
};

export interface HostedQueryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<HostedQueryResult<Row>>;
  exec?: (sql: string) => Promise<unknown>;
}

export interface HostedDatabaseClient extends HostedQueryable {
  release(): void | Promise<void>;
}

export interface HostedDatabasePool {
  connect(): Promise<HostedDatabaseClient>;
}
