import { appendFileSync } from "node:fs";

const tracePath = process.env.LANTERNWATCH_RECOVERY_TRACE_PATH;
if (!tracePath) throw new Error("Fixture trace path is required.");
appendFileSync(tracePath, `${JSON.stringify({
  stage: "notifier-repair",
  parameters: { configPath: process.argv[2], notifierConfigPath: process.argv[3] },
  environment: {
    storageRoot: process.env.LANTERNWATCH_STORAGE_ROOT,
    databasePath: process.env.LANTERNWATCH_DB_PATH,
    vaultPath: process.env.LANTERNWATCH_VAULT_PATH,
    runtimeConfigPath: process.env.LANTERNWATCH_CONFIG_PATH,
  },
})}\n`, "utf8");
if (process.env.LANTERNWATCH_RECOVERY_FAIL_STAGE === "notifier-repair") process.exitCode = 23;
