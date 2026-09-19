-- Run once as a database administrator on a dedicated Lanternwatch database.
-- Login roles receive these group roles outside this repository.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hosted_migrator') THEN
    CREATE ROLE hosted_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hosted_app') THEN
    CREATE ROLE hosted_app NOLOGIN;
  END IF;
END
$roles$;

ALTER ROLE hosted_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE hosted_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

REVOKE hosted_migrator FROM hosted_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

DO $database_grant$
BEGIN
  EXECUTE format('GRANT CREATE ON DATABASE %I TO hosted_migrator', current_database());
END
$database_grant$;

GRANT hosted_migrator, hosted_app TO CURRENT_USER;
